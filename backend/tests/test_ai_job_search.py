import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.integrations import ai_job_search as service
from app.models.application import Application
from app.models.job import Job
from app.services.job_service import JobInput, delete_job, ingest_job

TRACKER_HEADER = ("date,company,sector,role,role_type,channel,status,contact_person,fit_rating,"
                  "notes,cv_file,cover_letter_file,source,deadline\n")


@pytest.fixture
def ajs_root(tmp_path: Path) -> Path:
    """A minimal AI Job Search checkout: scrape/rank history and the application tracker."""
    root = tmp_path / "ai-job-search"
    (root / "job_scraper").mkdir(parents=True)
    skill = root / ".claude/skills/job-application-assistant"
    skill.mkdir(parents=True)
    (skill / "04-job-evaluation.md").write_text("---\nframework_version: 1.2.7\n---\n# x\n")
    seen = {"seen": {
        "acme_php-lead": {
            "title": "PHP Lead", "company": "Acme Commerce", "location": "Pune",
            "url": "https://boards.greenhouse.io/acme/jobs/7001234", "first_seen": "2026-10-20",
            "posted_date": "2026-10-18", "deadline": "2026-11-15", "fit": "high",
            "status": "ranked", "portal": "linkedin-search", "source": "cli",
            "rank_score": 82, "rank_verdict": "Strong Fit", "strengths": ["8 years of Magento"],
            "gaps": ["No Kubernetes"], "location_verdict": "PASS", "language_gate": "PASS"},
        "beta_laravel-dev": {
            "title": "Laravel Developer", "company": "Beta Labs", "url":
            "https://jobs.lever.co/beta/1b2c3d4e-0000-4000-8000-000000000001", "fit": "medium",
            "status": "new", "portal": "freehire-search", "source": "cli"},
        "gamma_dev": {
            "title": "Backend Developer", "company": "Gamma GmbH",
            "url": "https://gamma.example/jobs/77001234", "status": "ranked", "rank_score": 70,
            "location_verdict": "PASS", "language_gate": "FAIL",
            "language_note": "fluent German required"},
        "delta_old": {"title": "Old Job", "company": "Delta", "url": "https://d.example/jobs/1",
                      "status": "expired"},
        "eps_skip": {"title": "Sales", "company": "Eps", "url": "https://e.example/jobs/2",
                     "status": "skipped"},
    }}
    (root / "job_scraper/seen_jobs.json").write_text(json.dumps(seen))
    (root / "job_search_tracker.csv").write_text(
        TRACKER_HEADER
        + "2026-10-21,Acme Commerce,Retail,PHP Lead,full-time,LinkedIn,applied,,82,"
          "\"sent via site, followed up 2026-10-28\",cv.pdf,cl.pdf,"
          "https://boards.greenhouse.io/acme/jobs/7001234,2026-11-15\n"
        + "2026-10-10,Zeta Ltd,IT,Magento Architect,full-time,Referral,interview,,75,,,,,\n")
    return root


def test_readers(ajs_root: Path) -> None:
    records, skipped = service.collect(ajs_root)
    assert sorted(r.title for r in records) == [
        "Backend Developer", "Laravel Developer", "Magento Architect", "PHP Lead"]
    assert skipped == {"skipped_by_scrape": 1, "expired": 1, "vetoed": 0}
    lead = next(r for r in records if r.title == "PHP Lead")
    assert lead.tracker and lead.tracker["status"] == "applied"  # matched by its link
    assert str(lead.deadline) == "2026-11-15" and lead.location == "Pune"
    note = service.rank_note(lead.seen)
    assert note and note.startswith("AI Job Search rank: 82/100 (Strong Fit)")
    assert "Gaps: No Kubernetes" in note
    assert service.read_version(ajs_root) == "1.2.7"
    assert service.tracker_status("No Response") == "no_response"  # legacy spelling


def test_import_is_read_only_deduplicated_and_tracks_applications(
    db: Session, settings: Settings, ajs_root: Path
) -> None:
    settings = settings.model_copy(update={"ai_job_search_path": ajs_root})
    before = {p: p.read_bytes() for p in ajs_root.rglob("*") if p.is_file()}
    # Already in the app from another source: merged, not added again.
    existing = ingest_job(db, JobInput(title="Laravel Developer", company_name="Beta Labs",
                                       origin="manual")).job

    first = service.import_jobs(db, settings)
    stats = first["stats"]
    assert (stats["created"], stats["merged"], stats["applications"]) == (3, 1, 2)
    assert stats["vetoed"] == 1 and stats["ranked"] == 2

    jobs = {j.title: j for j in db.scalars(select(Job))}
    assert len(jobs) == 4 and jobs["Laravel Developer"].id == existing.id
    lead = jobs["PHP Lead"]
    assert lead.status == "APPLIED" and "ai_job_search" in lead.added_via
    assert "AI Job Search rank: 82/100" in (lead.notes or "")
    assert jobs["Backend Developer"].status == "NOT_RELEVANT"  # failed its language check
    assert jobs["Magento Architect"].status == "INTERVIEW"
    apps = {a.job_id: a for a in db.scalars(select(Application))}
    assert apps[lead.id].status == "APPLIED" and str(apps[lead.id].applied_on) == "2026-10-21"

    again = service.import_jobs(db, settings)["stats"]
    assert (again["created"], again["merged"], again["applications"]) == (0, 4, 0)
    assert db.scalar(select(Job.id).where(Job.title == "PHP Lead")) == lead.id
    assert {p: p.read_bytes() for p in ajs_root.rglob("*") if p.is_file()} == before

    # A job the user deleted is not brought back.
    delete_job(db, jobs["Laravel Developer"].id)
    assert service.import_jobs(db, settings)["stats"]["deleted_skipped"] == 1


def test_auto_import_runs_only_when_files_change(
    db: Session, settings: Settings, ajs_root: Path
) -> None:
    settings = settings.model_copy(update={"ai_job_search_path": ajs_root})
    assert service.scheduled_tick(db, settings) is False  # off by default
    service.save_settings(db, {"auto_import": True})
    assert service.scheduled_tick(db, settings) is True
    assert service.scheduled_tick(db, settings) is False  # nothing changed
    with (ajs_root / "job_search_tracker.csv").open("a") as fh:
        fh.write("2026-10-22,Theta,IT,PHP Developer,full-time,Naukri,applied,,60,,,,,\n")
    assert service.scheduled_tick(db, settings) is True
    assert db.scalar(select(Job.status).where(Job.title == "PHP Developer")) == "APPLIED"


def test_api(client: TestClient, settings: Settings, ajs_root: Path) -> None:
    off = client.get("/api/v1/ai-job-search/status").json()
    assert off["configured"] is False and off["available"] is False
    assert client.post("/api/v1/ai-job-search/import").status_code == 422

    from app.core.config import get_settings

    configured = settings.model_copy(update={"ai_job_search_path": ajs_root})
    client.app.dependency_overrides[get_settings] = lambda: configured  # type: ignore[attr-defined]
    on = client.get("/api/v1/ai-job-search/status").json()
    assert on["available"] and on["version"] == "1.2.7" and on["changed_since_import"]
    assert on["counts"] == {"seen": 5, "new": 1, "ranked": 2, "skipped": 1, "tracker": 2}
    done = client.post("/api/v1/ai-job-search/import").json()
    assert done["stats"]["created"] == 4
    assert client.get("/api/v1/jobs", params={"added_via": "ai_job_search"}).json()["total"] == 4
    status = client.get("/api/v1/ai-job-search/status").json()
    assert status["last_import"]["stats"]["created"] == 4 and not status["changed_since_import"]
    assert client.put("/api/v1/ai-job-search/settings",
                      json={"auto_import": True}).json() == {"auto_import": True}


def test_location_setting(database_url: str) -> None:
    # Blank means "not set" (in a real install it then falls back to ai-job-search/ if present).
    s = Settings(_env_file=None, database_url=database_url, ai_job_search_path="",
                 environment="test")
    assert s.ai_job_search_path is None
    s = Settings(_env_file=None, database_url=database_url, ai_job_search_path="../ai-job-search")
    assert s.ai_job_search_path is not None and s.ai_job_search_path.is_absolute()

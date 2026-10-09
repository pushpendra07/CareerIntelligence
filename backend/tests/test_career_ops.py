import hashlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.integrations.career_ops import readers, runner, service
from app.models.job import Job

REPORT = """# Evaluation: Acme Commerce — Adobe Commerce Technical Lead

**Date:** 2026-10-01
**URL:** https://jobs.smartrecruiters.com/Acme/7440001-adobe-commerce-technical-lead
**Archetype:** Adobe Commerce Technical Lead
**Score:** 4.3/5
**Legitimacy:** High Confidence
**Work Auth:** ➖ Not needed

---

## Machine Summary

```yaml
company: "Acme Commerce"
role: "Adobe Commerce Technical Lead"
score: 4.3
final_decision: "Apply"
hard_stops: []
soft_gaps:
  - "AWS not on CV"
```

## A) Role Summary
Text.

## Job Description (archived verbatim)
Posted: 2026-09-20
Technical Lead for Adobe Commerce. 10+ years. PHP, Magento 2, MySQL, GraphQL, AWS.
Location: Bengaluru (Hybrid)
"""

OLD_REPORT = """# Evaluation: Beta Labs — Senior Magento Engineer

**Date:** 2026-09-06
**URL:** https://jobs.ashbyhq.com/beta/71f67615-9c0c-4ca1-9115-6044f05bf89b
**Score:** 3.8/5
**Legitimacy:** Proceed with Caution

## Machine Summary

```yaml
company: "Beta Labs"
role: "Senior Magento Engineer"
score: 3.8
final_decision: "Consider"
```
"""


def make_career_ops(root: Path) -> Path:
    (root / "data").mkdir(parents=True)
    (root / "reports").mkdir()
    (root / "jds").mkdir()
    (root / "VERSION").write_text("1.32.0 # x-release-please-version\n")
    (root / "reports" / "001-acme-commerce-2026-10-01.md").write_text(REPORT)
    (root / "reports" / "002-beta-labs-2026-09-06.md").write_text(OLD_REPORT)
    (root / "jds" / "beta-labs-senior-magento-engineer.md").write_text(
        "Senior Magento Engineer at Beta Labs. Magento 2, PHP, GraphQL. Remote."
    )
    (root / "data" / "applications.md").write_text(
        "# Applications Tracker\n\n"
        "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n"
        "|---|------|---------|------|-------|--------|-----|--------|-------|\n"
        "| 1 | 2026-10-01 | Acme Commerce | Adobe Commerce Technical Lead | 4.3/5 | Applied "
        "| ✅ | [001](../reports/001-acme-commerce-2026-10-01.md) | applied via site |\n"
        "| 2 | 2026-09-06 | Beta Labs | Senior Magento Engineer | 3.8/5 | Evaluated | ❌ "
        "| [002](../reports/002-beta-labs-2026-09-06.md) | contract |\n"
    )
    (root / "data" / "pipeline.md").write_text(
        "# Pipeline\n\n## Pending\n\n"
        "- [ ] https://jobs.lever.co/gamma/11111111-2222-3333-4444-555555555555 | Gamma | "
        "Senior PHP Developer | Remote (India) | 2500000 INR | posted: 2026-09-28\n\n"
        "## Processed\n\n"
        "- [x] #001 | https://jobs.smartrecruiters.com/Acme/7440001-adobe-commerce-technical-lead"
        " | Acme Commerce | Adobe Commerce Technical Lead | 4.3/5 | PDF ✅\n"
        "- [x] ~~https://old.example/jobs/1 | Old Co | Gone Role~~ — posting expired\n"
        "- [x] #-- | https://skip.example/jobs/2 | skipped (pre-screen mismatch: Java)\n"
    )
    # Older 12-column scan history (no requisition_id/language columns).
    (root / "data" / "scan-history.tsv").write_text(
        "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tfingerprint\tposted_at\t"
        "trust_score\ttrust_flags\tnormalized_company\n"
        "https://jobs.lever.co/gamma/11111111-2222-3333-4444-555555555555\t2026-09-29\t"
        "lever-api\tSenior PHP Developer\tGamma\tadded\tRemote - India\tabc\t2026-09-28\t\t\t"
        "gamma\n"
        "https://x.example/jobs/9\t2026-09-29\tlever-api\tJava Dev\tX\tskipped_title\t\t\t\t"
        "\t\tx\n"
    )
    return root


def snapshot(root: Path) -> dict[str, str]:
    return {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


@pytest.fixture
def co_root(tmp_path: Path) -> Path:
    return make_career_ops(tmp_path / "careerops")


def test_readers(co_root: Path) -> None:
    rows = readers.read_scan_history(co_root / "data" / "scan-history.tsv")
    assert len(rows) == 2 and rows[0]["requisition_id"] == ""  # short rows tolerated
    items = readers.read_pipeline(co_root / "data" / "pipeline.md")
    assert [i.state for i in items] == ["PENDING", "PROCESSED", "EXPIRED", "SKIPPED"]
    assert items[0].salary == "2500000 INR" and items[0].location == "Remote (India)"
    report = readers.read_report(co_root / "reports" / "001-acme-commerce-2026-10-01.md")
    assert report.score == 4.3 and report.machine_summary["final_decision"] == "Apply"
    assert report.jd_text and report.jd_text.startswith("Posted: 2026-09-20")
    old = readers.read_report(co_root / "reports" / "002-beta-labs-2026-09-06.md")
    capture = readers.find_jd_capture(co_root, old)
    assert capture and capture[0] == "jds/beta-labs-senior-magento-engineer.md"
    tracker = readers.read_tracker(co_root / "data" / "applications.md")
    assert tracker[0].status == "Applied" and tracker[0].report_num == "001"


def test_import_is_read_only_idempotent_and_preserves_evaluation(
    co_root: Path, db: Session, settings: Settings
) -> None:
    settings = settings.model_copy(update={"career_ops_path": co_root})
    before = snapshot(co_root)
    run = service.import_from_career_ops(db, settings)
    assert snapshot(co_root) == before  # Career-Ops files never modified
    assert run.status == "COMPLETED"
    assert run.stats["records"] == 3
    assert (
        run.stats["created"],
        run.stats["pipeline_expired"],
        run.stats["pipeline_skipped"],
        run.stats["scan_not_added"],
    ) == (3, 1, 1, 1)

    acme = db.query(Job).filter(Job.title == "Adobe Commerce Technical Lead").one()
    assert float(acme.career_ops_score or 0) == 4.3
    assert acme.career_ops_report == "reports/001-acme-commerce-2026-10-01.md"
    assert acme.career_ops_evaluation["machine_summary"]["final_decision"] == "Apply"
    assert acme.career_ops_status == "Applied"
    assert acme.status == "APPLIED"  # initial status from the tracker
    assert acme.match_score is not None  # independently scored 0-100
    assert acme.source == "CAREER_OPS"
    assert "SMARTRECRUITERS" in (acme.source_links[0].detail or "")
    assert "Magento 2" in acme.required_skills  # JD came from the report

    beta = db.query(Job).filter(Job.title == "Senior Magento Engineer").one()
    assert beta.original_jd.startswith("Senior Magento Engineer at Beta Labs")
    assert beta.status == "REVIEWING"
    gamma = db.query(Job).filter(Job.title == "Senior PHP Developer").one()
    assert gamma.status == "DISCOVERED" and float(gamma.salary_max or 0) == 2500000
    assert gamma.jd_status == "MISSING"
    assert gamma.source_links[0].raw["career_ops"]["portal"] == "lever-api"

    again = service.import_from_career_ops(db, settings)
    assert again.stats["created"] == 0 and again.stats["merged"] == 3
    assert db.query(Job).count() == 3


def test_manual_entry_of_imported_job_is_deduplicated(
    co_root: Path, db: Session, settings: Settings, client: TestClient
) -> None:
    service.import_from_career_ops(db, settings.model_copy(update={"career_ops_path": co_root}))
    r = client.post(
        "/api/v1/jobs",
        json={
            "title": "Adobe Commerce Technical Lead",
            "company": "Acme Commerce",
            "url": "https://www.naukri.com/job-listings-acme-tech-lead-100000000001",
            "location": "Bengaluru",
            "jd": "Same role posted on Naukri.",
        },
    ).json()
    assert r["created"] is False
    assert set(r["job"]["sources"]) == {"CAREER_OPS", "NAUKRI"}
    assert r["job"]["career_ops"]["sources"]  # Career-Ops provenance kept


def test_api_status_import_and_disabled_scan(
    co_root: Path, client: TestClient, settings: Settings
) -> None:
    from app.core.config import get_settings

    configured = settings.model_copy(update={"career_ops_path": co_root})
    client.app.dependency_overrides[get_settings] = lambda: configured  # type: ignore[attr-defined]
    st = client.get("/api/v1/career-ops/status").json()
    assert st["version"] == "1.32.0" and st["counts"]["pipeline_pending"] == 1
    assert st["counts"]["reports"] == 2
    run = client.post("/api/v1/career-ops/import").json()
    assert run["stats"]["created"] == 3
    assert client.get("/api/v1/career-ops/imports").json()[0]["id"] == run["id"]
    assert client.post("/api/v1/career-ops/sync").status_code == 422  # scan is opt-in
    listed = client.get("/api/v1/jobs", params={"source": "CAREER_OPS"}).json()
    assert listed["total"] == 3


def test_unconfigured(client: TestClient) -> None:
    assert client.get("/api/v1/career-ops/status").json()["configured"] is False
    assert client.post("/api/v1/career-ops/import").status_code == 422


def test_runner_guards(co_root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(runner.RunnerError, match="http"):
        runner.fetch_jd(co_root, "file:///etc/passwd")
    monkeypatch.setattr(runner, "node_binary", lambda: None)
    with pytest.raises(runner.RunnerError, match="Node.js"):
        runner.run_scan(co_root)


def test_blank_env_values_mean_unset(database_url: str) -> None:
    s = Settings(  # type: ignore[call-arg]
        _env_file=None, database_url=database_url, career_ops_path="/x/careerops",
        career_ops_data_path="", ai_api_key=" ",
    )
    assert s.career_ops_data_path is None and s.ai_api_key is None
    assert s.career_ops_data_root == Path("/x/careerops")  # not "." (the backend folder)


def test_sync_runs_scan_then_import_and_one_at_a_time(
    co_root: Path, client: TestClient, settings: Settings, db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.config import get_settings
    from app.models.career_ops import CareerOpsImport

    enabled = settings.model_copy(update={"career_ops_path": co_root,
                                          "career_ops_scan_enabled": True})
    client.app.dependency_overrides[get_settings] = lambda: enabled  # type: ignore[attr-defined]
    monkeypatch.setattr(runner, "run_scan", lambda root, timeout=0: {"new_added": 0})
    run = client.post("/api/v1/career-ops/sync", params={"wait": True}).json()
    assert run["status"] == "COMPLETED" and run["scan_triggered"] is True
    assert run["scan_receipt"] == {"new_added": 0} and run["stats"]["created"] == 3

    busy = service.new_run(db, enabled, scan=True)  # an import still in progress
    db.commit()
    assert client.get("/api/v1/career-ops/status").json()["running"]["id"] == busy.id
    assert client.post("/api/v1/career-ops/sync").status_code == 409
    assert db.get(CareerOpsImport, busy.id) is not None

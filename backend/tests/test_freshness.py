from sqlalchemy.orm import Session

from app.services import freshness
from app.services.job_service import JobInput, ingest_job


def test_refresh_reparses_old_catalog_jobs_and_rescores(db: Session) -> None:
    job = ingest_job(
        db,
        JobInput(
            title="CMS Developer",
            company_name="Delta",
            url="https://delta.example/jobs/1",
            jd_text="Drupal 10 and PHP required.",
            origin="import",
        ),
    ).job
    # Simulate a job parsed before Drupal was in the skill catalog.
    job.parsed_jd = {**job.parsed_jd, "catalog_version": "skills/1"}
    job.required_skills = ["PHP"]
    db.commit()
    assert freshness.outdated_count(db) == 1

    stats = freshness.refresh(db)

    db.refresh(job)
    assert stats["reparsed"] == 1 and stats["rescored"] >= 1
    assert "Drupal" in job.required_skills
    assert job.score_stale is False and job.match_score is not None
    assert freshness.outdated_count(db) == 0
    assert freshness.refresh(db) == {"reparsed": 0, "rescored": 0, "skipped": 0}


def test_refresh_skips_while_another_runs(db: Session) -> None:
    with freshness._lock:
        assert freshness.is_running()
        assert freshness.refresh(db)["skipped"] == 1

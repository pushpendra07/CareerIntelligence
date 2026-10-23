from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.job import JobStatus
from app.services.job_service import JobInput, ingest_job
from app.services.search_suggestions import _core_title


def add(db: Session, n: int, title: str, skills: list[str], status: JobStatus) -> None:
    for i in range(n):
        ingest_job(db, JobInput(title=title, company_name=f"{title} Co {i}", required_skills=skills,
                                url=f"https://s.example/{title.replace(' ', '-')}/{i}",
                                status=status, origin="import"))


def test_core_title() -> None:
    assert _core_title("Sr. Magento Developer - Pune (Remote)") == "Magento Developer"
    assert _core_title("Lead PHP Engineer, Bengaluru") == "PHP Engineer"
    assert _core_title("Technical Lead - Magento") == "Technical Lead"


def test_suggestions_learn_from_what_you_did(client: TestClient, db: Session) -> None:
    add(db, 3, "Senior Magento Developer", ["Magento", "PHP"], JobStatus.APPLIED)
    add(db, 2, "Magento Developer - Pune", ["Magento", "GraphQL"], JobStatus.SHORTLISTED)
    add(db, 4, "Java Developer", ["Java", "Spring", "PHP"], JobStatus.NOT_RELEVANT)
    add(db, 3, "Sales Executive", [], JobStatus.IGNORED)
    add(db, 3, "Solution Architect", [], JobStatus.NOT_RELEVANT)
    add(db, 2, "Magento Developer", ["Magento"], JobStatus.NEW)  # not decided yet: not used

    r = client.get("/api/v1/preferences/suggestions").json()
    assert r["based_on"] == {"went_for": 5, "turned_down": 10}
    assert r["target_titles"][0] == {"value": "Magento Developer", "count": 5}
    assert [s["value"] for s in r["required_skills"]][:2] == ["Magento", "PHP"]
    ignored = [s["value"] for s in r["excluded_technologies"]]
    assert "Java" in ignored and "Spring" in ignored
    assert "PHP" not in ignored  # in jobs you applied to as well
    # Java is a skill (shown there); "Solution" comes as the phrase it's used in.
    assert sorted(s["value"] for s in r["excluded_roles"]) == ["Sales", "Solution Architect"]

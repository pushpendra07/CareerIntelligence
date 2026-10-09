"""Deterministic interview preparation pack for a job (and optionally a specific round).

Built only from data the user owns: the job/JD, the match result, the professional profile
and the question bank. No AI is required; nothing is invented about the candidate.
"""

from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.interview import Interview, InterviewQuestion
from app.models.job import Job
from app.models.match import JobMatch
from app.services.profile_service import get_profile
from app.skills.catalog import ancestors, skill_category

ROUND_TOPICS: dict[str, list[str]] = {
    "RECRUITER_SCREEN": [
        "Career summary in 2 minutes",
        "Why this company / role",
        "Notice period, current and expected CTC",
        "Location / work model",
    ],
    "HR": [
        "Motivation for change",
        "Notice period and joining date",
        "Compensation",
        "Culture fit and team preferences",
    ],
    "TECHNICAL": [
        "Deep dive on required skills",
        "Past architecture decisions",
        "Debugging and performance stories",
    ],
    "CODING": [
        "Data structures and algorithms basics",
        "Clean, testable code",
        "Language-specific idioms",
    ],
    "SYSTEM_DESIGN": [
        "Scalability (caching, queues, indexing)",
        "Integration design (ERP, payments)",
        "Failure handling, retries, idempotency",
        "Trade-offs and capacity estimates",
    ],
    "MANAGERIAL": [
        "Leading and mentoring a team",
        "Estimation and delivery",
        "Stakeholder management",
        "Handling conflict and escalations",
    ],
    "CLIENT": [
        "Explaining technical decisions to non-technical stakeholders",
        "Requirement clarification",
        "Delivery commitments",
    ],
    "FINAL": ["Leadership and ownership stories", "Long-term goals", "Questions for leadership"],
    "OFFER_HR": [
        "Compensation breakdown (fixed, variable, benefits)",
        "Joining date",
        "Notice buyout",
        "Policies (remote, leave, appraisal cycle)",
    ],
}

TECH_TOPICS: dict[str, list[str]] = {
    "Magento 2": [
        "Module structure, DI, plugins vs observers vs preferences",
        "EAV and indexers",
        "Service contracts and repositories",
        "Checkout customization",
    ],
    "Adobe Commerce": [
        "B2B features, staging, content",
        "Cloud deployment (ece-tools)",
        "Adobe Commerce vs Open Source differences",
    ],
    "Adobe Commerce Cloud": ["ece-tools, environments, Fastly", "Deployment pipeline and hooks"],
    "PHP": ["PHP 8 features, typing", "SOLID and design patterns", "Performance profiling"],
    "MySQL": ["Indexing and query plans", "Transactions and locking", "Slow query analysis"],
    "GraphQL": ["Schema extension and resolvers", "Caching GraphQL", "N+1 avoidance"],
    "REST": ["API design, versioning, auth", "Idempotency and error handling"],
    "Redis": ["Cache vs session storage", "Eviction policies"],
    "RabbitMQ": ["Consumers, retries, dead-lettering", "Magento message queues"],
    "AWS": ["Core services (EC2, S3, RDS, CloudFront)", "Hosting Magento on AWS"],
    "Docker": ["Images, layers, compose for local Magento"],
    "Kubernetes": ["Deployments, services, scaling basics"],
    "Elasticsearch": ["Indexing catalog data", "Relevance tuning"],
    "Varnish": ["Full-page cache, hole punching, ESI"],
    "Hyvä": ["Hyvä theme architecture, Alpine.js, Tailwind"],
    "System Design": ["High-traffic commerce architecture", "Integration patterns"],
}

QUESTIONS_TO_ASK = [
    "What does the team look like (size, seniority, roles) and who would I work with daily?",
    "What are the biggest technical challenges on the platform in the next 6-12 months?",
    "How do you deploy, test and monitor releases?",
    "How is success measured for this role in the first 90 days?",
    "What does the interview process look like from here?",
]


def _profile_projects(
    profile_projects: list[dict[str, Any]], skills: set[str]
) -> list[dict[str, Any]]:
    expanded = skills | {a for s in skills for a in ancestors(s)}
    scored = []
    for p in profile_projects:
        overlap = sorted(set(p.get("skills", [])) & expanded)
        if overlap:
            scored.append((len(overlap), p, overlap))
    scored.sort(key=lambda x: (-x[0], x[1].get("name", "")))
    return [
        {
            "name": p.get("name"),
            "platform": p.get("platform"),
            "relevant_skills": ov,
            "highlights": p.get("highlights", [])[:2],
        }
        for _, p, ov in scored[:4]
    ]


def build_prep(db: Session, job: Job, interview: Interview | None = None) -> dict[str, Any]:
    profile = get_profile(db)
    match = db.get(JobMatch, job.current_match_id) if job.current_match_id else None
    result = match.result if match else {}
    skill_rows = result.get("skills", [])
    matched = [s["skill"] for s in skill_rows if s["match"] == "EXACT_MATCH"]
    partial = [s["skill"] for s in skill_rows if s["match"] in ("PARTIAL_MATCH", "RELATED")]
    missing = [s["skill"] for s in skill_rows if s["match"] in ("MISSING", "NICE_TO_HAVE")]
    job_skills = [*job.required_skills, *job.preferred_skills]

    round_type = interview.round_type if interview else None
    topics: list[str] = list(ROUND_TOPICS.get(round_type or "TECHNICAL", []))
    for s in [*missing, *partial, *job.required_skills]:
        for t in TECH_TOPICS.get(s, []):
            if t not in topics:
                topics.append(f"{s}: {t}")
    if interview and interview.topics:
        topics = list(dict.fromkeys([*interview.topics, *topics]))

    tech_skills = [s for s in job_skills if skill_category(s) not in ("leadership", "practice")]
    q_stmt = (
        select(InterviewQuestion)
        .where(
            or_(
                InterviewQuestion.technology.in_(tech_skills or [""]),
                InterviewQuestion.company_id == job.company_id,
                InterviewQuestion.job_id == job.id,
                *([InterviewQuestion.round_type == round_type] if round_type else []),
            )
        )
        .order_by(InterviewQuestion.confidence.asc().nulls_first(), InterviewQuestion.id)
        .limit(25)
    )
    questions = [
        {
            "id": q.id,
            "question": q.question,
            "category": q.category,
            "technology": q.technology,
            "difficulty": q.difficulty,
            "confidence": q.confidence,
            "has_my_answer": bool(q.my_answer),
        }
        for q in db.scalars(q_stmt)
    ]

    projects = _profile_projects(list(profile.projects), set(job_skills))
    behavioral = [
        "Tell me about yourself (2 minutes, end with why this role)",
        "A project you are proudest of — your specific contribution and measurable impact",
        "A production incident you handled — detection, fix, prevention",
        "A disagreement with a stakeholder or teammate and how it was resolved",
    ]
    if profile.leadership or (
        result.get("components") and job.parsed_jd.get("leadership_required")
    ):
        behavioral += [
            "How you mentor developers and run code reviews",
            "How you estimate, plan and protect delivery dates",
        ]
    asks = list(QUESTIONS_TO_ASK)
    for b in result.get("blockers", []):
        asks.append(f"Clarify: {b['message']}")
    if job.work_model in ("HYBRID", "ONSITE"):
        asks.append("How many office days are expected, and is there flexibility?")
    if job.salary_min is None and job.salary_max is None:
        asks.append("What is the budgeted compensation range for this role?")

    return {
        "job": {
            "id": job.id,
            "title": job.title,
            "company": job.company.name,
            "match_score": job.match_score,
            "recommendation": job.recommendation,
        },
        "interview": None
        if interview is None
        else {
            "id": interview.id,
            "round_number": interview.round_number,
            "round_type": interview.round_type,
            "scheduled_at": interview.scheduled_at,
        },
        "job_requirements": {
            "responsibilities": job.responsibilities,
            "required_skills": job.required_skills,
            "preferred_skills": job.preferred_skills,
            "qualifications": job.qualifications,
            "experience_min": float(job.experience_min) if job.experience_min else None,
        },
        "matched_skills": matched,
        "partial_skills": partial,
        "missing_skills": missing,
        "likely_topics": topics[:25],
        "relevant_questions": questions,
        "cv_highlights": {
            "summary": profile.summary,
            "achievements": list(profile.achievements)[:5],
            "certifications": list(profile.certifications),
            "total_experience_years": float(profile.total_experience_years)
            if profile.total_experience_years is not None
            else None,
        },
        "projects_to_discuss": projects,
        "technical_preparation": [
            f"{s}: {', '.join(TECH_TOPICS.get(s, ['review fundamentals and one real example']))}"
            for s in [*missing, *partial]
        ][:12],
        "behavioral_preparation": behavioral,
        "questions_to_ask": asks,
        "generated_with": "deterministic/1",
    }

"""Import every model here so Alembic autogenerate sees the full metadata."""

from app.models.activity_log import ActivityLog
from app.models.app_settings import AppSettings
from app.models.application import Application, ApplicationEvent, FollowUp
from app.models.career_ops import CareerOpsImport
from app.models.company import Company, CompanyFieldSource, Contact
from app.models.cv import CV, CVVersion
from app.models.interview import Interview, InterviewQuestion
from app.models.job import DeletedJob, Job, JobSourceLink
from app.models.match import JobMatch, ScoringConfigRow
from app.models.offer import Offer
from app.models.profile import ProfessionalProfile, TargetProfile
from app.models.scan import ScanRun
from app.models.sheet import SavedSheet

__all__ = [
    "CV",
    "ActivityLog",
    "AppSettings",
    "Application",
    "ApplicationEvent",
    "FollowUp",
    "Interview",
    "InterviewQuestion",
    "CVVersion",
    "CareerOpsImport",
    "Company",
    "CompanyFieldSource",
    "Contact",
    "DeletedJob",
    "Job",
    "JobMatch",
    "JobSourceLink",
    "Offer",
    "ProfessionalProfile",
    "SavedSheet",
    "ScanRun",
    "ScoringConfigRow",
    "TargetProfile",
]

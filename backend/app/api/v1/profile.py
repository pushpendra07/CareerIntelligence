from fastapi import APIRouter

from app.api.deps import DB
from app.schemas.profile import (
    ImportFromCV,
    ProfessionalProfileOut,
    ProfessionalProfileUpdate,
    TargetProfileOut,
    TargetProfileUpdate,
)
from app.services import profile_service

router = APIRouter(tags=["profile"])


@router.get("/profile", response_model=ProfessionalProfileOut)
def get_profile(db: DB) -> ProfessionalProfileOut:
    return ProfessionalProfileOut.model_validate(profile_service.get_profile(db))


@router.patch("/profile", response_model=ProfessionalProfileOut)
def update_profile(db: DB, body: ProfessionalProfileUpdate) -> ProfessionalProfileOut:
    profile = profile_service.update_profile(db, body.model_dump(exclude_unset=True))
    return ProfessionalProfileOut.model_validate(profile)


@router.post("/profile/import-cv", response_model=ProfessionalProfileOut)
def import_cv(db: DB, body: ImportFromCV) -> ProfessionalProfileOut:
    profile = profile_service.import_from_cv(db, body.cv_version_id, body.mode)
    return ProfessionalProfileOut.model_validate(profile)


def _target_out(db: DB) -> TargetProfileOut:
    target = profile_service.get_target(db)
    out = TargetProfileOut.model_validate(target)
    out.effective_titles = profile_service.effective_titles(target)
    return out


@router.get("/preferences", response_model=TargetProfileOut)
def get_preferences(db: DB) -> TargetProfileOut:
    return _target_out(db)


@router.patch("/preferences", response_model=TargetProfileOut)
def update_preferences(db: DB, body: TargetProfileUpdate) -> TargetProfileOut:
    profile_service.update_target(db, body.model_dump(exclude_unset=True))
    return _target_out(db)

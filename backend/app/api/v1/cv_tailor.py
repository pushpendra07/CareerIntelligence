from typing import Annotated, Any

from fastapi import APIRouter, File, Form, UploadFile

from app.api.deps import DB, AppSettings
from app.services import cv_tailor

router = APIRouter(tags=["jobs"])


@router.post("/jobs/{job_id}/cv-check")
async def cv_check(db: DB, settings: AppSettings, job_id: int,
                   file: Annotated[UploadFile, File()]) -> dict[str, Any]:
    """ATS score of an uploaded CV for this job, and each job keyword: found, implied by a
    more specific skill, related, or missing. The CV is not saved."""
    data = await file.read(settings.max_upload_bytes + 1)
    return cv_tailor.check(db, job_id, file.filename or "cv", data, settings.max_upload_bytes)


@router.post("/jobs/{job_id}/cv-tailor")
async def cv_tailor_build(
    db: DB,
    settings: AppSettings,
    job_id: int,
    file: Annotated[UploadFile, File()],
    add: Annotated[list[str] | None, Form()] = None,
    use_title: Annotated[bool, Form()] = False,
) -> dict[str, Any]:
    """A copy of the uploaded DOCX CV, same format, with the confirmed job skills added and the
    job's skills listed first; scores before and after. Returned in the response only: the CV
    is not saved."""
    data = await file.read(settings.max_upload_bytes + 1)
    return cv_tailor.build(db, job_id, file.filename or "cv.docx", data,
                           settings.max_upload_bytes, add or [], use_title)

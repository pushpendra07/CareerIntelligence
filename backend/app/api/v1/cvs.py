from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import Response

from app.api.deps import DB, AppSettings, FileStorage
from app.core.pagination import Page, PageParams, page_params
from app.models.cv import CV
from app.schemas.cv import CVComparison, CVOut, CVUpdate, CVVersionDetail, CVVersionSummary
from app.services import cv_service

router = APIRouter(prefix="/cvs", tags=["cvs"])


def _out(cv: CV) -> CVOut:
    out = CVOut.model_validate(cv)
    highlights = cv_service.cv_highlights(cv)
    out.top_skills = highlights["top_skills"]
    out.total_experience_years = highlights["total_experience_years"]
    return out


async def _read(upload: UploadFile, max_bytes: int) -> bytes:
    # Read one byte past the limit so oversize files are rejected without buffering them fully.
    return await upload.read(max_bytes + 1)


@router.post("", response_model=CVOut, status_code=201)
async def upload_cv(
    db: DB,
    storage: FileStorage,
    settings: AppSettings,
    file: Annotated[UploadFile, File()],
    name: Annotated[str, Form(min_length=1, max_length=200)],
    target_role: Annotated[str | None, Form(max_length=200)] = None,
    notes: Annotated[str | None, Form()] = None,
    label: Annotated[str | None, Form(max_length=200)] = None,
) -> CVOut:
    data = await _read(file, settings.max_upload_bytes)
    cv = cv_service.create_cv(
        db,
        storage,
        name=name,
        filename=file.filename or "upload",
        data=data,
        max_bytes=settings.max_upload_bytes,
        target_role=target_role,
        notes=notes,
        label=label,
    )
    return _out(cv)


@router.get("", response_model=Page[CVOut])
def list_cvs(
    db: DB,
    params: Annotated[PageParams, Depends(page_params)],
    include_archived: bool = False,
) -> Page[CVOut]:
    items, total = cv_service.list_cvs(db, params, include_archived)
    return Page(items=[_out(cv) for cv in items], total=total, page=params.page, size=params.size)


@router.get("/compare", response_model=CVComparison)
def compare(db: DB, left: Annotated[int, Query()], right: Annotated[int, Query()]) -> CVComparison:
    return cv_service.compare_versions(db, left, right)


@router.get("/{cv_id}", response_model=CVOut)
def get_cv(db: DB, cv_id: int) -> CVOut:
    return _out(cv_service.get_cv(db, cv_id))


@router.patch("/{cv_id}", response_model=CVOut)
def update_cv(db: DB, cv_id: int, body: CVUpdate) -> CVOut:
    return _out(cv_service.update_cv(db, cv_id, body.model_dump(exclude_unset=True)))


@router.post("/{cv_id}/activate", response_model=CVOut)
def activate(db: DB, cv_id: int) -> CVOut:
    return _out(cv_service.activate_cv(db, cv_id))


@router.post("/{cv_id}/versions", response_model=CVVersionSummary, status_code=201)
async def add_version(
    db: DB,
    storage: FileStorage,
    settings: AppSettings,
    cv_id: int,
    file: Annotated[UploadFile, File()],
    label: Annotated[str | None, Form(max_length=200)] = None,
) -> CVVersionSummary:
    data = await _read(file, settings.max_upload_bytes)
    version = cv_service.add_version(
        db,
        storage,
        cv_id,
        filename=file.filename or "upload",
        data=data,
        max_bytes=settings.max_upload_bytes,
        label=label,
    )
    return CVVersionSummary.model_validate(version)


@router.get("/{cv_id}/versions/{version_id}", response_model=CVVersionDetail)
def get_version(db: DB, cv_id: int, version_id: int) -> CVVersionDetail:
    return CVVersionDetail.model_validate(cv_service.get_version(db, cv_id, version_id))


@router.post("/{cv_id}/versions/{version_id}/reparse", response_model=CVVersionDetail)
def reparse(db: DB, storage: FileStorage, cv_id: int, version_id: int) -> CVVersionDetail:
    return CVVersionDetail.model_validate(
        cv_service.reparse_version(db, storage, cv_id, version_id)
    )


@router.get("/{cv_id}/versions/{version_id}/file")
def download(db: DB, storage: FileStorage, cv_id: int, version_id: int) -> Response:
    version = cv_service.get_version(db, cv_id, version_id)
    return Response(
        content=storage.get(version.storage_key),
        media_type=version.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{version.original_filename}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )

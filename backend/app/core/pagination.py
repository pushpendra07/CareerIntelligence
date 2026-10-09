"""Offset pagination shared by every list endpoint."""

from typing import Annotated

from fastapi import Query
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

MAX_PAGE_SIZE = 200


class PageParams(BaseModel):
    page: int = 1
    size: int = 50

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size


def page_params(
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
) -> PageParams:
    return PageParams(page=page, size=size)


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int
    size: int


def paginate[M](db: Session, stmt: Select[M], params: PageParams) -> tuple[list[M], int]:
    """Run `stmt` for one page and count the full result set."""
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = list(db.scalars(stmt.offset(params.offset).limit(params.size)))
    return rows, total

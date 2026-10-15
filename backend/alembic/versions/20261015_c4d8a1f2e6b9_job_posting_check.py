"""job_posting_check: result of the last "is this posting still open?" check

Revision ID: c4d8a1f2e6b9
Revises: b7e2c94d1a35
Create Date: 2026-10-15 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c4d8a1f2e6b9"
down_revision: str | None = "b7e2c94d1a35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("posting_check", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("jobs", "posting_check")

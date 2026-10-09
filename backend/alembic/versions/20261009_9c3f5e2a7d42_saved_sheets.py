"""saved google sheets

Revision ID: 9c3f5e2a7d42
Revises: 8b2e4d1f6c31
Create Date: 2026-10-09 16:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "9c3f5e2a7d42"
down_revision: str | None = "8b2e4d1f6c31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "saved_sheets",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("spreadsheet_id", sa.String(length=200), nullable=False),
        sa.Column("url", sa.String(length=2000), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
                  nullable=False),
        sa.Column("last_imported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("last_error", sa.String(length=1000), nullable=True),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_saved_sheets")),
        sa.UniqueConstraint("spreadsheet_id", name=op.f("uq_saved_sheets_spreadsheet_id")),
    )


def downgrade() -> None:
    op.drop_table("saved_sheets")

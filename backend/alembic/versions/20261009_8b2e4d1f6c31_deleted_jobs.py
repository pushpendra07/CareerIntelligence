"""deleted jobs (kept so imports and scans don't add them back)

Revision ID: 8b2e4d1f6c31
Revises: 7a1d3c9e5b20
Create Date: 2026-10-09 15:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "8b2e4d1f6c31"
down_revision: str | None = "7a1d3c9e5b20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "deleted_jobs",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("company_name", sa.String(length=300), nullable=False),
        sa.Column("title_key", sa.String(length=820), nullable=False),
        sa.Column("normalized_urls", postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("external_ids", postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
                  nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_deleted_jobs")),
    )
    op.create_index(op.f("ix_deleted_jobs_title_key"), "deleted_jobs", ["title_key"])
    op.create_index("ix_deleted_jobs_normalized_urls", "deleted_jobs", ["normalized_urls"],
                    postgresql_using="gin")
    op.create_index("ix_deleted_jobs_external_ids", "deleted_jobs", ["external_ids"],
                    postgresql_using="gin")


def downgrade() -> None:
    op.drop_table("deleted_jobs")

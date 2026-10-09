"""scan runs (built-in job scanner)

Revision ID: 7a1d3c9e5b20
Revises: 5c7724f3ec29
Create Date: 2026-10-09 13:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "7a1d3c9e5b20"
down_revision: str | None = "5c7724f3ec29"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scan_runs",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=20), server_default="SCAN", nullable=False),
        sa.Column("trigger", sa.String(length=20), server_default="manual", nullable=False),
        sa.Column("status", sa.String(length=20), server_default="RUNNING", nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
                  nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stats", postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("companies", postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_scan_runs")),
    )


def downgrade() -> None:
    op.drop_table("scan_runs")

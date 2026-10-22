"""email updates (Settings -> Email: job-search emails and the status they suggest)

Revision ID: b9c4e6f8a2d3
Revises: a8b3d5e7f9c1
Create Date: 2026-10-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b9c4e6f8a2d3"
down_revision: str | None = "a8b3d5e7f9c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "email_updates",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("message_id", sa.String(500), nullable=False, unique=True),
        sa.Column("received_at", sa.DateTime(timezone=True)),
        sa.Column("sender_name", sa.String(300), nullable=False, server_default=sa.text("''")),
        sa.Column("sender_email", sa.String(300), nullable=False, server_default=sa.text("''")),
        sa.Column("subject", sa.String(500), nullable=False, server_default=sa.text("''")),
        sa.Column("evidence", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("company_id", sa.BigInteger(),
                  sa.ForeignKey("companies.id", ondelete="SET NULL")),
        sa.Column("job_id", sa.BigInteger(), sa.ForeignKey("jobs.id", ondelete="SET NULL")),
        sa.Column("candidate_job_ids", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column("match_reason", sa.String(200), nullable=False, server_default=sa.text("''")),
        sa.Column("suggested_status", sa.String(30)),
        sa.Column("applied_status", sa.String(30)),
        sa.Column("state", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index("ix_email_updates_received_at", "email_updates", ["received_at"])
    op.create_index("ix_email_updates_company_id", "email_updates", ["company_id"])
    op.create_index("ix_email_updates_job_id", "email_updates", ["job_id"])
    op.create_index("ix_email_updates_state", "email_updates", ["state"])


def downgrade() -> None:
    op.drop_table("email_updates")

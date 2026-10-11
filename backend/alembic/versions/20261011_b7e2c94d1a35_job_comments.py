"""job_comments: dated comments the user writes on a job

Revision ID: b7e2c94d1a35
Revises: ad1e7b3c4f50
Create Date: 2026-10-11 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b7e2c94d1a35"
down_revision: str | None = "ad1e7b3c4f50"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "job_comments",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("job_id", sa.BigInteger(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
                  nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], name="fk_job_comments_job_id_jobs",
                                ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_job_comments"),
    )
    op.create_index("ix_job_comments_job_id", "job_comments", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_job_comments_job_id", table_name="job_comments")
    op.drop_table("job_comments")

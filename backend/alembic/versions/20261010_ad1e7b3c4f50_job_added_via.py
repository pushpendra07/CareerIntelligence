"""jobs.added_via: how each job came into the app (manual, sheet, scanner, career_ops, file)

Revision ID: ad1e7b3c4f50
Revises: 9c3f5e2a7d42
Create Date: 2026-10-10 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "ad1e7b3c4f50"
down_revision: str | None = "9c3f5e2a7d42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("added_via", postgresql.JSONB(astext_type=sa.Text()),
                                    server_default=sa.text("'[]'::jsonb"), nullable=False))
    op.create_index("ix_jobs_added_via", "jobs", ["added_via"], postgresql_using="gin")
    # Backfill from what each source record already holds: scanner/career_ops/import payloads;
    # imports whose label is a Google Sheet are "sheet", other imports "file"; no payload = manual.
    op.execute("""
        UPDATE jobs j SET added_via = sub.tags FROM (
            SELECT job_id, jsonb_agg(tag ORDER BY first_id) AS tags FROM (
                SELECT s.job_id, MIN(s.id) AS first_id,
                    CASE
                        WHEN s.raw ? 'scanner' THEN 'scanner'
                        WHEN s.raw ? 'career_ops' THEN 'career_ops'
                        WHEN s.raw ? 'import' AND (
                            s.detail ILIKE 'Google Sheet%'
                            OR EXISTS (SELECT 1 FROM saved_sheets ss
                                       WHERE s.detail LIKE ss.title || '%'))
                            THEN 'sheet'
                        WHEN s.raw ? 'import' THEN 'file'
                        ELSE 'manual'
                    END AS tag
                FROM job_sources s
                GROUP BY s.job_id, tag
            ) t GROUP BY job_id
        ) sub WHERE sub.job_id = j.id
    """)


def downgrade() -> None:
    op.drop_index("ix_jobs_added_via", table_name="jobs")
    op.drop_column("jobs", "added_via")

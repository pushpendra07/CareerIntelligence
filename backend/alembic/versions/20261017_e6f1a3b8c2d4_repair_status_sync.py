"""repair_status_sync: data fixes for job/application status drift (before the sync existed)

- applications follow their job's later status (Rejected, Interview…),
- follow-ups on rejected / closed / not relevant / withdrawn jobs are closed,
- job types spelled one way (FULL_TIME / Full time → Full-time).

Revision ID: e6f1a3b8c2d4
Revises: d5e9b2a7c3f1
Create Date: 2026-10-17 11:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e6f1a3b8c2d4"
down_revision: str | None = "d5e9b2a7c3f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def upgrade() -> None:
    # The latest application of a job whose status changed after the application's own.
    op.execute("""
        INSERT INTO application_events (application_id, event_type, from_status, to_status, note)
        SELECT a.id, 'STATUS_CHANGED', a.status, j.status, 'Matched to the job''s status'
        FROM applications a JOIN jobs j ON j.id = a.job_id
        WHERE a.id = (SELECT max(id) FROM applications WHERE job_id = j.id)
          AND a.status <> j.status
          AND j.status IN ('APPLIED', 'RECRUITER_CONTACTED', 'SCREENING', 'INTERVIEW',
                           'AWAITING_FEEDBACK', 'OFFER', 'ACCEPTED', 'REJECTED', 'WITHDRAWN',
                           'CLOSED')
          AND coalesce(j.status_changed_at, j.updated_at) >= a.updated_at
    """)
    op.execute("""
        UPDATE applications a SET status = j.status
        FROM jobs j
        WHERE j.id = a.job_id
          AND a.id = (SELECT max(id) FROM applications WHERE job_id = j.id)
          AND a.status <> j.status
          AND j.status IN ('APPLIED', 'RECRUITER_CONTACTED', 'SCREENING', 'INTERVIEW',
                           'AWAITING_FEEDBACK', 'OFFER', 'ACCEPTED', 'REJECTED', 'WITHDRAWN',
                           'CLOSED')
          AND coalesce(j.status_changed_at, j.updated_at) >= a.updated_at
    """)
    op.execute("""
        UPDATE followups f SET completed = true, completed_at = now()
        FROM jobs j
        WHERE j.id = f.job_id AND NOT f.completed
          AND j.status IN ('REJECTED', 'WITHDRAWN', 'CLOSED', 'NOT_RELEVANT')
    """)
    op.execute("""
        UPDATE jobs SET employment_type = 'Full-time'
        WHERE lower(regexp_replace(employment_type, '[^A-Za-z]', '', 'g')) = 'fulltime'
    """)
    op.execute("""
        UPDATE jobs SET employment_type = 'Part-time'
        WHERE lower(regexp_replace(employment_type, '[^A-Za-z]', '', 'g')) = 'parttime'
    """)


def downgrade() -> None:
    pass  # data repair: nothing to undo

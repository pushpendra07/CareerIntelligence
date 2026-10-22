"""company extra links (job-portal company pages: Naukri, LinkedIn, Monster, Foundit)

Revision ID: a8b3d5e7f9c1
Revises: f7a2c9d4e1b3
Create Date: 2026-10-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "a8b3d5e7f9c1"
down_revision: str | None = "f7a2c9d4e1b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("extra_links", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column("companies", "extra_links")

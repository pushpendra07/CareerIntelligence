"""reminder events (Settings -> Reminders)

Revision ID: f7a2c9d4e1b3
Revises: e6f1a3b8c2d4
Create Date: 2026-10-18
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f7a2c9d4e1b3"
down_revision: str | None = "e6f1a3b8c2d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reminder_events",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("rule_id", sa.String(40), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("url", sa.String(300), nullable=False, server_default=sa.text("'/'")),
        sa.Column("test", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index("ix_reminder_events_created_at", "reminder_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_reminder_events_created_at", table_name="reminder_events")
    op.drop_table("reminder_events")

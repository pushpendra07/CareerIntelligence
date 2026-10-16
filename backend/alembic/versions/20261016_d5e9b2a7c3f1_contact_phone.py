"""contact_phone: recruiters' phone / WhatsApp number (found in job notes or entered)

Revision ID: d5e9b2a7c3f1
Revises: c4d8a1f2e6b9
Create Date: 2026-10-16 21:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d5e9b2a7c3f1"
down_revision: str | None = "c4d8a1f2e6b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("contacts", sa.Column("phone", sa.String(40), nullable=True))
    op.create_index("ix_contacts_phone", "contacts", ["phone"])


def downgrade() -> None:
    op.drop_index("ix_contacts_phone", table_name="contacts")
    op.drop_column("contacts", "phone")

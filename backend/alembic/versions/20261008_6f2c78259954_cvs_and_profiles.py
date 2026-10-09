"""cvs and profiles

Revision ID: 6f2c78259954
Revises: f9920c8a6259
Create Date: 2026-10-08 23:20:37.622752
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "6f2c78259954"
down_revision: str | None = "f9920c8a6259"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cvs",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("target_role", sa.String(length=200), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_archived", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("current_version_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cvs")),
    )
    op.create_index(
        "uq_cvs_single_active",
        "cvs",
        ["is_active"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )
    op.create_table(
        "target_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column(
            "target_titles",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "include_architect_roles", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column(
            "required_skills",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "preferred_skills",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "preferred_domains",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "preferred_companies",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "preferred_locations",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("remote_ok", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("hybrid_ok", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("onsite_ok", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("min_experience_years", sa.Numeric(precision=4, scale=1), nullable=True),
        sa.Column("max_experience_years", sa.Numeric(precision=4, scale=1), nullable=True),
        sa.Column("min_salary", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("target_salary", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column(
            "salary_currency", sa.String(length=3), server_default=sa.text("'INR'"), nullable=False
        ),
        sa.Column(
            "employment_types",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("notice_period_days", sa.Integer(), nullable=True),
        sa.Column(
            "excluded_roles",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "excluded_technologies",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "excluded_industries",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_target_profiles")),
    )
    op.create_table(
        "cv_versions",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("cv_id", sa.BigInteger(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("file_ext", sa.String(length=12), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("storage_key", sa.String(length=300), nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=False),
        sa.Column("parsed", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("parser_version", sa.String(length=40), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["cv_id"], ["cvs.id"], name=op.f("fk_cv_versions_cv_id_cvs"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cv_versions")),
        sa.UniqueConstraint("cv_id", "version_number", name=op.f("uq_cv_versions_cv_id")),
    )
    op.create_index(op.f("ix_cv_versions_cv_id"), "cv_versions", ["cv_id"], unique=False)
    op.create_index(op.f("ix_cv_versions_sha256"), "cv_versions", ["sha256"], unique=False)
    op.create_foreign_key(
        op.f("fk_cvs_current_version_id_cv_versions"),
        "cvs",
        "cv_versions",
        ["current_version_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "professional_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("full_name", sa.String(length=200), nullable=True),
        sa.Column("headline", sa.String(length=300), nullable=True),
        sa.Column("email", sa.String(length=200), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("linkedin_url", sa.String(length=300), nullable=True),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("total_experience_years", sa.Numeric(precision=4, scale=1), nullable=True),
        sa.Column("relevant_experience_years", sa.Numeric(precision=4, scale=1), nullable=True),
        sa.Column("leadership_experience_years", sa.Numeric(precision=4, scale=1), nullable=True),
        sa.Column(
            "primary_roles",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "core_skills",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "additional_skills",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "skill_years",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "domains",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "leadership",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "companies",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "certifications",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "education",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "projects",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "achievements",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("source_cv_version_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["source_cv_version_id"],
            ["cv_versions.id"],
            name=op.f("fk_professional_profiles_source_cv_version_id_cv_versions"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_professional_profiles")),
    )


def downgrade() -> None:
    op.drop_table("professional_profiles")
    op.drop_index(op.f("ix_cv_versions_sha256"), table_name="cv_versions")
    op.drop_index(op.f("ix_cv_versions_cv_id"), table_name="cv_versions")
    op.drop_constraint(op.f("fk_cvs_current_version_id_cv_versions"), "cvs", type_="foreignkey")
    op.drop_table("cv_versions")
    op.drop_table("target_profiles")
    op.drop_index("uq_cvs_single_active", table_name="cvs", postgresql_where=sa.text("is_active"))
    op.drop_table("cvs")

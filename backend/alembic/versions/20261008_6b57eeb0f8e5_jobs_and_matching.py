"""jobs and matching

Revision ID: 6b57eeb0f8e5
Revises: ca4c4d80de77
Create Date: 2026-10-08 23:40:08.629676
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "6b57eeb0f8e5"
down_revision: str | None = "ca4c4d80de77"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scoring_configs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_scoring_configs")),
        sa.UniqueConstraint("version", name=op.f("uq_scoring_configs_version")),
    )
    op.create_index(
        "uq_scoring_configs_active",
        "scoring_configs",
        ["is_active"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )
    op.create_table(
        "jobs",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("company_id", sa.BigInteger(), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("normalized_title", sa.String(length=300), nullable=False),
        sa.Column("seniority", sa.String(length=20), nullable=True),
        sa.Column("source", sa.String(length=30), nullable=False),
        sa.Column("source_url", sa.String(length=2000), nullable=True),
        sa.Column("external_id", sa.String(length=200), nullable=True),
        sa.Column("location", sa.String(length=300), nullable=True),
        sa.Column(
            "locations",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("work_model", sa.String(length=10), server_default="UNKNOWN", nullable=False),
        sa.Column("employment_type", sa.String(length=40), nullable=True),
        sa.Column("experience_min", sa.Numeric(precision=4, scale=1), nullable=True),
        sa.Column("experience_max", sa.Numeric(precision=4, scale=1), nullable=True),
        sa.Column("salary_min", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("salary_max", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("salary_currency", sa.String(length=3), nullable=True),
        sa.Column("salary_text", sa.String(length=200), nullable=True),
        sa.Column("posting_date", sa.Date(), nullable=True),
        sa.Column("application_deadline", sa.Date(), nullable=True),
        sa.Column("original_jd", sa.Text(), server_default="", nullable=False),
        sa.Column("jd_status", sa.String(length=20), server_default="OK", nullable=False),
        sa.Column(
            "parsed_jd",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "responsibilities",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
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
            "qualifications",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "manual_fields",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=30), server_default="NEW", nullable=False),
        sa.Column("status_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recruiter_contact_id", sa.BigInteger(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("dedup_key", sa.String(length=400), nullable=False),
        sa.Column("match_score", sa.Integer(), nullable=True),
        sa.Column("recommendation", sa.String(length=30), nullable=True),
        sa.Column("score_version", sa.String(length=100), nullable=True),
        sa.Column("profile_version", sa.Integer(), nullable=True),
        sa.Column("target_version", sa.Integer(), nullable=True),
        sa.Column("config_version", sa.Integer(), nullable=True),
        sa.Column("analyzed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("score_stale", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("current_match_id", sa.BigInteger(), nullable=True),
        sa.Column("recommended_cv_id", sa.BigInteger(), nullable=True),
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
            ["company_id"],
            ["companies.id"],
            name=op.f("fk_jobs_company_id_companies"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recommended_cv_id"],
            ["cvs.id"],
            name=op.f("fk_jobs_recommended_cv_id_cvs"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["recruiter_contact_id"],
            ["contacts.id"],
            name=op.f("fk_jobs_recruiter_contact_id_contacts"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_jobs")),
    )
    op.create_index(op.f("ix_jobs_company_id"), "jobs", ["company_id"], unique=False)
    op.create_index(
        "ix_jobs_company_title", "jobs", ["company_id", "normalized_title"], unique=False
    )
    op.create_index(op.f("ix_jobs_dedup_key"), "jobs", ["dedup_key"], unique=False)
    op.create_index(op.f("ix_jobs_match_score"), "jobs", ["match_score"], unique=False)
    op.create_index(op.f("ix_jobs_normalized_title"), "jobs", ["normalized_title"], unique=False)
    op.create_index(op.f("ix_jobs_posting_date"), "jobs", ["posting_date"], unique=False)
    op.create_index(op.f("ix_jobs_recommendation"), "jobs", ["recommendation"], unique=False)
    op.create_index(
        "ix_jobs_required_skills", "jobs", ["required_skills"], unique=False, postgresql_using="gin"
    )
    op.create_index(op.f("ix_jobs_source"), "jobs", ["source"], unique=False)
    op.create_index(op.f("ix_jobs_status"), "jobs", ["status"], unique=False)
    op.create_index(op.f("ix_jobs_work_model"), "jobs", ["work_model"], unique=False)
    op.create_table(
        "job_matches",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("job_id", sa.BigInteger(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("recommendation", sa.String(length=30), nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("score_version", sa.String(length=100), nullable=False),
        sa.Column("profile_version", sa.Integer(), nullable=False),
        sa.Column("target_version", sa.Integer(), nullable=False),
        sa.Column("config_version", sa.Integer(), nullable=False),
        sa.Column("inputs_hash", sa.String(length=64), nullable=False),
        sa.Column("recommended_cv_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "analyzed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["job_id"], ["jobs.id"], name=op.f("fk_job_matches_job_id_jobs"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["recommended_cv_id"],
            ["cvs.id"],
            name=op.f("fk_job_matches_recommended_cv_id_cvs"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_job_matches")),
    )
    op.create_index(op.f("ix_job_matches_job_id"), "job_matches", ["job_id"], unique=False)
    op.create_foreign_key(
        op.f("fk_jobs_current_match_id_job_matches"),
        "jobs",
        "job_matches",
        ["current_match_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "job_sources",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("job_id", sa.BigInteger(), nullable=False),
        sa.Column("source", sa.String(length=30), nullable=False),
        sa.Column("original_url", sa.String(length=2000), nullable=True),
        sa.Column("normalized_url", sa.String(length=2000), nullable=True),
        sa.Column("external_id", sa.String(length=200), nullable=True),
        sa.Column("detail", sa.String(length=300), nullable=True),
        sa.Column(
            "raw",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "first_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["job_id"], ["jobs.id"], name=op.f("fk_job_sources_job_id_jobs"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_job_sources")),
    )
    op.create_index(op.f("ix_job_sources_job_id"), "job_sources", ["job_id"], unique=False)
    op.create_index(
        "uq_job_sources_external",
        "job_sources",
        ["source", "external_id"],
        unique=True,
        postgresql_where=sa.text("external_id IS NOT NULL"),
    )
    op.create_index(
        "uq_job_sources_normalized_url",
        "job_sources",
        ["normalized_url"],
        unique=True,
        postgresql_where=sa.text("normalized_url IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_job_sources_normalized_url",
        table_name="job_sources",
        postgresql_where=sa.text("normalized_url IS NOT NULL"),
    )
    op.drop_index(
        "uq_job_sources_external",
        table_name="job_sources",
        postgresql_where=sa.text("external_id IS NOT NULL"),
    )
    op.drop_index(op.f("ix_job_sources_job_id"), table_name="job_sources")
    op.drop_table("job_sources")
    op.drop_index(op.f("ix_job_matches_job_id"), table_name="job_matches")
    op.drop_constraint(op.f("fk_jobs_current_match_id_job_matches"), "jobs", type_="foreignkey")
    op.drop_table("job_matches")
    op.drop_index(op.f("ix_jobs_work_model"), table_name="jobs")
    op.drop_index(op.f("ix_jobs_status"), table_name="jobs")
    op.drop_index(op.f("ix_jobs_source"), table_name="jobs")
    op.drop_index("ix_jobs_required_skills", table_name="jobs", postgresql_using="gin")
    op.drop_index(op.f("ix_jobs_recommendation"), table_name="jobs")
    op.drop_index(op.f("ix_jobs_posting_date"), table_name="jobs")
    op.drop_index(op.f("ix_jobs_normalized_title"), table_name="jobs")
    op.drop_index(op.f("ix_jobs_match_score"), table_name="jobs")
    op.drop_index(op.f("ix_jobs_dedup_key"), table_name="jobs")
    op.drop_index("ix_jobs_company_title", table_name="jobs")
    op.drop_index(op.f("ix_jobs_company_id"), table_name="jobs")
    op.drop_table("jobs")
    op.drop_index(
        "uq_scoring_configs_active",
        table_name="scoring_configs",
        postgresql_where=sa.text("is_active"),
    )
    op.drop_table("scoring_configs")

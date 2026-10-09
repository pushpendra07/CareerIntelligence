from datetime import date

import pytest

from app.core.errors import DomainValidationError
from app.cv.extract import extract_text, normalize_text, safe_filename, validate_upload
from app.cv.parser import derive_roles, parse_cv
from app.skills.catalog import (
    ancestors,
    find_skills,
    normalize_skill,
    normalize_skill_list,
    related,
)
from tests.fixtures import SAMPLE_CV, make_docx, make_pdf

AS_OF = date(2026, 10, 1)


class TestCatalog:
    def test_longest_alias_wins(self) -> None:
        found = find_skills("Adobe Commerce Cloud and Magento 2 and plain Magento")
        assert found == {"Adobe Commerce Cloud": 1, "Magento 2": 1, "Magento": 1}

    def test_case_sensitive_aliases_avoid_common_words(self) -> None:
        assert find_skills("the rest of the team will react less. Go to the docs") == {}
        assert find_skills("REST APIs, React and LESS") == {"REST": 1, "React": 1, "LESS": 1}

    def test_normalize(self) -> None:
        assert normalize_skill("magento2") == "Magento 2"
        assert normalize_skill("ReactJS") == "React"
        assert normalize_skill("Postgres") == "PostgreSQL"
        assert normalize_skill("Underwater basket weaving") is None
        assert normalize_skill_list(["php", "PHP", "Custom Thing"]) == ["PHP", "Custom Thing"]

    def test_hierarchy_and_related(self) -> None:
        assert ancestors("Adobe Commerce Cloud") == ["Adobe Commerce", "Magento 2", "Magento"]
        assert "MariaDB" in related("MySQL")
        assert "MySQL" in related("MariaDB")


class TestParser:
    def test_header_and_contact(self) -> None:
        p = parse_cv(SAMPLE_CV, AS_OF)
        assert p.name == "Asha Verma"
        assert p.headline == "Adobe Certified Expert | Magento Tech Lead"
        assert p.email == "asha.verma@example.com"
        assert p.phone == "+91 98765 43210"
        assert p.linkedin == "linkedin.com/in/asha-verma-example"
        assert p.location == "Jaipur, Rajasthan, India"

    def test_experience_and_years(self) -> None:
        p = parse_cv(SAMPLE_CV, AS_OF)
        assert [(e.title, e.company, e.location) for e in p.experience] == [
            ("Technical Lead", "Acme Commerce Pvt Ltd", "Jaipur"),
            ("Senior PHP Developer", "Beta Web Studio", "Pune"),
        ]
        assert p.experience[0].is_current and p.experience[0].end is None
        # Jun 2014 – Dec 2019 (66 months) + Jan 2020 – Oct 2026 (81 months) = 147 months
        assert p.total_experience_years == 12.2
        assert p.stated_experience_years == 11.0
        assert p.leadership_experience_years is not None
        assert p.companies == ["Acme Commerce Pvt Ltd", "Beta Web Studio"]

    def test_overlapping_roles_are_not_double_counted(self) -> None:
        text = (
            "EXPERIENCE\nDev\nA, X | Jan 2020 – Dec 2021\n• PHP work\n"
            "Consultant\nB, Y | Jan 2021 – Dec 2021\n• PHP work\n"
        )
        assert parse_cv(text, AS_OF).total_experience_years == 1.9

    def test_skills_domains_and_sections(self) -> None:
        p = parse_cv(SAMPLE_CV, AS_OF)
        for skill in (
            "PHP",
            "Magento 2",
            "Adobe Commerce Cloud",
            "MySQL",
            "GraphQL",
            "REST",
            "Redis",
            "RabbitMQ",
            "Docker",
            "Hyvä",
            "Magento MSI",
            "SAP",
        ):
            assert skill in p.skills, skill
        assert "MySQL" in p.databases
        assert "PHP" in p.languages
        assert "Mentoring" in p.leadership
        assert "E-commerce" in p.domains or "Retail" in p.domains
        assert p.skill_groups["Backend"][0] == "PHP"
        assert p.certifications == ["Adobe Certified Expert – Adobe Commerce Developer"]
        assert p.education[0].degree == "B.Tech in Computer Science"
        assert p.projects[0].name == "Retail Store"
        assert p.projects[0].platform == "Adobe Commerce Cloud"

    def test_achievements_need_real_metrics(self) -> None:
        p = parse_cv(SAMPLE_CV, AS_OF)
        assert any("40%" in a for a in p.achievements)
        assert not any(a.startswith("Built Magento 2 extensions") for a in p.achievements)

    def test_roles_split_parenthetical_lead(self) -> None:
        assert derive_roles(["Senior Software Developer (Tech Lead responsibilities)"]) == [
            "Senior Software Developer",
            "Tech Lead",
        ]

    def test_deterministic(self) -> None:
        assert parse_cv(SAMPLE_CV, AS_OF) == parse_cv(SAMPLE_CV, AS_OF)

    def test_garbage_input_does_not_crash(self) -> None:
        p = parse_cv("just some words without structure", AS_OF)
        assert p.experience == []
        assert p.warnings


class TestExtraction:
    def test_normalize_joins_wrapped_bullets(self) -> None:
        raw = "Header\n •   First bullet that\n     wraps here\n •   Second\nNext line"
        assert normalize_text(raw) == "Header\n• First bullet that wraps here\n• Second\nNext line"

    def test_docx_roundtrip(self) -> None:
        text = extract_text(make_docx(SAMPLE_CV), ".docx")
        assert "• Mentored developers and ran code reviews." in text
        assert parse_cv(text, AS_OF).experience[0].company == "Acme Commerce Pvt Ltd"

    def test_pdf_extraction(self) -> None:
        pdf = make_pdf(
            ["Asha Verma", "EXPERIENCE", "Developer", "Acme, Jaipur | Jan 2020 - Present"]
        )
        text = extract_text(pdf, ".pdf")
        assert "Asha Verma" in text
        assert parse_cv(text, AS_OF).experience[0].company == "Acme"

    @pytest.mark.parametrize(
        ("name", "data", "message"),
        [
            ("cv.exe", b"MZ...", "Unsupported file type"),
            ("cv.pdf", b"not a pdf", "not a PDF"),
            ("cv.docx", b"PK\x03\x04garbage", "not a DOCX"),
            ("cv.txt", b"\xff\xfe\x00bad", "UTF-8"),
            ("cv.txt", b"", "empty"),
            ("cv.txt", b"x" * 101, "too large"),
        ],
    )
    def test_validation_rejects(self, name: str, data: bytes, message: str) -> None:
        with pytest.raises(DomainValidationError, match=message):
            validate_upload(name, data, max_bytes=100)

    def test_safe_filename_strips_paths(self) -> None:
        assert safe_filename("../../etc/passwd") == "passwd"
        assert safe_filename("C:\\Users\\me\\My CV<script>.pdf") == "My CV_script_.pdf"

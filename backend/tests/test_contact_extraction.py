from app.jobs.contacts import extract_contacts, name_from_email, normalize_phone


def emails(text: str, trusted: bool = True) -> list[str | None]:
    return [c.email for c in extract_contacts(text, trusted=trusted)]


def test_email_and_phone_on_one_line_are_one_contact() -> None:
    found = extract_contacts(
        "Seen Jobs: 62\nEmail: hr@acme-designs.example.co | Phone: 9876543210\nFind job: x",
        trusted=True)
    assert len(found) == 1
    c = found[0]
    assert (c.email, c.phone, c.name) == ("hr@acme-designs.example.co", "+91 98765 43210", None)


def test_person_like_email_gives_a_name() -> None:
    [c] = extract_contacts("Email resume: asha.verma@talentco.example.in", trusted=True)
    assert c.name == "Asha Verma"
    assert name_from_email("careers@x.in") is None and name_from_email("hr.team@x.in") is None
    assert name_from_email("jdoe1984@x.in") is None


def test_phone_needs_a_cue_requisition_numbers_are_not_phones() -> None:
    req = "Direct Greenhouse ATS requisition #4012345678, 12+ yrs"
    assert extract_contacts(req, trusted=True) == []
    assert extract_contacts("Job id 9876543210 posted", trusted=True) == []
    [c] = extract_contacts("Share CV via phone/WhatsApp: 9123456780", trusted=True)
    assert c.phone == "+91 91234 56780" and c.email is None
    [c] = extract_contacts("Reach us on +91-98450 12345", trusted=True)
    assert c.phone == "+91 98450 12345"


def test_toll_free_and_accommodation_numbers_are_not_recruiters() -> None:
    jd = ("If you have accommodation needs, please call us toll free at 1 (877) 555-0199 "
          "or speak with your recruiter.")
    assert extract_contacts(jd, trusted=False) == []
    assert extract_contacts("Call 1 (877) 555-0199 for details", trusted=True) == []
    [c] = extract_contacts("For this role call HR on 9876543210", trusted=False)
    assert c.phone == "+91 98765 43210"


def test_description_emails_need_an_application_cue() -> None:
    jd = ("If interested, share your updated resume to kiran.rao@bigco.example.com today.\n"
          "To request an accommodation, email accommodations@bigco.example.com.\n"
          "Our office: info@bigco.example.com is on the website.")
    assert emails(jd, trusted=False) == ["kiran.rao@bigco.example.com"]
    # In your own notes, an info@ mailbox counts (you wrote it down to apply).
    assert emails("Email: info@small.example.in (include CTC)") == ["info@small.example.in"]


def test_names_linkedin_and_dedup() -> None:
    text = ("Recruiter: Meera Iyer - meera@agency.example.in\n"
            "LinkedIn: https://www.linkedin.com/in/meera-iyer-123/?trk=x\n"
            "Again: meera@agency.example.in, call 9988776655")
    found = extract_contacts(text, trusted=True)
    by_email = {c.email: c for c in found}
    m = by_email["meera@agency.example.in"]
    assert m.name == "Meera Iyer" and m.phone == "+91 99887 76655"
    assert any(c.linkedin_url == "https://www.linkedin.com/in/meera-iyer-123" for c in found)


def test_skips_noise() -> None:
    assert emails("logo@2x.png and noreply@ats.example.io and you@example.com") == []
    assert extract_contacts("", trusted=True) == [] and extract_contacts(None, trusted=False) == []


def test_normalize_phone() -> None:
    assert normalize_phone("+91 98765-43210") == "+91 98765 43210"
    assert normalize_phone("09876543210") == "+91 98765 43210"
    assert normalize_phone("+44 20 7946 0958") == "+442079460958"
    assert normalize_phone("12345") is None and normalize_phone("5123456789") is None


def test_jobs_get_their_recruiters(client) -> None:  # type: ignore[no-untyped-def]
    notes = "Seen Jobs: 62\nEmail: hr@acme-designs.example.co | Phone: 9876543210"
    job = client.post("/api/v1/jobs", json={"title": "PHP Lead", "company": "Acme Designs",
                                            "jd": "PHP", "notes": notes}).json()["job"]
    assert job["recruiter"]["email"] == "hr@acme-designs.example.co"
    assert job["recruiter"]["phone"] == "+91 98765 43210"
    [contact] = client.get("/api/v1/recruiters").json()["items"]
    assert contact["contact_type"] == "HR" and contact["company_name"] == "Acme Designs"
    assert contact["source"] == f"Job #{job['id']} notes"
    assert contact["jobs"] == [{"id": job["id"], "title": "PHP Lead", "status": job["status"]}]

    # Another job from the same person reuses the contact; a comment adds a LinkedIn profile.
    other = client.post("/api/v1/jobs", json={
        "title": "Magento Lead", "company": "Acme Designs",
        "jd": "Interested candidates share your CV to hr@acme-designs.example.co"}).json()["job"]
    assert other["recruiter"]["id"] == contact["id"]
    client.post(f"/api/v1/jobs/{other['id']}/comments",
                json={"body": "HR on LinkedIn: https://www.linkedin.com/in/acme-hr-team"})
    assert client.get("/api/v1/recruiters").json()["total"] == 2

    # Running over every job again changes nothing.
    again = client.post("/api/v1/recruiters/find-in-jobs").json()
    assert again["created"] == 0 and again["linked"] == 0 and again["jobs_checked"] == 2


def test_recruiter_phone_is_validated(client) -> None:  # type: ignore[no-untyped-def]
    ok = client.post("/api/v1/recruiters", json={"name": "Riya", "phone": "098765-43210"})
    assert ok.status_code == 201 and ok.json()["phone"] == "+91 98765 43210"
    assert client.post("/api/v1/recruiters", json={"name": "X", "phone": "12"}).status_code == 422

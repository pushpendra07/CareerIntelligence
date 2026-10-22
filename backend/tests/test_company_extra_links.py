"""Naukri company-list import and job-portal "extra links" on companies."""

from fastapi.testclient import TestClient

from app.core.text import same_company_name
from app.core.urls import portal_of

NAUKRI_HEADER = (
    "﻿Company ID,Company Name,Rating,Reviews,Company Type,Industry,Highlight,Founded,"
    "Employees,Business Nature,Offering Type,Ownership,Headquarters,Employer Type,Awards,"
    "Hiring Now,Tags Shown,Company Page,Jobs Page,Logo,First Seen\n"
)


def naukri_row(cid: int, name: str, industry: str = "IT Services & Consulting") -> str:
    slug = name.lower().replace(" ", "-")
    page = f"https://www.naukri.com/{slug}-overview-{cid}"
    return (
        f'{cid},{name},3.7,673,Corporate,{industry},,2010,1001-5000,B2B,Service,Private,,'
        f'Company,,yes,"Corporate, {industry}",{page},{page}?tab=jobs,'
        f"https://img.naukimg.com/logo_images/groups/v1/{cid}.gif,2026-10-20T17:55:06.043Z\n"
    )


def upload(client: TestClient, body: str) -> dict:
    return client.post(
        "/api/v1/companies/import",
        files={"file": ("naukri-companies.csv", body.encode(), "text/csv")},
    ).json()


def by_name(client: TestClient, q: str) -> list[dict]:
    return client.get("/api/v1/companies", params={"q": q, "size": 50}).json()["items"]


def test_portal_names_and_name_matching() -> None:
    assert portal_of("https://www.naukri.com/acme-overview-1") == "naukri"
    assert portal_of("https://www.linkedin.com/company/acme") == "linkedin"
    assert portal_of("https://www.foundit.in/company/acme") == "foundit"
    assert portal_of("https://www.monsterindia.com/acme") == "monster"
    assert portal_of("https://acme.example/about") == "acme.example"
    assert same_company_name("Kellton", "Kellton Tech")
    assert same_company_name("Appinventiv Technologies", "Appinventiv Pvt Ltd")
    assert not same_company_name("Aspire Software Solutions", "Aspire Systems")
    assert not same_company_name("Wissen Infotech", "Wissen Technology")
    assert same_company_name("Ingold Solution", "Ingold Solutions")


def test_naukri_import_adds_extra_links_without_duplicates(client: TestClient) -> None:
    existing = client.post("/api/v1/companies", json={"name": "Kellton Tech"}).json()
    client.post("/api/v1/companies", json={"name": "Aspire Systems"})

    body = (
        NAUKRI_HEADER
        + naukri_row(1, "Kellton")  # same company as "Kellton Tech"
        + naukri_row(2, "Aspire Software Solutions")  # a different company than Aspire Systems
        + naukri_row(3, "Tezo")
        + naukri_row(4, "Tezo")  # a second Naukri page for the same company
    )
    summary = upload(client, body)
    assert summary["read"] == 4
    assert summary["created"] == 2 and summary["merged"] == 2

    kellton = client.get(f"/api/v1/companies/{existing['id']}").json()
    assert kellton["name"] == "Kellton Tech"
    assert [(link["portal"], link["url"]) for link in kellton["extra_links"]] == [
        ("naukri", "https://www.naukri.com/kellton-overview-1")
    ]
    assert kellton["industry"] == "IT Services & Consulting"
    assert kellton["employee_range"] == "1001-5000"
    assert kellton["hiring_status"] == "HIRING"
    assert kellton["company_type"] is None  # Naukri's "Corporate" is not the app's type
    naukri = kellton["attributes"]["naukri"]
    assert naukri["naukri_id"] == "1" and naukri["rating"] == 3.7 and naukri["reviews"] == 673
    assert naukri["company_type"] == "Corporate"
    assert naukri["jobs_page"].endswith("?tab=jobs")
    assert kellton["created_at"]

    aspire = {c["name"] for c in by_name(client, "Aspire")}
    assert aspire == {"Aspire Systems", "Aspire Software Solutions"}
    (tezo,) = by_name(client, "Tezo")
    assert len(tezo["extra_links"]) == 2

    # Importing the same file again changes nothing: the links identify the companies.
    again = upload(client, body)
    assert again["created"] == 0 and again["merged"] == 4
    assert len(client.get(f"/api/v1/companies/{existing['id']}").json()["extra_links"]) == 1
    assert len(by_name(client, "Tezo")[0]["extra_links"]) == 2

    newest = client.get("/api/v1/companies", params={"sort": "-created_at"}).json()["items"]
    assert newest[0]["created_at"] >= newest[-1]["created_at"]

    exported = client.get("/api/v1/companies/export", params={"format": "csv"}).text
    assert "https://www.naukri.com/kellton-overview-1" in exported


def test_extra_links_from_generic_columns_and_manual_edit(client: TestClient) -> None:
    summary = upload(
        client,
        "name,website,extra_link,foundit_url\n"
        "Zeta Commerce,zeta.example,https://www.linkedin.com/company/zeta,"
        "https://www.foundit.in/company/zeta\n",
    )
    assert summary["created"] == 1
    (zeta,) = by_name(client, "Zeta Commerce")
    assert [link["portal"] for link in zeta["extra_links"]] == ["linkedin", "foundit"]

    first_added = zeta["extra_links"][0]["added_at"]
    edited = client.patch(
        f"/api/v1/companies/{zeta['id']}",
        json={"extra_links": [
            "https://www.linkedin.com/company/zeta", "naukri.com/zeta-overview-9",
        ]},
    ).json()
    assert [(link["portal"], link["source"]) for link in edited["extra_links"]] == [
        ("linkedin", "upload"),
        ("naukri", "manual"),
    ]
    assert edited["extra_links"][0]["added_at"] == first_added
    bad = client.patch(f"/api/v1/companies/{zeta['id']}", json={"extra_links": ["not a url"]})
    assert bad.status_code == 422


def test_merge_keeps_extra_links(client: TestClient) -> None:
    keep = client.post("/api/v1/companies", json={"name": "Omega Labs"}).json()
    other = client.post(
        "/api/v1/companies",
        json={"name": "Omega Commerce", "extra_links": ["https://www.naukri.com/omega-overview-7"]},
    ).json()
    merged = client.post(
        f"/api/v1/companies/{keep['id']}/merge", json={"merge_id": other["id"]}
    ).json()
    assert [link["url"] for link in merged["extra_links"]] == [
        "https://www.naukri.com/omega-overview-7"
    ]


def test_list_filters_facets_and_rating_sort(client: TestClient) -> None:
    upload(client, NAUKRI_HEADER + naukri_row(11, "Rho Commerce") + naukri_row(12, "Sigma Labs",
                                                                          "Internet"))
    client.post("/api/v1/companies", json={"name": "Tau Plain"})
    rows = client.get("/api/v1/companies", params={"portal": "naukri", "size": 50}).json()
    assert {c["name"] for c in rows["items"]} >= {"Rho Commerce", "Sigma Labs"}
    assert "Tau Plain" not in {c["name"] for c in rows["items"]}
    anyp = client.get("/api/v1/companies", params={"portal": "any", "size": 50}).json()
    assert "Tau Plain" not in {c["name"] for c in anyp["items"]}
    internet = client.get("/api/v1/companies", params={"industry": "internet"}).json()["items"]
    assert [c["name"] for c in internet] == ["Sigma Labs"]
    assert internet[0]["rating"] == 3.7 and internet[0]["rating_reviews"] == 673
    sized = client.get("/api/v1/companies", params={"company_size": "1001-5000"}).json()
    assert sized["total"] >= 2
    lone = NAUKRI_HEADER + naukri_row(13, "Chi Lone").replace(",3.7,673,", ",5,1,")
    upload(client, lone)
    ranked = client.get("/api/v1/companies", params={"sort": "-rating", "size": 50}).json()
    names = [c["name"] for c in ranked["items"]]
    assert ranked["items"][0]["rating"] is not None
    assert names.index("Rho Commerce") < names.index("Chi Lone")  # 3.7 from 673 > 5.0 from 1

    f = client.get("/api/v1/companies/facets").json()
    assert {"value": "Internet", "count": 1} in f["industries"]
    assert any(p["value"] == "naukri" and p["count"] >= 2 for p in f["portals"])
    assert any(e["value"] == "1001-5000" and e["count"] >= 2 for e in f["company_sizes"])


def test_possible_duplicates_and_dismiss(client: TestClient) -> None:
    a = client.post("/api/v1/companies", json={"name": "Wissen Infotech"}).json()
    upload(client, NAUKRI_HEADER + naukri_row(21, "Wissen Technology"))
    groups = client.get("/api/v1/companies/duplicates").json()["groups"]
    (group,) = [g for g in groups if a["id"] in {c["id"] for c in g["companies"]}]
    assert group["reason"] == "similar name"
    assert {c["name"] for c in group["companies"]} == {"Wissen Infotech", "Wissen Technology"}

    ids = [c["id"] for c in group["companies"]]
    assert client.post("/api/v1/companies/duplicates/dismiss",
                       json={"company_ids": ids}).status_code == 204
    after = client.get("/api/v1/companies/duplicates").json()["groups"]
    assert not [g for g in after if a["id"] in {c["id"] for c in g["companies"]}]


def test_bulk_actions_keep_companies_with_jobs(client: TestClient) -> None:
    free = client.post("/api/v1/companies", json={"name": "Upsilon Free"}).json()
    busy = client.post("/api/v1/companies", json={"name": "Phi Busy"}).json()
    job = client.post("/api/v1/jobs", json={"title": "Magento Lead", "company": "Phi Busy",
                                            "url": "https://phi.example/jobs/1",
                                            "jd": "Lead our Magento team."})
    assert job.status_code == 201, job.text
    assert job.json()["job"]["company"]["id"] == busy["id"]
    ids = [free["id"], busy["id"]]

    on = client.post("/api/v1/companies/bulk", json={"company_ids": ids, "action": "job_search_on"})
    assert on.json()["updated"] == 2
    assert client.get(f"/api/v1/companies/{free['id']}").json()["job_search_enabled"] is True
    tier = client.post("/api/v1/companies/bulk",
                       json={"company_ids": ids, "action": "tier", "tier": "TIER_B"}).json()
    assert tier["updated"] == 2
    assert client.get(f"/api/v1/companies/{busy['id']}").json()["tier"] == "TIER_B"

    gone = client.post(
        "/api/v1/companies/bulk", json={"company_ids": ids, "action": "delete"}
    ).json()
    assert gone["deleted"] == 1
    assert [s["name"] for s in gone["skipped"]] == ["Phi Busy"]
    assert client.get(f"/api/v1/companies/{free['id']}").status_code == 404
    assert client.get(f"/api/v1/companies/{busy['id']}").status_code == 200

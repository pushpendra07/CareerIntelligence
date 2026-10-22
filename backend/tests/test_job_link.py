"""Changing a job's link from the edit form."""

from fastapi.testclient import TestClient

from tests.test_jobs import add


def test_edit_changes_the_link_and_keeps_the_old_one_as_a_source(client: TestClient) -> None:
    job = add(client)["job"]
    new = "https://careers.acme.example/jobs/tech-lead-123"
    r = client.patch(f"/api/v1/jobs/{job['id']}", json={"url": new})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["source_url"] == new
    urls = [link["original_url"] for link in out["source_links"]]
    assert new in urls and any("linkedin.com" in u for u in urls)  # the old link is kept
    # With other fields in the same save, both apply.
    both = client.patch(f"/api/v1/jobs/{job['id']}",
                        json={"url": "careers.acme.example/jobs/tech-lead-124", "title": "Lead"})
    assert both.status_code == 200, both.text
    assert both.json()["source_url"] == "https://careers.acme.example/jobs/tech-lead-124"
    assert both.json()["title"] == "Lead"
    # Empty clears the chosen link (the sources stay).
    cleared = client.patch(f"/api/v1/jobs/{job['id']}", json={"url": ""}).json()
    assert cleared["source_url"] is None and len(cleared["source_links"]) == 3


def test_link_of_another_job_or_a_search_page_is_refused(client: TestClient) -> None:
    a = add(client)["job"]
    b = add(client, title="QA Lead", url="https://acme.example/careers/qa", jd="Testing.")["job"]
    clash = client.patch(f"/api/v1/jobs/{b['id']}", json={"url": a["source_url"]})
    assert clash.status_code == 422 and f"job {a['id']}" in clash.json()["error"]["message"]
    search = client.patch(f"/api/v1/jobs/{b['id']}",
                          json={"url": "https://www.naukri.com/magento-jobs-in-pune"})
    assert search.status_code == 422 and "listing" in search.json()["error"]["message"]
    bad = client.patch(f"/api/v1/jobs/{b['id']}", json={"url": "not a link"})
    assert bad.status_code == 422
    assert client.get(f"/api/v1/jobs/{b['id']}").json()["source_url"] == b["source_url"]

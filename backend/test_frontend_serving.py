"""Tests for serving the website from the backend (used when the app is deployed).

Run from the backend folder:  python -m pytest test_frontend_serving.py -q
"""

import pytest
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)

pytestmark = pytest.mark.skipif(
    not (main.FRONTEND_DIR / "index.html").is_file(), reason="the website files are not next to the backend folder"
)


def test_home_page_is_the_website():
    r = client.get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "Prepline" in r.text


def test_website_files_are_served_with_the_right_type():
    js = client.get("/app.js")
    assert js.status_code == 200 and "javascript" in js.headers["content-type"]
    css = client.get("/styles.css")
    assert css.status_code == 200 and "css" in css.headers["content-type"]


def test_module_folders_are_served():
    for path in ("/attention/attentionMonitor.js", "/speech-analysis/speechAnalyzer.js"):
        if (main.FRONTEND_DIR / path.lstrip("/")).is_file():
            r = client.get(path)
            assert r.status_code == 200 and "javascript" in r.headers["content-type"]


@pytest.mark.parametrize("path", [
    "/.env", "/.git/config", "/.gitignore", "/README.md", "/API.md", "/requirements.txt",
    "/backend/main.py", "/main.py", "/backend/.env", "/backend/data/history.db",
    "/nothing-here.js", "/../backend/main.py", "/%2e%2e/backend/main.py", "/..%2Fbackend%2Fmain.py",
])
def test_private_and_missing_files_are_not_served(path):
    r = client.get(path)
    assert r.status_code == 404
    assert "secret" not in r.text


def test_the_api_still_works_next_to_the_website():
    assert client.get("/api/health").status_code == 200
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200
    assert client.get("/api/history").status_code == 422        # reaches the API, not the website
    assert client.post("/api/aptitude/start", json={"count": 3}).status_code == 200


"""Tests for the resume upload. The PDFs are made inside the tests, so no sample files are needed.
 
Run from the backend folder:  python -m pytest test_resume.py -q
"""
 
import io
 
import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
 
import main
import resume
 
client = TestClient(main.app)
 
 
def make_pdf(text: str) -> bytes:
    """A tiny one-page PDF with real text in it (built by hand, so no extra library is needed)."""
    lines = text.split("\n")
    safe = lambda s: s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = "BT /F1 11 Tf 40 780 Td 14 TL " + " ".join(f"({safe(l)}) Tj T*" for l in lines) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out
 
 
def upload(data: bytes, name="resume.pdf"):
    return client.post("/api/resume/parse", files={"file": (name, data, "application/pdf")})
 
 
def test_a_text_pdf_is_read():
    r = upload(make_pdf("Asha Rao\nPython, Flask and SQLite projects\nBuilt a login system"))
    assert r.status_code == 200
    data = r.json()
    assert "Asha Rao" in data["text"] and "Flask" in data["text"]
    assert data["truncated"] is False
    assert data["char_count"] == len(data["text"])
 
 
def test_long_text_is_cut_to_6000_characters():
    long_text = "\n".join(f"Project line number {i} with some skills" for i in range(300))
    data = upload(make_pdf(long_text)).json()
    assert len(data["text"]) == resume.MAX_CHARS
    assert data["truncated"] is True and data["char_count"] > resume.MAX_CHARS
 
 
def test_the_text_fits_in_the_interview_start_limit():
    assert resume.MAX_CHARS <= 8000        # InterviewStartRequest.resume_text allows 8000
 
 
def test_not_a_pdf_by_name():
    r = upload(b"hello", name="resume.docx")
    assert r.status_code == 400 and "PDF" in r.json()["detail"]
 
 
def test_pdf_name_but_not_a_pdf_inside():
    r = upload(b"this is just text, not a pdf at all", name="resume.pdf")
    assert r.status_code == 400 and "not a real PDF" in r.json()["detail"]
 
 
def test_empty_file():
    assert upload(b"").status_code == 400
 
 
def test_file_over_2_mb_is_rejected():
    big = make_pdf("hello world resume") + b"0" * (resume.MAX_BYTES + 10)
    r = upload(big)
    assert r.status_code == 400 and "2 MB" in r.json()["detail"]
 
 
def test_a_pdf_without_text_is_rejected_with_a_clear_message():
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)
    r = upload(buffer.getvalue())
    assert r.status_code == 400 and "Scanned PDFs" in r.json()["detail"]
 
 
def test_a_broken_pdf_is_rejected_without_crashing():
    r = upload(b"%PDF-1.4\nthis is broken\n%%EOF")
    assert r.status_code == 400
 
 
def test_a_password_protected_pdf_is_rejected():
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.encrypt("secret-password")
    buffer = io.BytesIO()
    writer.write(buffer)
    r = upload(buffer.getvalue())
    assert r.status_code == 400 and "password" in r.json()["detail"]
 
 
def test_missing_file_field_is_422():
    assert client.post("/api/resume/parse").status_code == 422
 
 
def test_nothing_is_written_to_disk(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    upload(make_pdf("Some resume text that is long enough"))
    assert list(tmp_path.iterdir()) == []

"""
Resume upload: reads a PDF and returns its text. The text is later sent back as `resume_text`
when an interview starts, so the questions can use the candidate's projects and skills.
 
The file is read into memory and thrown away. Nothing is written to disk and the text is never logged.
Scanned PDFs (pictures of text) are not supported, because there is no text to read.
"""
 
import io
import re
from typing import Any, Dict
 
from fastapi import APIRouter, File, HTTPException, UploadFile
 
router = APIRouter(prefix="/api/resume", tags=["Resume"])
 
MAX_BYTES = 2 * 1024 * 1024      # 2 MB
MAX_CHARS = 6000                 # the interview start request accepts up to 8000
MAX_PAGES = 10
MIN_TEXT_CHARS = 20
 
 
def _clean(text: str) -> str:
    text = text.replace("\x00", " ").replace("\r", "\n")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
 
 
def extract_text(data: bytes) -> str:
    """Returns the cleaned text of a PDF, or raises HTTPException(400) with a clear message."""
    try:
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError
    except ImportError:
        raise HTTPException(status_code=503, detail="Resume reading is not available on this server (pypdf is not installed).")
 
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                if not reader.decrypt(""):
                    raise HTTPException(status_code=400, detail="This PDF is password protected. Please upload an unprotected copy.")
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=400, detail="This PDF is password protected. Please upload an unprotected copy.")
        pages = []
        for page in reader.pages[:MAX_PAGES]:
            pages.append(page.extract_text() or "")
    except HTTPException:
        raise
    except PdfReadError:
        raise HTTPException(status_code=400, detail="This file could not be read as a PDF.")
    except Exception:
        raise HTTPException(status_code=400, detail="This file could not be read as a PDF.")
 
    return _clean("\n".join(pages))
 
 
@router.post("/parse")
async def parse_resume(file: UploadFile = File(...)) -> Dict[str, Any]:
    name = (file.filename or "").lower()
    if not name.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")
 
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="The file is larger than 2 MB. Please upload a smaller PDF.")
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty.")
    if data.lstrip()[:5] != b"%PDF-":
        raise HTTPException(status_code=400, detail="This file is not a real PDF.")
 
    text = extract_text(data)
    if len(text) < MIN_TEXT_CHARS:
        raise HTTPException(
            status_code=400,
            detail="No readable text was found in this PDF. Scanned PDFs (pictures of text) are not supported.",
        )
 
    return {"text": text[:MAX_CHARS], "char_count": len(text), "truncated": len(text) > MAX_CHARS}
 
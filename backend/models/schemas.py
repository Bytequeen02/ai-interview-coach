"""
Pydantic models (schemas) for the AI Interview Coach backend.

Keeping every request/response shape here makes it trivial for the
frontend (Vanshika) to see exactly what to send and expect back, and
lets FastAPI auto-generate accurate Swagger docs at /docs.
"""

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class ExperienceLevel(str, Enum):
    fresher = "Fresher"
    junior = "Junior"
    mid = "Mid"
    senior = "Senior"


class InterviewType(str, Enum):
    technical = "Technical"
    behavioral = "Behavioral"
    hr = "HR"
    mixed = "Mixed"


class QuestionCategory(str, Enum):
    introduction = "Introduction"
    technical = "Technical"
    project = "Project-based"
    behavioral = "Behavioral"
    hr = "HR"
    situational = "Situational"


class Difficulty(str, Enum):
    easy = "Easy"
    medium = "Medium"
    hard = "Hard"


# ---------------------------------------------------------------------------
# Feature 1: Interview Setup
# ---------------------------------------------------------------------------

class InterviewStartRequest(BaseModel):
    candidate_name: str = Field(..., min_length=1, max_length=100)
    target_role: str = Field(..., min_length=1, max_length=150)
    experience_level: ExperienceLevel
    interview_type: InterviewType
    num_questions: int = Field(..., ge=1, le=15)
    resume_text: Optional[str] = Field(default=None, max_length=8000)
    job_description: Optional[str] = Field(default=None, max_length=4000)

    @field_validator("candidate_name", "target_role")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be blank")
        return v.strip()


class QuestionOut(BaseModel):
    question_id: int
    question: str
    category: QuestionCategory
    difficulty: Difficulty
    is_fallback: bool = False  # true if generated from the fallback bank, not the AI


class InterviewStartResponse(BaseModel):
    session_id: str
    total_questions: int
    first_question: QuestionOut


# ---------------------------------------------------------------------------
# Feature 3: Answer Submission
# ---------------------------------------------------------------------------

class AnswerSubmitRequest(BaseModel):
    session_id: str
    question_id: int
    question: str
    answer: str = Field(..., min_length=1)

    @field_validator("answer")
    @classmethod
    def answer_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("answer must not be empty")
        return v


# ---------------------------------------------------------------------------
# Feature 4: AI Answer Evaluation
# ---------------------------------------------------------------------------

class Evaluation(BaseModel):
    overall_score: float = Field(..., ge=0, le=10)
    relevance: float = Field(..., ge=0, le=10)
    technical_accuracy: float = Field(..., ge=0, le=10)
    completeness: float = Field(..., ge=0, le=10)
    clarity: float = Field(..., ge=0, le=10)
    communication: float = Field(..., ge=0, le=10)
    strengths: List[str] = Field(default_factory=list)
    improvements: List[str] = Field(default_factory=list)
    feedback: str
    improved_answer: str
    is_fallback: bool = False  # true if AI failed and a safe fallback was used


class AnswerSubmitResponse(BaseModel):
    session_id: str
    question_id: int
    evaluation: Evaluation
    is_last_question: bool


# ---------------------------------------------------------------------------
# Feature 5: Next Question
# ---------------------------------------------------------------------------

class NextQuestionResponse(BaseModel):
    session_id: str
    finished: bool
    question: Optional[QuestionOut] = None
    progress: str  # e.g. "3/5"


# ---------------------------------------------------------------------------
# Feature 6: Final Report
# ---------------------------------------------------------------------------

class CategoryScores(BaseModel):
    technical: float
    communication: float
    clarity: float
    relevance: float
    completeness: float


class FinalReport(BaseModel):
    session_id: str
    candidate_name: str
    target_role: str
    overall_score: float
    category_scores: CategoryScores
    strengths: List[str]
    areas_for_improvement: List[str]
    interview_summary: str
    recommendations: List[str]
    questions_answered: int
    is_fallback: bool = False  # true if the qualitative summary used the placeholder path


# ---------------------------------------------------------------------------
# Generic error response
# ---------------------------------------------------------------------------

class ErrorResponse(BaseModel):
    detail: str

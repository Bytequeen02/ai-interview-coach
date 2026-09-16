"""
AI Interview Coach — Backend
=============================
FastAPI application entrypoint.

Route handlers stay thin: they validate input (via Pydantic) and
delegate all real work to services/*.py. This keeps main.py readable
and keeps AI/business logic testable in isolation.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models.schemas import (
    AnswerSubmitRequest,
    AnswerSubmitResponse,
    Evaluation,
    FinalReport,
    InterviewStartRequest,
    InterviewStartResponse,
    NextQuestionResponse,
    QuestionOut,
)
from services import answer_evaluator, llm_client, question_generator, report_generator, session_store

app = FastAPI(
    title="AI Interview Coach API",
    description="Backend for the AI Interview Coach college project (CSE518-7b).",
    version="0.1.0",
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
# Wide open for local dev so Vanshika's frontend (any localhost port, e.g.
# Vite on 5173 or CRA on 3000) can call the API without friction.
#
# ⚠️ BEFORE PRODUCTION: replace allow_origins=["*"] with the exact deployed
# frontend origin(s), e.g. ["https://your-frontend.vercel.app"], and consider
# disabling allow_credentials unless you actually use cookies/auth.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/api/health", tags=["Health"])
def health_check():
    """Basic liveness check + whether the LLM key is configured."""
    return {
        "status": "ok",
        "llm_configured": llm_client.is_configured(),
        "active_sessions": session_store.session_count(),
    }


@app.get("/", tags=["Health"])
def root():
    return {"message": "AI Interview Coach API is running. See /docs for API documentation."}


# ---------------------------------------------------------------------------
# Feature 1 + 2: Interview Setup + first AI-generated question
# ---------------------------------------------------------------------------

@app.post("/api/interview/start", response_model=InterviewStartResponse, tags=["Interview"])
def start_interview(payload: InterviewStartRequest):
    candidate_info = payload.model_dump(mode="json")
    session_id = session_store.create_session(candidate_info)

    first_question = question_generator.generate_question(
        candidate_info=candidate_info,
        previous_questions=[],
        question_number=1,
        total_questions=payload.num_questions,
    )
    session_store.add_question(session_id, first_question)

    return InterviewStartResponse(
        session_id=session_id,
        total_questions=payload.num_questions,
        first_question=QuestionOut(**first_question),
    )


# ---------------------------------------------------------------------------
# Feature 5: Next Question
# ---------------------------------------------------------------------------

@app.get(
    "/api/interview/{session_id}/next-question",
    response_model=NextQuestionResponse,
    tags=["Interview"],
)
def next_question(session_id: str):
    if not session_store.exists(session_id):
        raise HTTPException(status_code=404, detail="Invalid session_id.")

    session = session_store.get_session(session_id)
    total = session["candidate_info"]["num_questions"]

    if session["finished"]:
        return NextQuestionResponse(
            session_id=session_id,
            finished=True,
            question=None,
            progress=f"{total}/{total}",
        )

    existing_questions = session["questions"]
    current_index = session["current_index"]

    # If the question at current_index hasn't been generated yet, generate it now.
    if current_index >= len(existing_questions):
        question_number = current_index + 1
        question_dict = question_generator.generate_question(
            candidate_info=session["candidate_info"],
            previous_questions=existing_questions,
            question_number=question_number,
            total_questions=total,
        )
        session_store.add_question(session_id, question_dict)
    else:
        question_dict = existing_questions[current_index]

    return NextQuestionResponse(
        session_id=session_id,
        finished=False,
        question=QuestionOut(**question_dict),
        progress=f"{current_index + 1}/{total}",
    )


# ---------------------------------------------------------------------------
# Feature 3 + 4: Answer Submission + AI Evaluation
# ---------------------------------------------------------------------------

@app.post("/api/interview/answer", response_model=AnswerSubmitResponse, tags=["Interview"])
def submit_answer(payload: AnswerSubmitRequest):
    if not session_store.exists(payload.session_id):
        raise HTTPException(status_code=404, detail="Invalid session_id.")

    session = session_store.get_session(payload.session_id)

    if session["finished"]:
        raise HTTPException(status_code=400, detail="This interview session has already finished.")

    expected_question_id = session["current_index"] + 1
    if payload.question_id != expected_question_id:
        raise HTTPException(
            status_code=400,
            detail=(
                f"question_id {payload.question_id} is not the current pending question "
                f"(expected {expected_question_id}). Fetch the current question via "
                f"next-question before submitting an answer."
            ),
        )

    stored_questions = {q["question_id"]: q for q in session["questions"]}
    if payload.question_id not in stored_questions:
        raise HTTPException(
            status_code=404,
            detail="Question not found for this session. Call next-question first.",
        )

    evaluation_dict = answer_evaluator.evaluate_answer(
        candidate_info=session["candidate_info"],
        question=stored_questions[payload.question_id]["question"],
        answer=payload.answer,
    )

    session_store.record_answer(payload.session_id, payload.question_id, payload.answer)
    session_store.record_evaluation(payload.session_id, payload.question_id, evaluation_dict)
    session_store.advance(payload.session_id)

    updated_session = session_store.get_session(payload.session_id)

    return AnswerSubmitResponse(
        session_id=payload.session_id,
        question_id=payload.question_id,
        evaluation=Evaluation(**evaluation_dict),
        is_last_question=updated_session["finished"],
    )


# ---------------------------------------------------------------------------
# Feature 6: Final Interview Report
# ---------------------------------------------------------------------------

@app.get("/api/interview/{session_id}/report", response_model=FinalReport, tags=["Interview"])
def get_report(session_id: str):
    if not session_store.exists(session_id):
        raise HTTPException(status_code=404, detail="Invalid session_id.")

    session = session_store.get_session(session_id)

    if not session["finished"]:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Interview not finished yet ({session['current_index']}/"
                f"{session['candidate_info']['num_questions']} questions answered). "
                f"Submit remaining answers before requesting the report."
            ),
        )

    if not session["evaluations"]:
        raise HTTPException(status_code=400, detail="No answers have been evaluated for this session.")

    report_data = report_generator.generate_report(session)

    return FinalReport(
        session_id=session_id,
        candidate_name=session["candidate_info"]["candidate_name"],
        target_role=session["candidate_info"]["target_role"],
        **report_data,
    )

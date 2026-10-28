
"""
Quick manual check for interviewer follow-up questions.
 
It runs one short Technical interview (3 questions, strict mode) against your
local backend. For each question it sends a decent but incomplete answer. When
the interviewer asks a follow-up, it answers that too. At the end it fetches the
report and prints a summary.
 
Run it from the backend folder, with the backend already running:
 
    python check_followups.py
 
Options:
    --base URL       backend address (default http://127.0.0.1:8000)
    --pause SECONDS  wait between calls, useful if the AI has a rate limit (default 3)
    --mode MODE      friendly, strict or stress (default strict)
 
The AI decides whether a follow-up is useful, so some questions may get none.
The server never allows more than 2 follow-ups in one interview.
"""
 
import argparse
import json
import time
import urllib.error
import urllib.request
 
ANSWER = (
    "I built a small web project with Python and Flask where users can sign up and log in. "
    "I stored the data in SQLite and added some input validation."
)
FOLLOW_UP_ANSWER = (
    "I returned clear error messages for bad input, wrote the exceptions to a log file, "
    "and tested the main routes by hand."
)
 
 
def call(base, method, path, body=None, allow_error=False):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        base + path, data=data, method=method, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        if allow_error:
            return err.code, detail
        raise SystemExit(f"\nRequest failed: {method} {path} -> {err.code}\n{detail}")
    except urllib.error.URLError as err:
        raise SystemExit(
            f"\nCould not reach the backend at {base}.\n"
            f"Is 'uvicorn main:app --reload' running? ({err.reason})"
        )
 
 
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--pause", type=float, default=3.0)
    parser.add_argument("--mode", default="strict", choices=["friendly", "strict", "stress"])
    args = parser.parse_args()
    pause = args.pause
 
    _, start = call(args.base, "POST", "/api/interview/start", {
        "candidate_name": "Follow-up Check",
        "target_role": "Software Engineer",
        "experience_level": "Fresher",
        "interview_type": "Technical",
        "num_questions": 3,
        "mode": args.mode,
        "company_style": "general",
    })
    sid = start["session_id"]
    question = start["first_question"]
    asked = []
    print(f"Interview started in {args.mode} mode.\n", flush=True)
 
    for number in range(1, 4):
        print(f"QUESTION {number}: {question['question']}", flush=True)
        time.sleep(pause)
        _, result = call(args.base, "POST", "/api/interview/answer", {
            "session_id": sid, "question_id": question["question_id"],
            "question": question["question"], "answer": ANSWER,
        })
        evaluation = result["evaluation"]
        print(f"  score: {evaluation['overall_score']}"
              + ("   (placeholder evaluation)" if evaluation.get("is_fallback") else ""))
        follow_up = evaluation.get("follow_up")
 
        if follow_up:
            asked.append(follow_up["question"])
            print(f"  FOLLOW-UP: {follow_up['question']}", flush=True)
            time.sleep(pause)
            _, fu_result = call(args.base, "POST", "/api/interview/answer", {
                "session_id": sid, "question_id": question["question_id"],
                "question": follow_up["question"], "answer": FOLLOW_UP_ANSWER, "is_follow_up": True,
            })
            print(f"  follow-up score: {fu_result['evaluation']['overall_score']}")
            time.sleep(pause)
            code, _ = call(args.base, "POST", "/api/interview/answer", {
                "session_id": sid, "question_id": question["question_id"],
                "question": follow_up["question"], "answer": FOLLOW_UP_ANSWER, "is_follow_up": True,
            }, allow_error=True)
            print(f"  answering the same follow-up again -> {code} (400 is expected)")
        else:
            print("  (no follow-up for this answer)")
 
        if result["is_last_question"]:
            break
        time.sleep(pause)
        _, nxt = call(args.base, "GET", f"/api/interview/{sid}/next-question")
        question = nxt["question"]
        print()
 
    time.sleep(pause)
    _, report = call(args.base, "GET", f"/api/interview/{sid}/report")
    print("\n" + "=" * 60)
    print(f"Follow-ups asked: {len(asked)} (the server allows at most 2)")
    print(f"Report: {report['questions_answered']} questions answered, overall score {report['overall_score']}")
    print("Follow-up answers are shown separately and are not part of this report score.")
    if len(asked) > 2:
        print("PROBLEM: more than 2 follow-ups were asked.")
 
 
if __name__ == "__main__":
    main()
"""
Quick manual check for interviewer modes and company styles.
 
It starts one short interview for each combination below, sends the SAME
answer to every one, then prints the second question, the score and the
feedback so you can compare them side by side.
 
Run it from the backend folder, with the backend already running:
 
    python check_modes.py
 
Options:
    --base URL      backend address (default http://127.0.0.1:8000)
    --repeats N     how many sessions per combination (default 1)
    --pause SECONDS wait between calls, useful if the AI has a rate limit (default 2)
 
It only talks to your own local backend. It does not store anything.
"""
 
import argparse
import json
import time
import urllib.error
import urllib.request
 
COMBOS = [
    ("friendly", "general"),
    ("strict", "service"),
    ("stress", "product"),
]
 
SAME_ANSWER = (
    "I am a final year computer science student. I built a small web project using Python "
    "and Flask where users can register and log in. I used SQLite for the database and "
    "learned how to validate input and handle errors. I enjoy solving problems and I am "
    "eager to learn more."
)
 
 
def call(base, method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise SystemExit(f"\nRequest failed: {method} {path} -> {err.code}\n{detail}")
    except urllib.error.URLError as err:
        raise SystemExit(
            f"\nCould not reach the backend at {base}.\n"
            f"Is 'uvicorn main:app --reload' running? ({err.reason})"
        )
 
 
def run_once(base, mode, style, pause):
    start = call(base, "POST", "/api/interview/start", {
        "candidate_name": "Mode Check",
        "target_role": "Software Engineer",
        "experience_level": "Fresher",
        "interview_type": "Technical",
        "num_questions": 3,
        "mode": mode,
        "company_style": style,
    })
    session_id = start["session_id"]
    first = start["first_question"]
    time.sleep(pause)
 
    answer = call(base, "POST", "/api/interview/answer", {
        "session_id": session_id,
        "question_id": first["question_id"],
        "question": first["question"],
        "answer": SAME_ANSWER,
    })
    evaluation = answer["evaluation"]
    time.sleep(pause)
 
    second = call(base, "GET", f"/api/interview/{session_id}/next-question")
    time.sleep(pause)
 
    return {
        "mode": mode,
        "style": style,
        "q1": first["question"],
        "q1_fallback": first.get("is_fallback", False),
        "score": evaluation["overall_score"],
        "feedback": evaluation["feedback"],
        "eval_fallback": evaluation.get("is_fallback", False),
        "q2": (second.get("question") or {}).get("question", "(none)"),
        "q2_fallback": (second.get("question") or {}).get("is_fallback", False),
    }
 
 
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--pause", type=float, default=2.0)
    args = parser.parse_args()
 
    results = []
    for mode, style in COMBOS:
        for attempt in range(1, args.repeats + 1):
            print(f"Running {mode} + {style} (run {attempt} of {args.repeats}) ...", flush=True)
            results.append(run_once(args.base, mode, style, args.pause))
 
    print("\n" + "=" * 70)
    for r in results:
        print(f"\nMODE: {r['mode']}   COMPANY STYLE: {r['style']}")
        print(f"  Question 1: {r['q1']}")
        print(f"  Question 2: {r['q2']}")
        print(f"  Score for the same answer: {r['score']}")
        print(f"  Feedback: {r['feedback']}")
        flags = []
        if r["q1_fallback"] or r["q2_fallback"]:
            flags.append("a question came from the fallback bank")
        if r["eval_fallback"]:
            flags.append("the evaluation is a placeholder")
        if flags:
            print("  WARNING: " + "; ".join(flags) + " (the AI was not used, so mode has no effect)")
 
    print("\n" + "=" * 70)
    print("SCORES FOR THE SAME ANSWER")
    for r in results:
        print(f"  {r['mode']:<9} + {r['style']:<8} -> {r['score']}")
    scores = [r["score"] for r in results]
    print(f"  spread (max - min): {round(max(scores) - min(scores), 1)}")
    print("A small spread (about 1 point or less) is expected. Mode should change the tone, not the score.")
 
 
if __name__ == "__main__":
    main()
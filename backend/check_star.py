"""

Quick manual check for the STAR feedback on behavioural questions.
 
It starts two short Behavioural interviews. In each one it answers question 1
(the introduction) briefly, then answers question 2 (a behavioural question):
  - session A with a complete STAR answer
  - session B with a vague answer
and prints the STAR checklist the backend returned for each.
 
Run it from the backend folder, with the backend already running:
 
    python check_star.py
 
Options:
    --base URL       backend address (default http://127.0.0.1:8000)
    --pause SECONDS  wait between calls, useful if the AI has a rate limit (default 3)
 
It only talks to your own local backend. It does not store anything.
"""
 
import argparse
import json
import time
import urllib.error
import urllib.request
 
INTRO_ANSWER = "I am a final year computer science student who enjoys building small web projects."
 
GOOD_ANSWER = (
    "In my third year, our team project was falling behind because two members disagreed "
    "about the database design (situation). As the team lead I had to get everyone to agree "
    "within two days so we could meet the demo date (task). I set up a short meeting, wrote "
    "down both options with pros and cons, and ran a quick test of each on sample data "
    "(action). We chose the simpler design, finished one day early and scored the highest "
    "marks in the class, and I learned to settle disagreements with data (result)."
)
 
VAGUE_ANSWER = "I usually work well with people and try to solve conflicts. Communication is important in a team."
 
 
def call(base, method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        base + path, data=data, method=method, headers={"Content-Type": "application/json"}
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
 
 
def run_session(base, label, answer, pause):
    start = call(base, "POST", "/api/interview/start", {
        "candidate_name": "Star Check",
        "target_role": "Software Engineer",
        "experience_level": "Fresher",
        "interview_type": "Behavioral",
        "num_questions": 2,
    })
    sid = start["session_id"]
    first = start["first_question"]
    time.sleep(pause)
 
    call(base, "POST", "/api/interview/answer", {
        "session_id": sid, "question_id": first["question_id"],
        "question": first["question"], "answer": INTRO_ANSWER,
    })
    time.sleep(pause)
 
    second = call(base, "GET", f"/api/interview/{sid}/next-question")["question"]
    time.sleep(pause)
 
    result = call(base, "POST", "/api/interview/answer", {
        "session_id": sid, "question_id": second["question_id"],
        "question": second["question"], "answer": answer,
    })["evaluation"]
    time.sleep(pause)
    return {"label": label, "question": second, "evaluation": result}
 
 
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--pause", type=float, default=3.0)
    args = parser.parse_args()
 
    runs = []
    for label, answer in [("A: complete STAR answer", GOOD_ANSWER), ("B: vague answer", VAGUE_ANSWER)]:
        print(f"Running session {label} ...", flush=True)
        runs.append(run_session(args.base, label, answer, args.pause))
 
    print("\n" + "=" * 70)
    for run in runs:
        q, ev = run["question"], run["evaluation"]
        print(f"\nSESSION {run['label']}")
        print(f"  Question category: {q['category']}")
        print(f"  Question: {q['question']}")
        print(f"  Score: {ev['overall_score']}")
        star = ev.get("star")
        if star is None:
            print("  STAR: none")
        else:
            marks = "  ".join(f"{k}={'yes' if star[k] else 'NO'}" for k in ("situation", "task", "action", "result"))
            print(f"  STAR: {marks}")
            print(f"  Tip: {star.get('tip', '')}")
        print(f"  Feedback: {ev['feedback']}")
        if ev.get("is_fallback"):
            print("  WARNING: placeholder evaluation (the AI was not used)")
        if str(q["category"]).lower() != "behavioral":
            print("  NOTE: this question was not Behavioral, so no STAR check is expected")
 
    print("\n" + "=" * 70)
    print("What to expect: session A should have most or all of the four parts marked yes,")
    print("and session B should have several marked NO, with a tip about the missing part.")
 
 
if __name__ == "__main__":
    main()


"""
Quick manual check for the aptitude round.
 
It starts a round of 10 questions on your local backend, then answers it on purpose:
the first 5 correctly, the next 3 wrongly, and the last 2 left out (skipped). The
backend should report 5 correct, 3 wrong, 2 skipped, 50 percent.
 
The script finds the right answers by reading backend/aptitude_data/questions.json,
because the server never sends them in /start.
 
Run it from the backend folder, with the backend already running:
 
    python check_aptitude.py
 
Option:  --base URL   backend address (default http://127.0.0.1:8000)
"""
 
import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path
 
BANK = {q["id"]: q for q in json.loads((Path(__file__).parent / "aptitude_data" / "questions.json").read_text(encoding="utf-8"))}
 
 
def call(base, path, body):
    request = urllib.request.Request(
        base + path, data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        raise SystemExit(f"\nRequest failed: POST {path} -> {err.code}\n{err.read().decode('utf-8', errors='replace')}")
    except urllib.error.URLError as err:
        raise SystemExit(f"\nCould not reach the backend at {base}.\nIs 'uvicorn main:app --reload' running? ({err.reason})")
 
 
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    base = parser.parse_args().base
 
    started = call(base, "/api/aptitude/start", {"sections": ["quant", "logical", "verbal"], "count": 10, "difficulty": "mixed"})
    questions = started["questions"]
    print(f"Round {started['round_id']}: {len(questions)} questions, {started['duration_seconds']} seconds")
    leaked = [k for k in questions[0] if k in ("answer_index", "explanation", "correct_index")]
    print("Answers hidden in /start:", "NO - leaked " + str(leaked) if leaked else "yes")
 
    answers = []
    for position, q in enumerate(questions):
        right = BANK[q["id"]]["answer_index"]
        if position < 5:
            answers.append({"id": q["id"], "selected_index": right})
        elif position < 8:
            answers.append({"id": q["id"], "selected_index": (right + 1) % 4})
        # the last two are left out on purpose
 
    result = call(base, "/api/aptitude/submit", {"round_id": started["round_id"], "answers": answers, "time_taken_seconds": 120})
    print(f"\nTotal {result['total']}  correct {result['correct']}  wrong {result['wrong']}  skipped {result['skipped']}  ({result['percent']}%)")
    for section, s in result["by_section"].items():
        print(f"  {section}: {s['correct']} / {s['total']}")
 
    ok = (result["total"], result["correct"], result["wrong"], result["skipped"]) == (10, 5, 3, 2)
    print("\nExpected 10 / 5 / 3 / 2 ->", "OK" if ok else "MISMATCH")
    first_wrong = next(r for r in result["review"] if r["selected_index"] is not None and not r["is_correct"])
    print("\nExample from the review (a wrong answer):")
    print("  Q:", first_wrong["question"])
    print("  You chose:", first_wrong["options"][first_wrong["selected_index"]])
    print("  Correct:  ", first_wrong["options"][first_wrong["correct_index"]])
    print("  Why:", first_wrong["explanation"])
 
 
if __name__ == "__main__":
    main()
 
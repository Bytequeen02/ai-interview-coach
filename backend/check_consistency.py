
"""
Scoring consistency check.
 
It takes a few fixed questions, each with one strong and one weak answer, and scores every
answer several times with the real AI. Then it prints how much the score moves between runs
(the "spread") and whether strong answers always score above weak ones.
 
It calls the evaluator directly, so the backend does NOT need to be running. Run it from the
backend folder (the one with main.py and .env):
 
    python check_consistency.py
 
Options:
    --repeats N      how many times each answer is scored (default 3)
    --pause SECONDS  wait between AI calls, to stay under the rate limit (default 4)
    --out FILE       also save the printed table to a text file
 
This measures the consistency of the scoring, not its accuracy. Only a small, hand-picked set
of answers is used, so the numbers describe this set and are not a general accuracy figure.
"""
 
import argparse
import time
 
CANDIDATE = {
    "candidate_name": "Consistency Check",
    "target_role": "Software Engineer",
    "experience_level": "Fresher",
    "interview_type": "Technical",
    "num_questions": 3,
    "mode": "friendly",
    "company_style": "general",
}
 
# (label, category, question, strong answer, weak answer)
CASES = [
    (
        "List vs tuple", "Technical",
        "Explain the difference between a list and a tuple in Python, and when you would use each.",
        "A list is mutable, so I can add, remove or change items after it is created. A tuple is immutable, "
        "so it cannot change. Because of that, a tuple can be used as a dictionary key or in a set, while a "
        "list cannot. I use a list for a collection that grows or changes, like a to-do list, and a tuple for "
        "a fixed record, like a point (x, y) or a row returned from a database. Tuples are also slightly "
        "lighter in memory and signal to other developers that the data should not change.",
        "They are both used to store things. I think a tuple is faster maybe. I am not sure about the rest.",
    ),
    (
        "Learning quickly", "Behavioral",
        "Tell me about a time you had to learn something new quickly.",
        "In my third year our team had to add a login system to a project, and nobody knew Flask. I was asked "
        "to own it with a one-week deadline. I read the official docs, built a small test app on the first "
        "weekend, and then asked a senior for a review of my password hashing. I finished two days early, "
        "the login worked for all 40 test users, and I wrote a short guide so the team could reuse it.",
        "I learn fast usually. I just read about things and it works out in the end.",
    ),
    (
        "BST search", "Technical",
        "What is the time complexity of searching in a balanced binary search tree, and why?",
        "It is O(log n). In a balanced tree the height is about log n, and at each node I compare the key "
        "and discard one half of the remaining nodes, like binary search. If the tree is not balanced, for "
        "example after inserting sorted data, it can degrade to a linked list and search becomes O(n). That is "
        "why self-balancing trees such as AVL or red-black trees are used.",
        "It is O(n) because you have to check every node one by one to find the value.",
    ),
]
 
 
def summarize(scores):
    """mean, lowest, highest and spread (highest - lowest) of a list of scores."""
    if not scores:
        return {"n": 0, "mean": None, "low": None, "high": None, "spread": None}
    low, high = min(scores), max(scores)
    return {"n": len(scores), "mean": round(sum(scores) / len(scores), 2), "low": low, "high": high,
            "spread": round(high - low, 2)}
 
 
def run(evaluate, cases, repeats, pause, sleep=time.sleep):
    """evaluate(candidate, question, answer, category) -> evaluation dict.
    Placeholder evaluations (is_fallback) are counted separately and never used in the numbers."""
    results = []
    for label, category, question, strong, weak in cases:
        row = {"label": label, "strong": [], "weak": [], "placeholders": 0}
        for kind, answer in (("strong", strong), ("weak", weak)):
            for _ in range(repeats):
                evaluation = evaluate(CANDIDATE, question, answer, category)
                if evaluation.get("is_fallback"):
                    row["placeholders"] += 1
                else:
                    row[kind].append(float(evaluation["overall_score"]))
                sleep(pause)
        results.append(row)
    return results
 
 
def report(results):
    lines = []
    add = lines.append
    add(f"{'Question':<18}{'Answer':<8}{'Scores':<22}{'Mean':<7}{'Spread':<7}")
    add("-" * 62)
    spreads = []
    ordering_ok = 0
    ordering_checked = 0
    for row in results:
        for kind in ("strong", "weak"):
            s = summarize(row[kind])
            scores = ", ".join(f"{x:g}" for x in row[kind]) or "(none)"
            add(f"{row['label'] if kind == 'strong' else '':<18}{kind:<8}{scores:<22}"
                f"{s['mean'] if s['mean'] is not None else '-':<7}{s['spread'] if s['spread'] is not None else '-':<7}")
            if s["spread"] is not None:
                spreads.append(s["spread"])
        if row["strong"] and row["weak"]:
            ordering_checked += 1
            if min(row["strong"]) > max(row["weak"]):
                ordering_ok += 1
        if row["placeholders"]:
            add(f"  (!) {row['placeholders']} placeholder result(s) for '{row['label']}' were left out (AI not used)")
    add("-" * 62)
    if spreads:
        add(f"Average spread between runs of the same answer: {round(sum(spreads) / len(spreads), 2)} points (out of 10)")
        add(f"Largest spread: {max(spreads)} points")
    else:
        add("No usable scores. Check the API key and the rate limit.")
    if ordering_checked:
        add(f"Strong answers scored above weak answers in every run for {ordering_ok} of {ordering_checked} questions")
    add("")
    add("This describes only these 3 questions and 6 answers. It is a consistency check, not an accuracy figure.")
    return "\n".join(lines)
 
 
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--pause", type=float, default=4.0)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
 
    from services import answer_evaluator, llm_client
    if not llm_client.is_configured():
        raise SystemExit("GEMINI_API_KEY is not set. Put it in backend/.env and run this from the backend folder.")
 
    total = len(CASES) * 2 * args.repeats
    print(f"Scoring {len(CASES) * 2} answers x {args.repeats} runs = {total} AI calls. This takes a few minutes ...", flush=True)
 
    def evaluate(candidate, question, answer, category):
        print(".", end="", flush=True)
        return answer_evaluator.evaluate_answer(candidate, question, answer, category)
 
    results = run(evaluate, CASES, args.repeats, args.pause)
    text = "\n\n" + report(results)
    print(text)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text.strip() + "\n")
        print(f"\nSaved to {args.out}")
 
 
if __name__ == "__main__":
    main()
 
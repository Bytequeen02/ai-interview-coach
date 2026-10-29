
"""Tests for the maths in check_consistency.py. A fake evaluator is used, so no AI call is made.
 
Run from the backend folder:  python -m pytest test_consistency.py -q
"""
 
import check_consistency as cc
 
 
def test_summarize():
    assert cc.summarize([7, 8, 7.5]) == {"n": 3, "mean": 7.5, "low": 7, "high": 8, "spread": 1}
    assert cc.summarize([6]) == {"n": 1, "mean": 6, "low": 6, "high": 6, "spread": 0}
    assert cc.summarize([])["spread"] is None
 
 
def fake_evaluator(strong_scores, weak_scores):
    """Returns a different score each call, taken from the lists in order of the calls."""
    queue = {"strong": list(strong_scores), "weak": list(weak_scores)}
 
    def evaluate(candidate, question, answer, category):
        for _, _, _, strong, weak in cc.CASES:
            if answer == strong:
                return {"overall_score": queue["strong"].pop(0), "is_fallback": False}
            if answer == weak:
                return {"overall_score": queue["weak"].pop(0), "is_fallback": False}
        raise AssertionError("unknown answer")
 
    return evaluate
 
 
def test_run_scores_every_answer_the_requested_number_of_times():
    slept = []
    results = cc.run(fake_evaluator([8, 8.5, 8] * 3, [2, 2, 3] * 3), cc.CASES, 3, 0.5, sleep=slept.append)
    assert len(results) == len(cc.CASES)
    assert all(len(r["strong"]) == 3 and len(r["weak"]) == 3 for r in results)
    assert len(slept) == len(cc.CASES) * 2 * 3
    assert all(r["placeholders"] == 0 for r in results)
 
 
def test_placeholder_results_are_left_out_of_the_numbers():
    def evaluate(candidate, question, answer, category):
        return {"overall_score": 5.0, "is_fallback": True}
 
    results = cc.run(evaluate, cc.CASES[:1], 2, 0, sleep=lambda s: None)
    assert results[0]["strong"] == [] and results[0]["weak"] == []
    assert results[0]["placeholders"] == 4
    assert "No usable scores" in cc.report(results)
 
 
def test_report_shows_spread_and_ordering():
    results = [
        {"label": "A", "strong": [8, 9, 8.5], "weak": [2, 3, 2], "placeholders": 0},
        {"label": "B", "strong": [6, 7, 6.5], "weak": [5, 7.5, 4], "placeholders": 0},   # one weak run beats a strong run
    ]
    text = cc.report(results)
    assert "Strong answers scored above weak answers in every run for 1 of 2 questions" in text
    assert "Largest spread: 3.5 points" in text
    assert "not an accuracy figure" in text
 
 
def test_the_fixed_cases_are_well_formed():
    assert len(cc.CASES) == 3
    for label, category, question, strong, weak in cc.CASES:
        assert category in ("Technical", "Behavioral")
        assert len(strong.split()) > len(weak.split())
 
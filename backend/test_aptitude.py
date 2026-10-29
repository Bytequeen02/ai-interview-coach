
"""Tests for the aptitude round: the question bank, choosing questions and scoring.
 
No network and no AI are used. Run from the backend folder:  python -m pytest test_aptitude.py -q
"""
 
import random
import re
from collections import Counter
 
import pytest
from fastapi.testclient import TestClient
 
import aptitude
import main
 
client = TestClient(main.app)
BANK = aptitude.BANK
BY_ID = {q["id"]: q for q in BANK}
 
 
# ======================= the question bank =======================
 
def test_bank_has_45_questions_balanced_by_section_and_difficulty():
    assert len(BANK) == 45
    counts = Counter((q["section"], q["difficulty"]) for q in BANK)
    for section in aptitude.SECTIONS:
        for difficulty in ["easy", "medium", "hard"]:
            assert counts[(section, difficulty)] == 5
 
 
def test_every_question_is_well_formed():
    assert len({q["id"] for q in BANK}) == len(BANK)
    for q in BANK:
        assert q["section"] in aptitude.SECTIONS
        assert len(q["options"]) == 4 and len(set(q["options"])) == 4
        assert 0 <= q["answer_index"] < 4
        assert q["question"].strip() and q["explanation"].strip()
 
 
def test_correct_answers_are_not_always_in_the_same_position():
    assert len({q["answer_index"] for q in BANK}) == 4
 
 
def _correct_text(qid):
    q = BY_ID[qid]
    return q["options"][q["answer_index"]]
 
 
def _number(text):
    return float(re.sub(r"[^0-9.]", "", text.replace(",", "")))
 
 
# The quant answers are checked a second time here with plain arithmetic,
# written separately from the bank, so a typing mistake in the bank is caught.
QUANT_EXPECTED = {
    "q101": 0.15 * 240,
    "q102": 800 * 0.75,
    "q103": (12 + 18 + 24 + 30) / 4,
    "q104": 180 / 3 * 5,
    "q105": (28 - 7) / 3,
    "q106": 30 * 2 / 5,
    "q107": (575 - 500) / 500 * 100,
    "q108": 1 / (1 / 12 + 1 / 6),
    "q109": 5000 * 0.08 * 3,
    "q110": 150 / 10 * 3.6,
    "q111": 1 / (1 / 20 + 1 / 30),
    "q112": 10000 * 1.1 * 1.1 - 10000,
    "q113": 35 + 49,
    "q114": 5 * 24 - 4 * 22,
    "q115": (12 / 2 - 12 / 3) / 2,
}
 
 
@pytest.mark.parametrize("qid,expected", QUANT_EXPECTED.items())
def test_quant_answers_match_independent_arithmetic(qid, expected):
    assert _number(_correct_text(qid)) == pytest.approx(expected)
 
 
# A few logical and verbal answers that are easy to re-check by hand.
def test_selected_logical_and_verbal_answers():
    assert _correct_text("q201") == "15"
    assert _correct_text("q204") == "Thursday"        # Monday + 10 days
    assert _correct_text("q206") == "95"              # x2 + 1 series
    assert _correct_text("q207") == "CBH"
    assert _correct_text("q211") == "23"
    assert _correct_text("q212") == "P"
    assert _correct_text("q214") == "75 degrees"
    assert _correct_text("q215") == "ab"
    assert _correct_text("q303") == "goes"
    assert _correct_text("q314") == "QRP"
 
 
# ======================= choosing questions =======================
 
def test_questions_are_spread_over_the_chosen_sections():
    chosen = aptitude.choose_questions(["quant", "logical", "verbal"], 20, "mixed", random.Random(1))
    counts = Counter(q["section"] for q in chosen)
    assert len(chosen) == 20
    assert sorted(counts.values()) == [6, 7, 7]
 
 
def test_chosen_questions_are_grouped_by_section_in_the_order_asked_for():
    chosen = aptitude.choose_questions(["verbal", "quant"], 10, "mixed", random.Random(2))
    sections = [q["section"] for q in chosen]
    assert sections == sorted(sections, key=["verbal", "quant"].index)
 
 
def test_asking_for_more_than_the_bank_has_returns_what_exists():
    assert len(aptitude.choose_questions(["quant"], 60, "mixed")) == 15
    assert len(aptitude.choose_questions(["quant"], 40, "hard")) == 5
    assert len(aptitude.choose_questions(["quant", "logical", "verbal"], 60, "mixed")) == 45
 
 
def test_a_short_section_is_made_up_from_the_others():
    chosen = aptitude.choose_questions(["quant", "logical"], 29, "hard", random.Random(3))
    assert len(chosen) == 10                                     # only 5 + 5 hard questions exist
 
 
def test_difficulty_filter():
    chosen = aptitude.choose_questions(["quant", "logical", "verbal"], 12, "easy")
    assert chosen and all(q["difficulty"] == "easy" for q in chosen)
 
 
def test_no_duplicate_questions_and_duplicate_sections_are_ignored():
    chosen = aptitude.choose_questions(["quant", "quant"], 10, "mixed")
    assert len({q["id"] for q in chosen}) == len(chosen) == 10
 
 
# ======================= the API =======================
 
def start(**body):
    payload = {"sections": ["quant", "logical", "verbal"], "count": 10, "difficulty": "mixed"}
    payload.update(body)
    return client.post("/api/aptitude/start", json=payload)
 
 
def test_start_response_shape_and_timer():
    r = start(count=12)
    assert r.status_code == 200
    data = r.json()
    assert len(data["questions"]) == 12
    assert data["duration_seconds"] == 12 * 60
    assert data["round_id"]
    assert set(data["questions"][0]) == {"id", "section", "question", "options"}
 
 
def test_start_never_sends_answers_or_explanations():
    text = start(count=45).text
    assert "answer_index" not in text and "explanation" not in text and "correct_index" not in text
 
 
def test_start_rejects_bad_input():
    assert start(sections=[]).status_code == 422
    assert start(sections=["maths"]).status_code == 422
    assert start(count=0).status_code == 422
    assert start(count=500).status_code == 422
    assert start(difficulty="impossible").status_code == 422
 
 
def submit(data, answers, **extra):
    return client.post("/api/aptitude/submit", json={"round_id": data["round_id"], "answers": answers, **extra})
 
 
def answer_for(qid, kind):
    q = BY_ID[qid]
    if kind == "skip":
        return {"id": qid, "selected_index": None}
    index = q["answer_index"] if kind == "right" else (q["answer_index"] + 1) % 4
    return {"id": qid, "selected_index": index}
 
 
def test_scoring_counts_right_wrong_and_skipped():
    data = start(count=10).json()
    ids = [q["id"] for q in data["questions"]]
    kinds = ["right"] * 5 + ["wrong"] * 3 + ["skip"] * 2
    result = submit(data, [answer_for(i, k) for i, k in zip(ids, kinds)], time_taken_seconds=300).json()
    assert (result["total"], result["correct"], result["wrong"], result["skipped"]) == (10, 5, 3, 2)
    assert result["percent"] == 50.0
    assert sum(s["total"] for s in result["by_section"].values()) == 10
    assert sum(s["correct"] for s in result["by_section"].values()) == 5
 
 
def test_questions_left_out_of_the_answers_count_as_skipped():
    data = start(count=10).json()
    ids = [q["id"] for q in data["questions"]]
    result = submit(data, [answer_for(ids[0], "right")]).json()
    assert result["correct"] == 1 and result["skipped"] == 9 and result["wrong"] == 0
 
 
def test_review_has_the_right_answer_and_explanation_for_every_question():
    data = start(count=6).json()
    ids = [q["id"] for q in data["questions"]]
    result = submit(data, [answer_for(ids[0], "wrong")]).json()
    assert len(result["review"]) == 6
    first = result["review"][0]
    assert first["is_correct"] is False
    assert first["correct_index"] == BY_ID[ids[0]]["answer_index"]
    assert first["explanation"] == BY_ID[ids[0]]["explanation"]
    assert first["options"] == BY_ID[ids[0]]["options"]
    assert result["review"][1]["selected_index"] is None
 
 
def test_perfect_score():
    data = start(count=9).json()
    result = submit(data, [answer_for(q["id"], "right") for q in data["questions"]]).json()
    assert result["percent"] == 100.0 and result["correct"] == 9
 
 
def test_by_section_only_lists_sections_in_the_round():
    data = start(sections=["verbal"], count=5).json()
    result = submit(data, []).json()
    assert list(result["by_section"]) == ["verbal"]
 
 
def test_unknown_round_is_404():
    r = client.post("/api/aptitude/submit", json={"round_id": "nope", "answers": []})
    assert r.status_code == 404
 
 
def test_submitting_twice_returns_the_same_result():
    data = start(count=5).json()
    first = submit(data, [answer_for(data["questions"][0]["id"], "right")]).json()
    again = submit(data, [answer_for(data["questions"][0]["id"], "wrong")]).json()
    assert first == again
 
 
def test_invalid_selected_index_is_rejected():
    data = start(count=3).json()
    r = submit(data, [{"id": data["questions"][0]["id"], "selected_index": 7}])
    assert r.status_code == 422
 
 
def test_answers_for_questions_not_in_the_round_are_ignored():
    data = start(count=3).json()
    result = submit(data, [{"id": "q999", "selected_index": 1}]).json()
    assert result["total"] == 3 and result["skipped"] == 3
 
 
def test_old_rounds_are_dropped_after_the_limit(monkeypatch):
    monkeypatch.setattr(aptitude, "MAX_STORED_ROUNDS", 3)
    first = start(count=1).json()
    for _ in range(3):
        start(count=1)
    assert submit(first, []).status_code == 404

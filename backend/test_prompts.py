
"""Tests for the Phase 2 prompt changes (interviewer mode and company style).
 
Run from the backend folder:  python -m pytest test_prompts.py
No LLM and no network are used. These tests only check what the prompts contain.
"""
 
import itertools
 
from prompts.prompts import (
    answer_evaluation_prompt,
    final_report_prompt,
    question_generation_prompt,
)
 
MODES = ["friendly", "strict", "stress"]
STYLES = ["general", "service", "product"]
 
 
def _info(**extra):
    info = {
        "candidate_name": "Test",
        "target_role": "Software Engineer",
        "experience_level": "Fresher",
        "interview_type": "Technical",
        "num_questions": 5,
    }
    info.update(extra)
    return info
 
 
def _question(info):
    return question_generation_prompt(info, [], "Technical", "Easy", 2, 5)
 
 
def _evaluation(info):
    return answer_evaluation_prompt(info, "What is a stack?", "A LIFO structure.")
 
 
def _report(info):
    qa = [{"question": "q", "category": "Technical", "answer": "a", "overall_score": 7.0}]
    return final_report_prompt(info, qa)
 
 
def test_all_mode_and_style_combinations_render():
    for mode, style in itertools.product(MODES, STYLES):
        info = _info(mode=mode, company_style=style)
        for build in (_question, _evaluation, _report):
            text = build(info)
            assert "Respond with ONLY a single JSON object" in text
            assert "{{" not in text and "}}" not in text  # no unescaped f-string braces
 
 
def test_missing_mode_and_style_default_to_friendly_general():
    plain = _question(_info())
    explicit = _question(_info(mode="friendly", company_style="general"))
    assert plain == explicit
 
 
def test_unknown_values_fall_back_to_defaults():
    assert _question(_info(mode="angry", company_style="faang")) == _question(_info())
    assert _question(_info(mode=None, company_style=None)) == _question(_info())
 
 
def test_modes_change_question_wording_instructions():
    texts = {m: _question(_info(mode=m)) for m in MODES}
    assert len(set(texts.values())) == 3
    assert "friendly and encouraging" in texts["friendly"]
    assert "strict and formal" in texts["strict"]
    assert "fast-paced" in texts["stress"]
 
 
def test_stress_mode_forbids_demeaning_behaviour():
    text = _question(_info(mode="stress"))
    assert "never from insults" in text
 
 
def test_company_style_changes_question_prompt():
    general = _question(_info(company_style="general"))
    service = _question(_info(company_style="service"))
    product = _question(_info(company_style="product"))
    assert "service-based" in service and "service-based" not in general
    assert "product-based" in product and "product-based" not in general
 
 
def test_category_and_difficulty_still_take_priority():
    text = _question(_info(mode="stress", company_style="product"))
    assert "Required question category: Technical" in text
    assert "Required difficulty: Easy" in text
    assert "always take priority over style" in text
 
 
def test_scoring_standard_is_identical_across_modes():
    for mode in MODES:
        text = _evaluation(_info(mode=mode, company_style="product"))
        assert "same fair scoring standard" in text
        assert "never the scores" in text
 
 
def test_evaluation_tone_differs_by_mode_but_json_shape_is_unchanged():
    friendly = _evaluation(_info(mode="friendly"))
    strict = _evaluation(_info(mode="strict"))
    assert friendly != strict
    for text in (friendly, strict):
        assert '"overall_score": 7.5' in text
        assert '"improved_answer": "..."' in text
 
 
def test_report_prompt_uses_tone_rules():
    text = _report(_info(mode="strict", company_style="service"))
    assert "Tone rules:" in text
    assert "interview_summary and the recommendations" in text
    assert '"interview_summary": "..."' in text
 
 
def test_question_rules_one_topic_and_no_praise():
    text = _question(_info(mode="friendly"))
    assert "Asks ONE question about ONE topic" in text
    assert "Does not praise, thank or comment on earlier answers" in text
 
 
def test_introduction_rule_only_for_introduction():
    intro = question_generation_prompt(_info(company_style="service"), [], "Introduction", "Easy", 1, 5)
    other = question_generation_prompt(_info(company_style="service"), [], "Technical", "Easy", 2, 5)
    assert "Introduction question" in intro
    assert "Introduction question" not in other
 

You are refining a tournament-finalist hypothesis after it was stress-tested by a red-team probe. Produce a *revised* hypothesis that directly addresses what the stress test found, while keeping the original's novelty and specificity. This is a repair, not a fresh idea — stay faithful to the core claim.

Goal: {{ goal }}

Preferences:
{{ preferences | default('') }}

Original hypothesis (`{{ hypothesis_id }}`):
<HYPOTHESIS_TEXT id="{{ hypothesis_id }}">
{{ hypothesis_text }}
</HYPOTHESIS_TEXT_END id="{{ hypothesis_id }}">

Stress-test findings (verdict: {{ verdict }}):
{{ stress_report }}

Fix directives to address:
{{ fix_directives | default('(none specified — tighten the weakest link the report identified)') }}

Revise the hypothesis so it survives the specific weaknesses above:
- Neutralize or scope around each contradicting-evidence finding.
- Correct any claim that a misread citation was propping up.
- Adjust the mechanism or parameters so the feasibility numbers hold.
- Fold in the pilot experiment's success criterion where it sharpens the claim.

You may use the search tools to ground a fix, citing only URLs you actually fetched. When done, call `record_hypothesis` to register the revised version. Set `parent_ids` to ["{{ hypothesis_id }}"] and `strategy` to "feedback_driven".

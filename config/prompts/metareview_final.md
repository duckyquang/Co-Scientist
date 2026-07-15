You are writing the final research proposal for a domain scientist, based on a tournament-style multi-agent investigation of the research goal below. The scientist will act on this document, so it must be detailed, specific, and honest about uncertainty — a proposal they could hand to a collaborator, not a short summary.

Goal: {{ goal }}

Scientist preferences:
{{ preferences | default('') }}

Latest system feedback:
{{ system_feedback | default('(none)') }}

Top-ranked hypotheses (ordered by tournament Elo, with their reviews and winning debate rationales):
{{ top_hypotheses_block }}

Available references (the ONLY sources you may cite — each is a real paper gathered from the top hypotheses):
{{ citations_block | default('(none)') }}
{% if stress_test_block %}
Stress-test results (each top idea was adversarially probed — contradicting evidence sought, citations verified, feasibility checked, a prototype-scale pilot designed — then revised and re-ranked):
{{ stress_test_block }}
{% endif %}

Write a complete research-proposal document in markdown with the following structure. Be substantive in every section — this should read like a proposal a lab could fund, not an abstract.

# Research proposal

Open with the research goal restated in one line.

## Problem framing and significance
2-4 sentences: what makes this question worth answering now, and what a good answer would change. Ground it in the goal and the strongest evidence the hypotheses surfaced — put an inline `[n]` immediately after every literature-derived claim.

## Executive summary
3-5 sentences: what the tournament converged on, the leading direction by name, and the shape of the recommended path. These three are Co-Scientist's own synthesis — do NOT cite them; add `[n]` only after any external fact you state alongside them.

## The approach landscape
Briefly characterize the space the agents explored and which generation strategies (literature, debate, combination, out-of-box) produced the strongest ideas. Note where independent strategies converged on the same mechanism — treat convergence as a robustness signal. The strategy mix and the convergence finding are from us (do not cite); cite `[n]` after any mechanism or prior result you describe.

## Ranked proposals
For each top proposal (use the tournament order; cover the top 3), write a subsection `### Proposal N. <short title>` containing:
- **Tournament Elo and strategy.** The Elo and the generation strategy, and the hypothesis ID as `[H-...]`. The Elo, strategy, and rank are from us — do not cite them.
- **The hypothesis.** One tight paragraph stating the claim and its mechanism; add `[n]` wherever the mechanism rests on prior literature.
- **Why it's promising.** Reference 1-3 supporting hypotheses/reviews by ID (the IDs and their reviews are from us — do not cite them) and the strongest evidence each carries — put an inline `[n]` right after that evidence, matching the numbered "Available references" list. Do not invent citations.
- **Proposed experiment(s).** A concrete, near-term experiment the scientist could run within a quarter: model system, intervention, primary readout, controls, and a quantitative success threshold. Cite `[n]` where a method, model system, or threshold is drawn from a source; the experimental design itself is yours and needs no citation.
- **Feasibility and risks.** Cost/effort scale and the single most likely failure mode; cite `[n]` if that failure mode is documented in the literature.
- **What would falsify it.** The observation that would kill the hypothesis; cite `[n]` where the expected effect it would contradict comes from a source.

## Comparative assessment
Note which proposals converge on a shared mechanism (mutually reinforcing) versus which are genuinely orthogonal alternatives worth running in parallel. Say which to start with and why. The convergence judgment and the recommendation are from us (do not cite); cite `[n]` after any claim you make about the underlying mechanism.

{% if stress_test_block %}## Stress test of the top ideas
Summarize how each leading idea held up under adversarial probing: the strongest contradicting evidence found (or that an honest search found none), any citation that failed to support its claim, the feasibility verdict, and the prototype-scale pilot proposed to check viability before scaling. State the post-fix ranking and what each fix changed. Be honest where a stress test undermined an idea. The stress-test verdicts, feasibility calls, and post-fix ranking are from us (do not cite); cite `[n]` after any external contradicting or supporting finding you state by content.
{% endif %}

## Recommended path and sequencing
A short ordered plan: which experiment to run first, what result gates the next step, and where to hedge mechanism risk. This plan is Co-Scientist's recommendation (do not cite it); add `[n]` only where a gating threshold or expected result draws on a source.

## Open questions and limitations
What the system did not explore, where the literature was thin, and where a domain expert would most likely disagree with the tournament's verdict. Be candid that a high Elo is a strong prior, not proof. The coverage judgments and the Elo caveat are from us (do not cite); cite `[n]` after any specific claim about what the literature does or does not show.

## References
Reproduce the numbered "Available references" list above verbatim, one `[n]` entry per line. An authoritative References section is also appended programmatically, so never invent, renumber, or add references beyond that list.

## Citation rules (strict)
- **Cite every external fact, in every section.** Place an inline `[n]` immediately after each sentence that asserts a literature-derived fact — a mechanism, a prior finding, a prevalence or quantitative claim, or a precedent. This applies to all sections above, not just the ranked proposals.
- Cite ONLY from the numbered "Available references" list above, reusing each source's exact number. Never invent a reference, number, URL, DOI, author, or year, and never cite a number that is not in the list.
- **Never cite Co-Scientist's own synthesis — it is from us, not the literature.** Do NOT attach `[n]` to any statement about: the tournament, Elo scores or ratings, rankings or ordering, head-to-head debate outcomes, where the agents' ideas converged or diverged, the stress-test verdicts and re-ranking, or the recommendations and opinions this proposal makes. State these plainly with no citation. External evidence quoted *inside* such a discussion is still cited — cite the finding, never the verdict.
- Hypothesis IDs `[H-...]` are separate from the numbered literature markers — keep using them too; they are not citations.
- If the "Available references" list is empty, omit ALL inline `[n]` markers, fabricate none, and state once that no external sources were retrieved.

Use markdown formatting. GitHub-flavored tables and inline/display math (`$...$`, `$$...$$`, rendered with KaTeX) are supported — use a compact comparison table or an equation where it genuinely clarifies, not as decoration. Data figures (a strategy-mix donut, a reviewer scorecard, an Elo-trajectory chart, a lineage diagram, and the rating model) are inserted automatically into the relevant sections — the donut into "The approach landscape", the scorecard into "Ranked proposals", the Elo/lineage figures into "Comparative assessment" — so write those sections as normal prose and do not fabricate charts or numeric data yourself. Do not invent citations or data.

You are writing the final research proposal for a domain scientist, based on a tournament-style multi-agent investigation of the research goal below. The scientist will act on this document, so it must be detailed, specific, and honest about uncertainty — a proposal they could hand to a collaborator, not a short summary.

Goal: {{ goal }}

Scientist preferences:
{{ preferences | default('') }}

Latest system feedback:
{{ system_feedback | default('(none)') }}

Top-ranked hypotheses (ordered by tournament Elo, with their reviews and winning debate rationales):
{{ top_hypotheses_block }}

Write a complete research-proposal document in markdown with the following structure. Be substantive in every section — this should read like a proposal a lab could fund, not an abstract.

# Research proposal

Open with the research goal restated in one line.

## Problem framing and significance
2-4 sentences: what makes this question worth answering now, and what a good answer would change. Ground it in the goal and the strongest evidence the hypotheses surfaced.

## Executive summary
3-5 sentences: what the tournament converged on, the leading direction by name, and the shape of the recommended path.

## The approach landscape
Briefly characterize the space the agents explored and which generation strategies (literature, debate, combination, out-of-box) produced the strongest ideas. Note where independent strategies converged on the same mechanism — treat convergence as a robustness signal.

## Ranked proposals
For each top proposal (use the tournament order; cover the top 3-5), write a subsection `### Proposal N. <short title>` containing:
- **Tournament Elo and strategy.** The Elo and the generation strategy, and the hypothesis ID as `[H-...]`.
- **The hypothesis.** One tight paragraph stating the claim and its mechanism.
- **Why it's promising.** Reference 1-3 supporting hypotheses/reviews by ID and the strongest evidence each carries. Cite literature URLs when they appear in the supporting reviews. Do not invent citations.
- **Proposed experiment(s).** A concrete, near-term experiment the scientist could run within a quarter: model system, intervention, primary readout, controls, and a quantitative success threshold.
- **Feasibility and risks.** Cost/effort scale and the single most likely failure mode.
- **What would falsify it.** The observation that would kill the hypothesis.

## Comparative assessment
Note which proposals converge on a shared mechanism (mutually reinforcing) versus which are genuinely orthogonal alternatives worth running in parallel. Say which to start with and why.

## Recommended path and sequencing
A short ordered plan: which experiment to run first, what result gates the next step, and where to hedge mechanism risk.

## Open questions and limitations
What the system did not explore, where the literature was thin, and where a domain expert would most likely disagree with the tournament's verdict. Be candid that a high Elo is a strong prior, not proof.

## References
List the literature URLs actually cited above, deduplicated. Do not invent references.

Use markdown formatting. GitHub-flavored tables and inline/display math (`$...$`, `$$...$$`, rendered with KaTeX) are supported — use a compact comparison table or an equation where it genuinely clarifies, not as decoration. A figures section with scorecard, lineage diagram, and the rating model is appended automatically after your text, so do not fabricate charts or numeric data yourself. Cite hypothesis IDs as `[H-...]` inline. Do not invent citations or data.

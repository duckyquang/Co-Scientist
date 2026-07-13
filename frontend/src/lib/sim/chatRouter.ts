/** Shared keyword heuristic for the browser simulator's chat follow-ups.
 *  Mirrors the Python router in `webapp/content.py` (runtime B) so the two
 *  no-LLM backends classify the same way. Runtime C uses the LLM instead.
 */

export const OUT_OF_SCOPE = "Currently, Co-Scientist is unable to do this.";

export type ChatIntent = "question" | "tweak" | "out_of_scope";

// External-action verbs Co-Scientist can't do → out_of_scope. Kept specific so
// genuine questions ("summarize the findings", "in order to test this…") aren't
// mis-routed.
const EXTERNAL =
  /\b(book|flight|hotel|email|e-mail|buy|purchase|checkout|pay|invest|patent|deploy|hire|manufacture|order\s+(?:me|it|a|the)|call\s+(?:me|them|him|her))\b|run the (?:wet-?lab|experiment)|send (?:an? )?(?:email|message|text)|schedule (?:an? )?(?:meeting|call|appointment)/i;

// Tweak/update/fix verbs → tweak (spawn a new run).
const TWEAK =
  /\b(change|update|tweak|fix|add|remove|modify|replace|improve|revise|refine|instead|rather|swap|drop|extend|different|adjust|rework|rewrite|redo|broaden|narrow|expand)\b/i;

export function classifyIntent(message: string): ChatIntent {
  const m = message || "";
  if (EXTERNAL.test(m)) return "out_of_scope";
  if (TWEAK.test(m)) return "tweak";
  return "question"; // default: answer from data, don't stonewall
}

/** The verbatim rerun-goal template (identical across all runtimes). */
export function composeRerunGoal(idea: string, changeRequest: string): string {
  return (
    `ORIGINAL IDEA: ${idea}\n\n` +
    `FEEDBACK / CHANGE WANTED: ${changeRequest}\n\n` +
    "Suggest a new method based on the original idea and the feedback / change wanted."
  );
}

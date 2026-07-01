/** Prompt → real hypotheses, via the best available LLM provider.
 *
 * This is what makes Co-Scientist actually READ the prompt: instead of picking
 * from fixed templates, we ask a real model (Groq if a key is baked in, else a
 * free keyless model) to generate distinct, goal-specific hypotheses — each with
 * a mechanism, a concrete experiment, and a critical review — plus a final
 * overview. The engine runs its Elo tournament over this content.
 *
 * CONTRACT: `generateSession` RESOLVES ALWAYS — with real content when a
 * provider answers, or with an empty result (source "fallback") when every
 * provider is unreachable/times out, so the engine degrades to its prompt-aware
 * template instead of showing a dead "failed" session. It rejects ONLY when the
 * caller aborts (`signal`).
 */

import { chatJson, type LlmProvider } from "../llm";

export interface GenHyp {
  title: string;
  summary: string;
  mechanism: string;
  experiment: string;
  predicted_outcome: string;
  verdict: string;
  novelty: number;
  correctness: number;
  testability: number;
  feasibility: number;
  critique: string;
}

export interface GeneratedContent {
  hyps: GenHyp[];
  overview: string;
  /** Where the content came from — for honest UI provenance / debugging. */
  source: LlmProvider | "fallback";
}

const clamp01 = (n: any) => {
  const v = typeof n === "number" ? n : parseFloat(n);
  if (!Number.isFinite(v)) return 0.6;
  return Math.max(0, Math.min(1, v > 1 ? v / 100 : v));
};

const str = (v: any, fallback = "") => (typeof v === "string" && v.trim() ? v.trim() : fallback);

/** Generate `count` hypotheses + an overview that genuinely address `goal`. */
export async function generateSession(
  goal: string,
  count: number,
  signal?: AbortSignal,
): Promise<GeneratedContent> {
  const system =
    "You are Co-Scientist, a rigorous multi-agent scientific hypothesis engine. " +
    "Given a research goal in ANY field, you generate distinct, specific, testable hypotheses " +
    "grounded in the real subject matter of that goal — correct field, real mechanisms, real entities, " +
    "real methods — and a critical review of each. You never return generic filler unrelated to the goal. " +
    "Respond with ONLY a single valid JSON object, no prose, no code fences.";

  const user =
    `Research goal: "${goal}"\n\n` +
    `Generate exactly ${count} DISTINCT hypotheses that directly and specifically address this goal. ` +
    `Each must be clearly about the goal's actual topic and field. Vary the angle across hypotheses ` +
    `(e.g. different mechanisms, scales, or strategies). Then write a final overview.\n\n` +
    `Return JSON with this exact shape:\n` +
    `{\n` +
    `  "hypotheses": [\n` +
    `    {\n` +
    `      "title": "concise hypothesis statement, max ~110 chars, specific to the goal",\n` +
    `      "summary": "1-2 sentence plain-language summary",\n` +
    `      "mechanism": "2-3 sentences on WHY this could be true (the proposed mechanism)",\n` +
    `      "experiment": "2-3 sentences: a concrete experiment or analysis to test it, with a measurable readout",\n` +
    `      "predicted_outcome": "1 sentence on the expected result if the hypothesis holds",\n` +
    `      "verdict": "one of: well_grounded, promising, needs_work, speculative",\n` +
    `      "novelty": 0.0-1.0, "correctness": 0.0-1.0, "testability": 0.0-1.0, "feasibility": 0.0-1.0,\n` +
    `      "critique": "2-3 sentence critical review naming the key risk or assumption"\n` +
    `    }\n` +
    `  ],\n` +
    `  "overview": "150-250 word markdown overview: an executive summary, the cross-cutting themes ACROSS these specific hypotheses, and recommended next experiments. Reference the actual hypotheses."\n` +
    `}`;

  try {
    const { data, provider } = await chatJson<{ hypotheses: any[]; overview: string }>({
      system,
      user,
      temperature: 0.85,
      signal,
    });

    // Validate the shape before trusting it (a refusal / garbled reply → fallback).
    const raw = Array.isArray(data?.hypotheses) ? data.hypotheses : [];
    const usable = raw.filter(
      (h: any) => h && (typeof h.title === "string" || typeof h.summary === "string"),
    );
    if (usable.length === 0) throw new Error("no usable hypotheses");

    const hyps: GenHyp[] = usable.slice(0, count).map((h: any, i: number) => ({
      title: str(h?.title, `Hypothesis ${i + 1}`),
      summary: str(h?.summary, str(h?.title)),
      mechanism: str(h?.mechanism),
      experiment: str(h?.experiment),
      predicted_outcome: str(h?.predicted_outcome),
      verdict: str(h?.verdict, "promising"),
      novelty: clamp01(h?.novelty),
      correctness: clamp01(h?.correctness),
      testability: clamp01(h?.testability),
      feasibility: clamp01(h?.feasibility),
      critique: str(h?.critique),
    }));

    return { hyps, overview: str(data?.overview), source: provider };
  } catch (err: any) {
    // Caller aborted → propagate so the engine can react (it degrades to template).
    if (signal?.aborted) throw err;
    // Any other failure (offline, rate-limit, bot-gate, refusal, bad JSON) →
    // resolve with an EMPTY result; the engine builds the tournament from the
    // prompt-aware content.ts templates. Never a dead "failed" session.
    return { hyps: [], overview: "", source: "fallback" };
  }
}

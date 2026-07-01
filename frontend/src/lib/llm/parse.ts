/** Tolerant JSON extraction shared by all LLM providers.
 *
 * Free/keyless models return messy output: fenced ```json blocks, prose around
 * the object, the JSON stuffed in a `reasoning` field with empty `content`,
 * trailing commas, or truncation. This module turns any of that into an object
 * (or throws a clear error) so callers never hand-roll parsing.
 */

/** Pull the first balanced {...} object out of a string (handles prose/fences). */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // Unbalanced (truncated) — return from the first brace so the salvage pass can try.
  return text.slice(start);
}

/** Best-effort repair of common model JSON glitches. */
function repair(json: string): string {
  return json
    // strip trailing commas before } or ]
    .replace(/,(\s*[}\]])/g, "$1")
    // smart quotes → straight quotes
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

/** Parse a raw model string into an object, tolerating fences/prose/glitches. */
export function extractJsonObject<T = any>(raw: string): T {
  if (!raw || !raw.trim()) throw new Error("Empty model output");
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();

  // 1) straight parse
  try { return JSON.parse(cleaned) as T; } catch { /* fall through */ }

  // 2) first balanced object
  const block = firstJsonObject(cleaned);
  if (block) {
    try { return JSON.parse(block) as T; } catch { /* fall through */ }
    try { return JSON.parse(repair(block)) as T; } catch { /* fall through */ }
  }
  throw new Error("Model did not return parseable JSON");
}

/** Extract the assistant text from an OpenAI-compatible chat response.
 *  Falls back to `reasoning` (some keyless reasoning models leave `content` empty). */
export function messageText(data: any): string {
  const msg = data?.choices?.[0]?.message;
  const content = typeof msg?.content === "string" ? msg.content.trim() : "";
  if (content) return content;
  const reasoning = typeof msg?.reasoning === "string" ? msg.reasoning.trim() : "";
  return reasoning;
}

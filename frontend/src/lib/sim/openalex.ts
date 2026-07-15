/** Live literature retrieval for the in-browser demo, via OpenAlex.
 *
 * OpenAlex is keyless and CORS-enabled (`Access-Control-Allow-Origin: *`), so a
 * browser `fetch` works with no backend and no credential. We query it for the
 * research goal and hand the engine real, topically-matched papers — so a prompt
 * about traffic yields traffic citations and a prompt about batteries yields
 * battery citations, all with DOIs that actually resolve.
 *
 * This NEVER blocks the deterministic timeline: the fetch is fire-and-forget and
 * fills citations in when it resolves. On ANY failure (offline, timeout, blocked,
 * empty) it returns [] and the engine falls back to the curated REAL_PAPERS list,
 * so the pure offline GitHub-Pages demo still shows citations with no crash.
 */

import type { SimCitation } from "./content";

const OPENALEX_URL = "https://api.openalex.org/works";
const TIMEOUT_MS = 6_000;
// OpenAlex "polite pool" contact — a non-personal, project-identifying address.
// ponytail: hard-coded; wire to an env var only if the deploy needs its own.
const MAILTO = "co-scientist-demo@users.noreply.github.com";

/** OpenAlex stores abstracts as an inverted index {word: [positions]}; rebuild
 *  the leading prose and clip to ~200 chars for the citation excerpt. */
function abstractSnippet(inv: Record<string, number[]> | null | undefined): string {
  if (!inv || typeof inv !== "object") return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(inv)) {
    if (!Array.isArray(positions)) continue;
    for (const p of positions) if (typeof p === "number" && p >= 0) words[p] = word;
  }
  const text = words.join(" ").replace(/\s+/g, " ").trim();
  return text.length > 200 ? text.slice(0, 200).replace(/\s+\S*$/, "") + "…" : text;
}

/** Fetch up to `n` real, topically-matched citations from OpenAlex. Returns []
 *  on ANY failure/timeout/offline/empty — never throws, so the caller can safely
 *  fall back to the curated list. Mirrors the pollinations.ts fetch-with-timeout
 *  pattern (AbortController + setTimeout + try/finally clearTimeout). */
export async function fetchOpenAlexCitations(query: string, n = 4): Promise<SimCitation[]> {
  const q = query.trim();
  if (!q) return [];
  // Cheap short-circuit when the browser knows it is offline (avoids a console
  // network-error line); still attempts when online-or-unknown.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return [];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const perPage = Math.min(Math.max(n, 1), 25);
    const url =
      `${OPENALEX_URL}?search=${encodeURIComponent(q)}` +
      `&per-page=${perPage}&mailto=${encodeURIComponent(MAILTO)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`OpenAlex request failed (${res.status})`);
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];

    const out: SimCitation[] = [];
    const seen = new Set<string>();
    for (const w of results) {
      const title = typeof w?.title === "string" ? w.title.trim() : "";
      if (!title) continue;
      // OpenAlex DOIs come as full URLs ("https://doi.org/10..."); store the bare
      // "10..." form so the drawer/References render consistently.
      const doi =
        typeof w?.doi === "string"
          ? w.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim() || null
          : null;
      const key = (doi || title).toLowerCase();
      if (seen.has(key)) continue; // dedupe by doi (else title)
      const link = doi ? `https://doi.org/${doi}` : (typeof w?.id === "string" ? w.id : "");
      if (!link) continue; // no resolvable target → skip
      seen.add(key);
      out.push({
        title,
        url: link,
        doi,
        year: typeof w?.publication_year === "number" ? w.publication_year : null,
        excerpt: abstractSnippet(w?.abstract_inverted_index) || null,
      });
      if (out.length >= n) break;
    }
    return out;
  } catch {
    return []; // offline / timeout / blocked / bad JSON → curated fallback
  } finally {
    clearTimeout(timer);
  }
}

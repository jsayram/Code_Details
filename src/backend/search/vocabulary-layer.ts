// D09 vocabulary layer (S01 approach A1, moved here from the bench in S02a): a
// small application-owned layer in front of native Convex search. Pure, no
// Node or Convex imports, so the Convex functions use it too. Indexing
// rewrites technology identifiers into opaque tokens (zz<id>zz) that the
// tokenizer keeps whole, so `C++`, `C#`,
// `.NET` and `C` stop collapsing into the same `c`/`net` terms; queries get
// the same rewrite, reviewed aliases, one-way narrower terms and a bounded
// typo correction against a known dictionary (vocabulary plus corpus terms).
// The trailing `zz` keeps native prefix matching on the last term from
// turning `zzczz` into a prefix of `zzcppzz`.

import { SEARCH_VOCABULARY, type VocabularyEntry } from "./vocabulary";

export const token = (id: string) => `zz${id.replace(/[^a-z0-9]/g, "")}zz`;

interface Form {
  form: string;
  id: string;
  short: boolean;
  punct: boolean;
}

const byId = new Map<string, VocabularyEntry>(SEARCH_VOCABULARY.map((v) => [v.id, v]));

const FORMS: Form[] = (() => {
  const seen = new Set<string>();
  const out: Form[] = [];
  for (const v of SEARCH_VOCABULARY) {
    for (const raw of [v.label, v.id, ...v.aliases]) {
      const form = raw.toLowerCase();
      if (seen.has(form)) continue;
      seen.add(form);
      out.push({ form, id: v.id, short: form.replace(/[^a-z0-9]/g, "").length <= 2, punct: /[^a-z0-9 ]/.test(form) });
    }
  }
  return out.sort((a, b) => b.form.length - a.form.length);
})();

const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/**
 * Finds vocabulary forms in text, longest first, without overlaps. In stored
 * text a short form (`C`, `Go`, `R`, `js`) must match the label's or alias's
 * exact case, so the English word "go" doesn't become the Go language; in a
 * query everything is matched case-insensitively.
 */
function scan(text: string, caseSensitiveShort: boolean): { start: number; end: number; f: Form }[] {
  const lower = text.toLowerCase();
  const taken = new Array<boolean>(text.length).fill(false);
  const hits: { start: number; end: number; f: Form }[] = [];
  for (const f of FORMS) {
    let from = 0;
    for (;;) {
      const i = lower.indexOf(f.form, from);
      if (i === -1) break;
      from = i + 1;
      const end = i + f.form.length;
      if (isWord(text[i - 1]) || isWord(text[end]) || text[end] === "+" || text[end] === "#") continue;
      if (taken.slice(i, end).some(Boolean)) continue;
      if (caseSensitiveShort && f.short) {
        const v = byId.get(f.id)!;
        const exact = [v.label, ...v.aliases].some((s) => text.slice(i, end) === s);
        if (!exact) continue;
      }
      for (let k = i; k < end; k++) taken[k] = true;
      hits.push({ start: i, end, f });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

function rewrite(text: string, caseSensitiveShort: boolean, keepOriginal: boolean): { text: string; ids: string[] } {
  const hits = scan(text, caseSensitiveShort);
  let out = "";
  let at = 0;
  const ids: string[] = [];
  for (const h of hits) {
    out += text.slice(at, h.start);
    const original = text.slice(h.start, h.end);
    const alnum = original.replace(/[^\p{L}\p{N}]/gu, "");
    const kept = !keepOriginal ? "" : h.f.punct ? (alnum.length >= 3 ? `${alnum} ` : "") : `${original} `;
    out += `${kept}${token(h.f.id)}`;
    ids.push(h.f.id);
    at = h.end;
  }
  return { text: out + text.slice(at), ids: [...new Set(ids)] };
}

/** searchTextExt: identifiers rewritten, the canonical token of every alias found added once. */
export function extendText(searchText: string): string {
  const { text, ids } = rewrite(searchText, true, true);
  return `${text} \n ${ids.map(token).join(" ")}`.trim();
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const FUZZY_VOCAB = FORMS.filter((f) => !f.punct && !f.short && !byId.get(f.id)!.noFuzz && !f.form.includes(" "));

export interface QueryRewrite {
  q: string;
  corrected: { from: string; to: string }[];
  expanded: string[];
}

const MAX_VARIANTS = 8;

/** The A1 query: identifiers and aliases to tokens, narrower terms added, bounded typo correction. */
export function rewriteQuery(query: string, dictionary: ReadonlySet<string>): QueryRewrite {
  const { text, ids } = rewrite(query.trim(), false, false);
  const corrected: { from: string; to: string }[] = [];
  const words = text.split(/\s+/).filter(Boolean);
  const outWords = words.map((w) => {
    if (w.startsWith("zz") || w.length < 5 || dictionary.has(w.toLowerCase()) || corrected.length >= MAX_VARIANTS) return w;
    const lw = w.toLowerCase();
    const max = lw.length >= 8 ? 2 : 1;
    const vocab = FUZZY_VOCAB.find((f) => editDistance(lw, f.form, max) <= max);
    if (vocab) {
      corrected.push({ from: w, to: vocab.form });
      ids.push(vocab.id);
      return token(vocab.id);
    }
    for (const d of dictionary) {
      if (d.length >= 5 && editDistance(lw, d, max) <= max) {
        corrected.push({ from: w, to: d });
        return d;
      }
    }
    return w;
  });
  const expanded = [...new Set(ids.flatMap((id) => byId.get(id)?.narrower ?? []))].filter((n) => !ids.includes(n)).slice(0, MAX_VARIANTS);
  // Narrower tokens go first: the last term is the one Convex prefix-matches.
  return { q: [...expanded.map(token), ...outWords].join(" "), corrected, expanded };
}

/** The adapter-side term dictionary: lowercase words of 3+ letters from titles, tags and descriptions. */
export function buildDictionary(texts: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const w of t.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w.length >= 3) out.add(w);
  return out;
}

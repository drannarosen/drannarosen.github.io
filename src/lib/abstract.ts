/*
 * abstract.ts — render a fetched paper abstract to HTML.
 *
 * Abstracts arrive as TeX-flavoured plain text from arXiv / Crossref / Semantic
 * Scholar (see scripts/publications/sync_orcid.mjs). They carry inline math in
 * `$ ... $` (and occasionally `$$ ... $$`) — e.g. `$\geq 40\sigma$`, `$\mathrm{M}_\odot$`
 * — and otherwise are prose.
 *
 * Math is rendered by KaTeX at BUILD time with the site's shared macro preamble,
 * so pages ship typeset math with no client JS and no third-party request —
 * exactly like renderCaption() and the <Math> component. Everything outside the
 * math is HTML-escaped, since it is untrusted fetched text.
 *
 * Deliberately NOT a TeX engine: only `$…$` / `$$…$$` are interpreted. Real
 * abstracts keep all their backslash commands inside math, so that is enough.
 */

import katex from "katex";
import { mathMacros } from "./mathMacros";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);

function renderMath(tex: string, displayMode: boolean): string {
  // strict:false lets Unicode inside math (α, σ, arriving straight from arXiv)
  // render instead of erroring; throwOnError:false shows a bad expression in red
  // rather than failing the whole build — the same posture as renderCaption().
  return katex.renderToString(tex, {
    displayMode,
    throwOnError: false,
    strict: false,
    output: "htmlAndMathml",
    macros: mathMacros,
  });
}

/** Render an abstract (TeX-flavoured plain text) to HTML. Safe for `set:html`. */
export function renderAbstract(source: string): string {
  if (!source) return "";
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out += escapeHtml(source.slice(last, m.index));
    const display = m[1] !== undefined;
    out += renderMath(display ? m[1]! : m[2]!, display);
    last = re.lastIndex;
  }
  out += escapeHtml(source.slice(last));
  return out;
}

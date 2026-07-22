/*
 * abstract.ts — render a fetched paper abstract to HTML.
 *
 * Abstracts arrive as TeX-flavoured plain text from arXiv / Crossref / Semantic
 * Scholar (see scripts/publications/sync_orcid.mjs):
 *   - arXiv keeps the author's real LaTeX in `$ … $`, but ships Greek letters as
 *     Unicode (`$\geq 40σ$`).
 *   - Crossref/S2 are JATS flattened to text — the `$…$` delimiters are GONE and
 *     symbols survive only as bare Unicode in the prose (`L γ ≃ 2 × 10 35`).
 *
 * Anna wants real typeset math, never raw Unicode glyphs (which render in the
 * system font and look wrong). So BOTH cases are handled:
 *   1. `$ … $` / `$$ … $$` spans → Unicode mapped to LaTeX, then KaTeX.
 *   2. Unicode math symbols left loose in the prose → each rendered as KaTeX.
 * Everything renders at BUILD time with the site's shared macros — no client JS,
 * no third-party request — exactly like renderCaption() and <Math>.
 *
 * Deliberately NOT a full TeX engine, and it cannot rebuild the sub/superscripts
 * Crossref already destroyed ("10 35"); it makes every SYMBOL true math, which is
 * the part that looked broken.
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

/*
 * Unicode → LaTeX for the math symbols abstracts actually carry. Greek (both
 * cases), the common relations/operators, and stellar notation. Deliberately
 * EXCLUDES typographic characters that are correct as text — en dash (–),
 * curly quotes, degree (°), and the minus/hyphen ambiguity — so ranges like
 * "0.1–500" and words are left alone.
 */
const UNI_TO_TEX: Record<string, string> = {
  // lower-case Greek
  α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta", ε: "\\varepsilon",
  ϵ: "\\epsilon", ζ: "\\zeta", η: "\\eta", θ: "\\theta", ϑ: "\\vartheta",
  ι: "\\iota", κ: "\\kappa", λ: "\\lambda", μ: "\\mu", ν: "\\nu", ξ: "\\xi",
  π: "\\pi", ϖ: "\\varpi", ρ: "\\rho", ϱ: "\\varrho", σ: "\\sigma", ς: "\\varsigma",
  τ: "\\tau", υ: "\\upsilon", ϕ: "\\phi", φ: "\\varphi", χ: "\\chi", ψ: "\\psi", ω: "\\omega",
  // upper-case Greek
  Γ: "\\Gamma", Δ: "\\Delta", Θ: "\\Theta", Λ: "\\Lambda", Ξ: "\\Xi", Π: "\\Pi",
  Σ: "\\Sigma", Υ: "\\Upsilon", Φ: "\\Phi", Ψ: "\\Psi", Ω: "\\Omega",
  // relations & operators
  "×": "\\times", "±": "\\pm", "∓": "\\mp", "⋅": "\\cdot", "∼": "\\sim",
  "≈": "\\approx", "≃": "\\simeq", "≅": "\\cong", "≡": "\\equiv", "≠": "\\neq",
  "≤": "\\leq", "≥": "\\geq", "≪": "\\ll", "≫": "\\gg", "≲": "\\lesssim", "≳": "\\gtrsim",
  "∝": "\\propto", "→": "\\rightarrow", "∞": "\\infty", "∈": "\\in", "∘": "\\circ",
  "√": "\\surd", "∇": "\\nabla", "∂": "\\partial",
  // stellar / astro notation
  "⊙": "\\odot", "⊕": "\\oplus",
};

/** Replace Unicode math glyphs inside a TeX string with their LaTeX commands. */
function unicodeToTex(tex: string): string {
  return tex.replace(/[^\x00-\x7F]/g, (c) => (c in UNI_TO_TEX ? `${UNI_TO_TEX[c]} ` : c));
}

function renderMath(tex: string, displayMode: boolean): string {
  // strict:false tolerates any Unicode we did not map; throwOnError:false shows a
  // bad expression in red instead of failing the build — the posture of renderCaption().
  return katex.renderToString(unicodeToTex(tex), {
    displayMode,
    throwOnError: false,
    strict: false,
    output: "htmlAndMathml",
    macros: mathMacros,
  });
}

/*
 * Prose that lost its `$` delimiters: render each loose math symbol as inline
 * KaTeX, escaping the ordinary text between. Only characters in UNI_TO_TEX are
 * touched, so text stays text.
 */
const PROSE_MATH = new RegExp(`[${Object.keys(UNI_TO_TEX).join("")}]`, "g");

function renderProse(text: string): string {
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  PROSE_MATH.lastIndex = 0;
  while ((m = PROSE_MATH.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    out += renderMath(m[0], false);
    last = PROSE_MATH.lastIndex;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

/** Render an abstract (TeX-flavoured plain text) to HTML. Safe for `set:html`. */
export function renderAbstract(source: string): string {
  if (!source) return "";
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out += renderProse(source.slice(last, m.index));
    const display = m[1] !== undefined;
    out += renderMath(display ? m[1]! : m[2]!, display);
    last = re.lastIndex;
  }
  out += renderProse(source.slice(last));
  return out;
}

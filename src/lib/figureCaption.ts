/*
 * figureCaption.ts — render a figure caption written in frontmatter to HTML.
 *
 * Figure captions live in YAML frontmatter, which cannot hold components, so a
 * caption needing panel labels and real notation had no way to express them:
 * `{caption}` rendered as plain text and a caption written the way a journal
 * caption is written would show literal `**(a)**` and `\(M_\odot\)`.
 *
 * This supports the two things scientific captions actually need, and nothing
 * else — this is deliberately not a markdown engine:
 *
 *   **bold**      panel labels, (a) / (b) / (c), and lead-in phrases
 *   \( ... \)     inline LaTeX, rendered by KaTeX at BUILD time
 *
 * KaTeX runs during the build with the site's shared macro preamble, so pages
 * ship typeset math with no client JS and no third-party requests (ADR-0011),
 * exactly as the <Math> component does.
 *
 * Math is extracted BEFORE escaping, because LaTeX legitimately contains the
 * characters HTML escaping would mangle.
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

/** Render a frontmatter caption to HTML. Safe to pass to `set:html`. */
export function renderCaption(source: string): string {
  /* Split on \( ... \). With one capture group, split() interleaves the parts:
     even indices are prose, odd indices are the captured LaTeX. */
  const parts = source.split(/\\\(([\s\S]+?)\\\)/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        // throwOnError:false → a malformed expression renders visibly in red
        // rather than failing the whole build, matching <Math>.
        return katex.renderToString(part, {
          displayMode: false,
          throwOnError: false,
          output: "htmlAndMathml",
          macros: mathMacros,
        });
      }
      return escapeHtml(part).replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
    })
    .join("");
}

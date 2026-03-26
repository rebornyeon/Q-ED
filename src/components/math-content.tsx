"use client";

import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface Props {
  children: string;
  className?: string;
}

export function MathContent({ children, className = "" }: Props) {
  const html = useMemo(() => renderMathText(children), [children]);

  return (
    <div
      className={`math-content ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// Fix common LLM-generated LaTeX issues before passing to KaTeX
function fixLatexBackslashes(tex: string): string {
  // Inside matrix environments, bare newlines between rows need \\ row separators
  tex = tex.replace(
    /(\\begin\{[bpvVm]?matrix\*?\})([\s\S]*?)(\\end\{[bpvVm]?matrix\*?\})/g,
    (_, open, body, close) => {
      let fixedBody = body;
      // Add \\ before any newline not already preceded by \\
      fixedBody = fixedBody.replace(/(?<!\\)\n/g, ' \\\\\n');
      // If still no \\ row separators present, infer rows from & count.
      // e.g. "1 & 2 & 3 4 & 5 & 6" → 2 cols per row means insert \\ after every 2nd &
      if (!/\\\\/.test(fixedBody) && fixedBody.includes('&')) {
        const ampCount = (fixedBody.match(/&/g) ?? []).length;
        // Try to find column count: look for repeating groups.
        // Heuristic: assume square-ish — try cols = 1,2,3... up to sqrt(ampCount+1)
        // Pick cols where (ampCount+1) % (cols+1) === 0
        let cols = 0;
        for (let c = 1; c <= Math.ceil(Math.sqrt(ampCount + 1)) + 1; c++) {
          if ((ampCount + 1) % (c + 1) === 0) { cols = c; break; }
        }
        if (cols > 0) {
          // Insert \\ after every `cols`-th &
          let count = 0;
          fixedBody = fixedBody.replace(/&/g, (m) => {
            count++;
            return count % cols === 0 ? `& \\\\\n` : m;
          });
        }
      }
      return open + fixedBody + close;
    }
  );
  // Single \ before space/newline → \\ (matrix row separator stored incorrectly by LLMs)
  tex = tex.replace(/(?<!\\)\\ /g, '\\\\ ');
  tex = tex.replace(/(?<!\\)\\\n/g, '\\\\\n');
  // \left{ → \left\{  and  \right} → \right\}
  tex = tex.replace(/\\left\{/g, '\\left\\{');
  tex = tex.replace(/\\right\}/g, '\\right\\}');
  return tex;
}

function renderMathText(text: string): string {
  // 0. Normalize literal \n (backslash+n stored from JSON encoding) → actual newline
  let result = text.replace(/\\n(?![a-z])/g, '\n');

  // 0.5. Convert LaTeX list environments to HTML (KaTeX doesn't support enumerate/itemize)
  result = result.replace(/\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/g, (_, items) => {
    const parts = items.split(/\\item\b/).filter((s: string) => s.trim());
    return parts.map((item: string, i: number) =>
      `<div class="flex gap-2 mt-1"><span class="font-semibold shrink-0">${i + 1}.</span><span>${item.trim()}</span></div>`
    ).join('');
  });
  result = result.replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, (_, items) => {
    const parts = items.split(/\\item\b/).filter((s: string) => s.trim());
    return parts.map((item: string) =>
      `<div class="flex gap-2 mt-0.5 ml-3"><span class="shrink-0 text-muted-foreground select-none">•</span><span>${item.trim()}</span></div>`
    ).join('');
  });

  const displayBlocks: string[] = [];

  // 1a. Extract existing $$...$$ display blocks first
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex) => {
    const idx = displayBlocks.length;
    try {
      displayBlocks.push(katex.renderToString(fixLatexBackslashes(tex.trim()), { displayMode: true, throwOnError: false }));
    } catch {
      displayBlocks.push(`<span class="text-destructive">${escapeHtml(tex)}</span>`);
    }
    return `\x00DISPLAY${idx}\x00`;
  });

  // 1b. Extract $...$ inline blocks into placeholders BEFORE display env detection.
  //     This protects \begin{pmatrix} inside $...$ from being wrapped as a display block.
  const inlineQueue: string[] = [];
  result = result.replace(/(?<!\$)\$(?!\$)([\s\S]+?)(?<!\$)\$(?!\$)/g, (_match, tex) => {
    const idx = inlineQueue.length;
    inlineQueue.push(tex);
    return `\x00INLINE${idx}\x00`;
  });

  // 1c. Detect bare \begin{env}...\end{env} in remaining text and render as display blocks.
  //     Back-reference \1 ensures \begin{equation*} only closes on \end{equation*},
  //     correctly handling nested \begin{pmatrix}...\end{pmatrix} inside.
  result = result.replace(/\\begin\{([^}]+)\}[\s\S]*?\\end\{\1\}/g, (match) => {
    const idx = displayBlocks.length;
    try {
      displayBlocks.push(katex.renderToString(fixLatexBackslashes(match.trim()), { displayMode: true, throwOnError: false }));
    } catch {
      displayBlocks.push(`<span class="text-destructive">${escapeHtml(match)}</span>`);
    }
    return `\x00DISPLAY${idx}\x00`;
  });

  // 3. Markdown: bold **text**, italic *text*
  // Run BEFORE restoring inline math so KaTeX HTML doesn't interfere.
  // Bold: greedy within **, but stops at newline to prevent cross-paragraph runaway.
  result = result.replace(/\*\*([^*\n]+(?:\n(?!\n)[^*\n]*)*)\*\*/g, "<strong>$1</strong>");
  // Also handle **heading:** pattern where bold ends with colon (common Gemini output)
  result = result.replace(/^(\*\*)((?:[^*\n]|\*(?!\*))+:\s*)$/gm, '<strong>$2</strong>');
  result = result.replace(/\*(?!\*)([^*\n]+?)\*(?!\*)/g, "<em>$1</em>");

  // 2. Render inline math from queue (after bold/italic so KaTeX HTML doesn't confuse regex)
  result = result.replace(/\x00INLINE(\d+)\x00/g, (_, idx) => {
    const tex = inlineQueue[Number(idx)];
    try {
      return katex.renderToString(fixLatexBackslashes(tex.trim()), { displayMode: false, throwOnError: false });
    } catch {
      return `<span class="text-destructive">${escapeHtml(tex)}</span>`;
    }
  });

  // 4a. Numbered list items: lines starting with "1." "2." etc → styled divs
  result = result.replace(/^(\d+)\.\s+(.+)$/gm, (_, num, content) =>
    `<div class="flex gap-2 mt-1"><span class="font-semibold shrink-0">${num}.</span><span>${content}</span></div>`
  );

  // 4b. Unordered list items: lines with optional indent then * - + → bullet divs
  result = result.replace(/^[ \t]*[*\-+]\s+(.+)$/gm, (_, content) =>
    `<div class="flex gap-2 mt-0.5 ml-3"><span class="shrink-0 text-muted-foreground select-none">•</span><span>${content}</span></div>`
  );

  // 5. Paragraph breaks (\n\n) → </p><p>, single \n → <br>
  const parts = result.split(/\n\n+/);
  result = parts
    .map((p) => `<p class="mb-2">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

  // 6. Restore display math blocks
  result = result.replace(/\x00DISPLAY(\d+)\x00/g, (_, idx) => displayBlocks[Number(idx)] ?? "");

  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

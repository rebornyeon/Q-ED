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

function renderMathText(text: string): string {
  // 1. Protect display math blocks ($$...$$) and \begin{...}...\end{...} from other processing
  const displayBlocks: string[] = [];
  let result = text;

  // Wrap bare \begin{align*}...\end{align*} (and similar) in $$ if not already wrapped
  result = result.replace(/(\$\$[\s\S]*?\$\$|\\\w+\{[^}]*\}[\s\S]*?\\end\{[^}]*\})/g, (match) => {
    if (match.startsWith("$$")) return match; // already wrapped
    return `$$${match}$$`;
  });

  // Extract display math $$...$$ into placeholders
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex) => {
    const idx = displayBlocks.length;
    try {
      displayBlocks.push(katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false }));
    } catch {
      displayBlocks.push(`<span class="text-destructive">${escapeHtml(tex)}</span>`);
    }
    return `\x00DISPLAY${idx}\x00`;
  });

  // 2. Process inline math $...$ (but not $$)
  result = result.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (_match, tex) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false });
    } catch {
      return `<span class="text-destructive">${escapeHtml(tex)}</span>`;
    }
  });

  // 3. Markdown: bold **text**, italic *text*
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*(?!\*)(.+?)\*(?!\*)/g, "<em>$1</em>");

  // 4. Numbered list items: lines starting with "1." "2." etc → styled divs
  result = result.replace(/^(\d+)\.\s+(.+)$/gm, (_, num, content) =>
    `<div class="flex gap-2 mt-1"><span class="font-semibold shrink-0">${num}.</span><span>${content}</span></div>`
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

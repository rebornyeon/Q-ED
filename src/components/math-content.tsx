"use client";

import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface Props {
  children: string;
  className?: string;
}

// Split text on $...$ (inline) and $$...$$ (display) delimiters,
// render math parts with KaTeX, pass text parts through as HTML.
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
  // First handle display math $$...$$, then inline $...$
  // Process display math
  let result = text.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex: string) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false });
    } catch {
      return `<span class="text-destructive">${escapeHtml(tex)}</span>`;
    }
  });

  // Process inline math $...$  (but not $$)
  result = result.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (_match, tex: string) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false });
    } catch {
      return `<span class="text-destructive">${escapeHtml(tex)}</span>`;
    }
  });

  // Convert newlines to <br> for multi-line content
  result = result.replace(/\n/g, "<br>");

  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

import { GoogleGenerativeAI } from "@google/generative-ai";
import { PDFDocument } from "pdf-lib";
import type { GeminiAnalysisResult, GeneratedCue, GeneratedProblem, SupplementaryInsights, RawProblem } from "@/types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const PAGES_PER_CHUNK = 8; // 한 번에 처리할 페이지 수
const CHUNK_CONCURRENCY = 3; // 병렬 처리할 청크 수

// Robustly parse JSON from a Gemini response.
// Handles: markdown code fences, unescaped LaTeX backslashes, leading/trailing whitespace.
export function parseGeminiJson<T>(raw: string): T {
  let text = raw.trim();

  // Strip ```json ... ``` or ``` ... ``` fences if present
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (fence) text = fence[1].trim();

  // Fix unescaped LaTeX backslashes inside JSON strings.
  // Strategy: only fix backslashes that are inside double-quoted strings.
  // We walk character by character to avoid mangling already-valid escapes.
  text = fixBackslashesInJsonStrings(text);

  return JSON.parse(text) as T;
}

// Fix bare LaTeX backslashes (e.g. \frac, \int) inside JSON string values.
// Valid JSON escape sequences (\", \\, \/, \b, \f, \n, \r, \t, \uXXXX) are left alone.
function fixBackslashesInJsonStrings(text: string): string {
  // Chars that are ALWAYS valid JSON escapes and never LaTeX
  const alwaysEscape = new Set(['"', '\\', '/']);
  // Chars that are JSON escapes BUT could also start LaTeX commands (\beta, \frac, \nabla, \theta, \rho)
  const ambiguous = new Set(['b', 'f', 'n', 'r', 't']);

  let result = "";
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      result += ch;
      i++;
    } else {
      if (ch === '\\') {
        const next = text[i + 1];
        if (next !== undefined && alwaysEscape.has(next)) {
          // Definitely a JSON escape: \", \\, \/
          result += ch + next;
          i += 2;
        } else if (next === 'u' && /^[0-9a-fA-F]{4}/.test(text.substring(i + 2, i + 6))) {
          // Unicode escape \uXXXX
          result += text.substring(i, i + 6);
          i += 6;
        } else if (next !== undefined && ambiguous.has(next)) {
          // Could be JSON escape (\n, \t) OR LaTeX (\nabla, \theta, \beta, \frac, \rho)
          const afterNext = text[i + 2];
          if (afterNext !== undefined && /[a-zA-Z]/.test(afterNext)) {
            // \n followed by uppercase letter → JSON newline before new sentence (e.g. "\nStep 2:")
            // \n followed by lowercase → possible LaTeX command (\nabla, \ne, \nu)
            if (next === 'n' && /[A-Z0-9]/.test(afterNext)) {
              result += ch + next; // treat as JSON \n
              i += 2;
            } else {
              // LaTeX command like \beta, \frac, \nabla, \theta — double the backslash
              result += "\\\\";
              i++;
            }
          } else {
            // Actual JSON escape like \n or \t at end of word
            result += ch + next;
            i += 2;
          }
        } else {
          // Any other backslash (LaTeX: \alpha, \gamma, \int, \{, etc.) — double it
          result += "\\\\";
          i++;
        }
      } else if (ch === '"') {
        inString = false;
        result += ch;
        i++;
      } else {
        result += ch;
        i++;
      }
    }
  }
  return result;
}

function getJsonModel() {
  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.3,
      maxOutputTokens: 65536,
      // @ts-expect-error thinkingConfig is supported but not yet in type defs
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
}

function getTextModel() {
  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.5,
      // @ts-expect-error thinkingConfig is supported but not yet in type defs
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
}

// PDF를 N페이지씩 청크로 분할 → base64 배열 반환
async function splitPDFIntoChunks(base64Data: string): Promise<string[]> {
  const pdfBytes = Buffer.from(base64Data, "base64");
  const srcDoc = await PDFDocument.load(pdfBytes);
  const totalPages = srcDoc.getPageCount();
  const chunks: string[] = [];

  for (let start = 0; start < totalPages; start += PAGES_PER_CHUNK) {
    const end = Math.min(start + PAGES_PER_CHUNK, totalPages);
    const chunkDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: end - start }, (_, i) => start + i);
    const copiedPages = await chunkDoc.copyPages(srcDoc, pageIndices);
    copiedPages.forEach((page) => chunkDoc.addPage(page));

    const chunkBytes = await chunkDoc.save();
    chunks.push(Buffer.from(chunkBytes).toString("base64"));
  }

  return chunks;
}

// Chunk only specific page ranges (1-based) into PAGES_PER_CHUNK groups
async function splitPDFPageRanges(
  base64Data: string,
  ranges: { start: number; end: number }[]
): Promise<string[]> {
  const pdfBytes = Buffer.from(base64Data, "base64");
  const srcDoc = await PDFDocument.load(pdfBytes);
  const totalPages = srcDoc.getPageCount();

  // Collect 0-based indices from selected ranges, deduplicated and sorted
  const indexSet = new Set<number>();
  for (const { start, end } of ranges) {
    for (let p = start; p <= end; p++) {
      const idx = p - 1;
      if (idx >= 0 && idx < totalPages) indexSet.add(idx);
    }
  }
  const indices = Array.from(indexSet).sort((a, b) => a - b);

  const chunks: string[] = [];
  for (let i = 0; i < indices.length; i += PAGES_PER_CHUNK) {
    const batch = indices.slice(i, i + PAGES_PER_CHUNK);
    const chunkDoc = await PDFDocument.create();
    const copied = await chunkDoc.copyPages(srcDoc, batch);
    copied.forEach((p) => chunkDoc.addPage(p));
    chunks.push(Buffer.from(await chunkDoc.save()).toString("base64"));
  }
  return chunks;
}

export type TOCChapter = { name: string; startPage: number; endPage: number };

// Quick TOC extraction from the first ~15 pages of a PDF
export async function extractTOC(
  base64Data: string
): Promise<{ totalPages: number; chapters: TOCChapter[] }> {
  const pdfBytes = Buffer.from(base64Data, "base64");
  const srcDoc = await PDFDocument.load(pdfBytes);
  const totalPages = srcDoc.getPageCount();

  // Only scan first 15 pages (where TOC/preface usually appears)
  const previewCount = Math.min(totalPages, 15);
  const previewDoc = await PDFDocument.create();
  const previewPages = await previewDoc.copyPages(
    srcDoc,
    Array.from({ length: previewCount }, (_, i) => i)
  );
  previewPages.forEach((p) => previewDoc.addPage(p));
  const previewBase64 = Buffer.from(await previewDoc.save()).toString("base64");

  const model = getJsonModel();
  const prompt = `Analyze the table of contents or chapter structure of this textbook PDF (${totalPages} pages total). Return JSON only.

{"chapters":[{"name":"Chapter 1: Introduction","startPage":1,"endPage":45}]}

Rules:
- Detect top-level chapters only (not sub-sections). Include all chapters visible in the TOC.
- startPage and endPage are 1-based page numbers in the FULL ${totalPages}-page document.
- If the TOC shows page numbers, use them directly. If the TOC page numbers don't match PDF page numbers (e.g., Roman numeral preface pages), adjust: PDF page = TOC page + offset.
- For the last chapter: set endPage to ${totalPages}.
- If no TOC is found, return {"chapters":[]}.`;

  try {
    const result = await model.generateContent([
      { inlineData: { data: previewBase64, mimeType: "application/pdf" } },
      prompt,
    ]);
    const parsed = parseGeminiJson<{ chapters: TOCChapter[] }>(result.response.text());
    const chapters = (parsed.chapters ?? []).filter(
      (c) => c.name && typeof c.startPage === "number" && typeof c.endPage === "number"
    );
    // Fix last chapter endPage
    if (chapters.length > 0) {
      chapters[chapters.length - 1].endPage = totalPages;
    }
    return { totalPages, chapters };
  } catch {
    return { totalPages, chapters: [] };
  }
}

type RawExtractedProblem = { content: string; problem_type: string; difficulty: number; concepts: string[]; section: string | null; page: number | null; problem_number: string | null };

// Normalize extracted problems: ensure concepts is always an array, content is a string, etc.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normProblems(raw: any[]): RawExtractedProblem[] {
  return raw
    .filter((p) => p && typeof p === "object" && typeof p.content === "string" && p.content.length > 0)
    .map((p) => ({
      content: p.content,
      problem_type: typeof p.problem_type === "string" ? p.problem_type : "unknown",
      difficulty: typeof p.difficulty === "number" ? p.difficulty : 3,
      concepts: Array.isArray(p.concepts) ? p.concepts.filter((c: unknown) => typeof c === "string") : [],
      section: typeof p.section === "string" ? p.section : null,
      page: typeof p.page === "number" ? p.page : null,
      problem_number: p.problem_number != null ? String(p.problem_number) : null,
    }));
}

// 청크 하나에서 문제 목록 추출 (Cue 없이)
async function extractProblemsFromChunk(
  base64Chunk: string,
  chunkIndex: number
): Promise<{ concepts: GeminiAnalysisResult["concepts"]; problems: RawExtractedProblem[] }> {
  const model = getJsonModel();

  const prompt = `Math education expert. Analyze PDF section ${chunkIndex + 1}. Return JSON only, no cues.

{"concepts":[{"name":"str","frequency":1,"is_hot":false,"is_trap":false,"is_key":false}],"problems":[{"content":"Full problem statement with all given information, conditions, and what to find/prove. Use $LaTeX$ for math.","problem_type":"str","difficulty":1,"concepts":["str"],"section":"Chapter 1: Title","page":3,"problem_number":"3.2a"}]}

Rules:
- Extract ALL problems from the PDF.
- content MUST include the COMPLETE problem statement — all given information, conditions, constraints, definitions, and what the student needs to find, prove, or compute. A student must be able to solve the problem from the content alone without looking at the PDF. Do NOT truncate or summarize.
- Use LaTeX notation for all math: inline $x^2$, $\\frac{a}{b}$, $\\int_0^1 f(x)\\,dx$.
- MATRICES: Always use display-block LaTeX — NEVER plain text. Example: $$\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}$$ Never write "1 2 / 3 4" or space-separated columns.
- STANDALONE EQUATIONS: Any formula, equation, or expression that stands on its own line in the PDF must be a display block $$...$$, not inline.
- If a problem references a figure, matrix, table, or equation from the textbook, reproduce the relevant data in the content using proper LaTeX (e.g. \\begin{bmatrix} for matrices, \\begin{cases} for piecewise, \\begin{align*} for systems).
- difficulty/frequency are integers 1-5.
- section: exact chapter or section heading from the PDF.
- page: PDF page number (integer), null if unknown.
- problem_number: the label as printed (e.g. "3.2a", "Problem 5"), null if none.
- CRITICAL: Every problem MUST have a clear instruction telling the student what to do. Include the FULL instruction: "Prove that...", "Find...", "Show that...", "Determine...", "Let X be... Prove that Y", "Compute...", "Verify that...", etc.
- For theorem/definition-based problems: DO NOT just copy the theorem. Write it as a task: "Prove that [theorem statement]" or "Show that [the following holds]: [statement]"
- For computation problems: Always end with "Find [what to compute]" or "Compute [expression]"
- A problem is INVALID if a student cannot tell what they need to do from the content alone.`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await model.generateContent([
      { inlineData: { data: base64Chunk, mimeType: "application/pdf" } },
      prompt,
    ]);

    const finishReason = result.response.candidates?.[0]?.finishReason;
    if (finishReason === "MAX_TOKENS") {
      console.warn(`Chunk ${chunkIndex + 1} hit MAX_TOKENS on attempt ${attempt + 1}, retrying with fewer pages...`);
      continue;
    }

    try {
      const rawText = result.response.text();
      console.log(`Chunk ${chunkIndex + 1} attempt ${attempt + 1} raw (${rawText.length} chars):`, rawText.slice(0, 400));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsed: any = parseGeminiJson(rawText);

      // null, undefined, empty, primitives — chunk has no extractable content
      if (parsed == null || typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean") {
        console.log(`Chunk ${chunkIndex + 1}: non-object response (${typeof parsed}), skipping`);
        return { concepts: [], problems: [] };
      }
      if (typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 0) {
        console.log(`Chunk ${chunkIndex + 1}: empty object, skipping`);
        return { concepts: [], problems: [] };
      }
      // Unwrap if Gemini wrapped in an array: [{concepts, problems}]
      if (Array.isArray(parsed) && parsed.length === 1 && parsed[0] && typeof parsed[0] === "object" && !Array.isArray(parsed[0])) {
        parsed = parsed[0];
      }
      // Empty array — no problems
      if (Array.isArray(parsed) && parsed.length === 0) {
        return { concepts: [], problems: [] };
      }
      // If Gemini returned an array — could be problems, concepts, or mixed
      if (Array.isArray(parsed)) {
        // Try to extract any problem-like objects from the array
        const problems = normProblems(parsed);
        if (problems.length > 0) {
          return { concepts: [], problems };
        }
        // Array had no valid problems (maybe array of concepts or strings)
        console.log(`Chunk ${chunkIndex + 1}: array with ${parsed.length} items but no valid problems, skipping`);
        return { concepts: [], problems: [] };
      }
      // Has problems key (standard shape, with or without concepts)
      if (parsed && typeof parsed === "object" && "problems" in parsed) {
        return {
          concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
          problems: normProblems(Array.isArray(parsed.problems) ? parsed.problems : []),
        };
      }
      // Object but no problems key — check if it IS a single problem, or dig for nested problems
      if (parsed && typeof parsed === "object") {
        if (parsed.content && typeof parsed.content === "string") {
          console.log(`Chunk ${chunkIndex + 1}: single problem object, wrapping`);
          return { concepts: [], problems: normProblems([parsed]) };
        }
        // Search one level deep for any array that contains problem-like objects
        for (const key of Object.keys(parsed)) {
          if (Array.isArray(parsed[key])) {
            const found = normProblems(parsed[key]);
            if (found.length > 0) {
              console.log(`Chunk ${chunkIndex + 1}: found ${found.length} problems under key "${key}"`);
              return { concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [], problems: found };
            }
          }
        }
        console.log(`Chunk ${chunkIndex + 1}: no problems found, skipping. Keys: ${Object.keys(parsed).join(", ")}`);
        return { concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [], problems: [] };
      }
      // Absolute fallback — should never reach here
      console.warn(`Chunk ${chunkIndex + 1}: unhandled type ${typeof parsed}, skipping`);
      return { concepts: [], problems: [] };
    } catch {
      console.warn(`Chunk ${chunkIndex + 1} JSON parse failed on attempt ${attempt + 1}`);
      if (attempt === 2) return { concepts: [], problems: [] };
    }
  }

  return { concepts: [], problems: [] };
}

// 문제 하나에 대해 Cue 4개 생성 (보조 자료 컨텍스트 선택적 포함)
export async function generateCuesForProblem(
  problemContent: string,
  supplementaryContext?: SupplementaryInsights[],
  supplementaryProblems?: { content: string }[]
): Promise<GeneratedCue[]> {
  const model = getJsonModel();

  const contextBlock = supplementaryContext && supplementaryContext.length > 0
    ? `\nExam Context (from supplementary materials — weight these heavily):
- Emphasized topics: ${[...new Set(supplementaryContext.flatMap((s) => s.emphasized_topics))].join(", ")}
- Key formulas: ${[...new Set(supplementaryContext.flatMap((s) => s.key_formulas ?? []))].join(", ")}
- Common exam patterns: ${[...new Set(supplementaryContext.flatMap((s) => s.exam_patterns))].join(", ")}
- Professor/exam tips: ${[...new Set(supplementaryContext.flatMap((s) => s.study_tips))].join(", ")}
${supplementaryProblems && supplementaryProblems.length > 0
  ? `- Similar problems from supplementary material:\n${supplementaryProblems.map((p, i) => `  ${i + 1}. ${p.content.slice(0, 200)}`).join("\n")}`
  : ""}
Use this context to make cues exam-targeted: highlight where this problem connects to the above patterns, formulas, and tips.\n`
    : "";

  const prompt = `You are a math education expert. Generate exactly 5 cues for this math problem.

Problem: ${problemContent}
${contextBlock}
Return JSON array with exactly 5 elements — no other text:
[
  {
    "cue_type": "understanding",
    "cue_level": 0,
    "content": "Understanding: [Precisely what this problem asks. (1) Given: ... (2) Find: ... (3) Constraints: ...]",
    "why_explanation": "Clarifying what is asked before attempting prevents wasted effort."
  },
  {
    "cue_type": "kill_shot",
    "cue_level": 1,
    "content": "**[Theorem or Formula Name]**\\n$$[exact LaTeX formula or theorem statement]$$",
    "why_explanation": "[1-2 sentences: WHY this theorem is mathematically true — the core intuition, not how to use it. E.g., 'This holds because...']"
  },
  {
    "cue_type": "pattern",
    "cue_level": 2,
    "content": "Map to this problem:\\n[Concretely map THIS problem's values to the formula variables. E.g., 'V = R^3, so dim V = 3. T(x,y,z) = ...']",
    "why_explanation": "[Why this mapping is valid for this specific problem — 1 sentence]"
  },
  {
    "cue_type": "speed",
    "cue_level": 3,
    "content": "First step: [The single first concrete calculation to perform — specific, no prose]",
    "why_explanation": "[Why this is the right first move — 1 sentence]"
  },
  {
    "cue_type": "kill_shot",
    "cue_level": 4,
    "content": "Solution path:\\n1. [step]\\n2. [step]\\n3. [step]\\n4. [final answer form]",
    "why_explanation": "[The key insight that unlocks the whole problem — 1 sentence]"
  }
]

STRICT RULES:
- Level 1 content MUST start with **Theorem/Formula Name** then a LaTeX block $$...$$
- Level 2-4 content: under 35 words each
- why_explanation for level 1: explain WHY the theorem is true mathematically (intuition), NOT how to apply it
- why_explanation for levels 2-4: 1 sentence on why that step/mapping is valid
- All text in English. Use actual newline characters (\\n) in JSON strings for line breaks.`;

  try {
    const result = await model.generateContent(prompt);
    return parseGeminiJson(result.response.text()) as GeneratedCue[];
  } catch (e) {
    console.error("generateCuesForProblem failed:", e);
    return [];
  }
}

// 보조 PDF 분석: 인사이트(첫 10페이지) + 문제 전체 추출(청킹)
export async function analyzeSupplementaryPDF(
  base64Data: string
): Promise<{ insights: SupplementaryInsights; problems: RawProblem[] }> {
  const model = getJsonModel();

  const pdfBytes = Buffer.from(base64Data, "base64");
  const srcDoc = await PDFDocument.load(pdfBytes);
  const totalPages = srcDoc.getPageCount();

  // 1. Insights from first 10 pages (fast)
  const previewDoc = await PDFDocument.create();
  const previewCount = Math.min(totalPages, 10);
  const previewPages = await previewDoc.copyPages(srcDoc, Array.from({ length: previewCount }, (_, i) => i));
  previewPages.forEach((p) => previewDoc.addPage(p));
  const previewBase64 = Buffer.from(await previewDoc.save()).toString("base64");

  const insightPrompt = `Math exam expert. Analyze this supplementary PDF (past exam, professor notes, or study guide) and return JSON only.

{"emphasized_topics":["topic"],"exam_patterns":["pattern"],"study_tips":["tip"],"key_formulas":["formula"],"summary":"1-sentence summary"}

Extract what this material emphasizes for exam preparation. Keep each list concise (≤8 items).`;

  let insights: SupplementaryInsights = { emphasized_topics: [], exam_patterns: [], study_tips: [], key_formulas: [], summary: "" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await model.generateContent([
      { inlineData: { data: previewBase64, mimeType: "application/pdf" } },
      insightPrompt,
    ]);
    try { insights = parseGeminiJson(result.response.text()); break; } catch { /* retry */ }
  }

  // 2. Extract all problems from full PDF (same chunking as main PDF)
  const chunks = await splitPDFIntoChunks(base64Data);
  const problems: RawProblem[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const extracted = await extractProblemsFromChunk(chunks[i], i);
    problems.push(...extracted.problems);
  }

  return { insights, problems };
}

// Generate 1-2 targeted problems for a concept not covered by any extracted problem
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function generateTargetedProblems(conceptName: string): Promise<RawExtractedProblem[]> {
  const model = getJsonModel();

  const prompt = `Math education expert. The concept "${conceptName}" was identified as important in a PDF but has no practice problems yet. Generate 1-2 representative math problems that directly test this concept.

Return JSON array only:
[{"content":"Complete problem statement with all given info and what to find/prove. Use $LaTeX$ for math.","problem_type":"str","difficulty":3,"concepts":["${conceptName}"],"section":null,"page":null,"problem_number":null}]

Rules: problems must be fully self-contained — a student must be able to solve each problem from the content alone. Include all given values, conditions, and what to compute/prove. Use LaTeX for math notation. MATRICES: always $$\\begin{bmatrix}...\\end{bmatrix}$$, never plain text. difficulty 1-5. Return 1 if concept is narrow, 2 if broad.`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await model.generateContent(prompt);
    const finishReason = result.response.candidates?.[0]?.finishReason;
    if (finishReason === "MAX_TOKENS") continue;
    try {
      const parsed = parseGeminiJson(result.response.text());
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      if (attempt === 1) return [];
    }
  }
  return [];
}

// 청크 배열을 최대 concurrency개씩 병렬 처리
async function processChunksParallel(
  chunks: string[],
  concurrency: number
): Promise<{ concepts: GeminiAnalysisResult["concepts"]; problems: RawExtractedProblem[] }[]> {
  const results: { concepts: GeminiAnalysisResult["concepts"]; problems: RawExtractedProblem[] }[] = [];
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((chunk, j) => extractProblemsFromChunk(chunk, i + j))
    );
    results.push(...batchResults);
  }
  return results;
}

// 메인: PDF 청크 분할 → 문제 추출 (Cue는 on-demand 생성으로 이동)
export async function analyzePDF(
  base64Data: string,
  selectedPageRanges?: { start: number; end: number }[]
): Promise<GeminiAnalysisResult> {
  // 1단계: PDF를 청크로 분할 (선택된 페이지 범위만, 또는 전체)
  const chunks = selectedPageRanges && selectedPageRanges.length > 0
    ? await splitPDFPageRanges(base64Data, selectedPageRanges)
    : await splitPDFIntoChunks(base64Data);

  // 2단계: 청크 병렬 처리 (최대 CHUNK_CONCURRENCY개 동시)
  const chunkResults = await processChunksParallel(chunks, CHUNK_CONCURRENCY);
  const allConcepts: GeminiAnalysisResult["concepts"] = [];
  const allRawProblems: RawExtractedProblem[] = [];
  for (const r of chunkResults) {
    allConcepts.push(...r.concepts);
    allRawProblems.push(...r.problems);
  }

  // 개념 중복 제거 및 빈도 합산
  const conceptMap = new Map<string, GeminiAnalysisResult["concepts"][0]>();
  for (const c of allConcepts) {
    const existing = conceptMap.get(c.name);
    if (existing) {
      existing.frequency = Math.min(5, existing.frequency + 1);
      existing.is_hot = existing.is_hot || c.is_hot;
      existing.is_trap = existing.is_trap || c.is_trap;
      existing.is_key = existing.is_key || c.is_key;
    } else {
      conceptMap.set(c.name, { ...c });
    }
  }

  // 문제 유형 집계
  const typeMap = new Map<string, { count: number; concepts: Set<string> }>();
  for (const p of allRawProblems) {
    const existing = typeMap.get(p.problem_type);
    if (existing) {
      existing.count++;
      p.concepts.forEach((c) => existing.concepts.add(c));
    } else {
      typeMap.set(p.problem_type, { count: 1, concepts: new Set(p.concepts) });
    }
  }

  // Cue 생성 제거 — 문제 열 때 on-demand로 생성 (훨씬 빠름)
  const problems: GeneratedProblem[] = allRawProblems.map((p) => ({ ...p, cues: [] }));

  return {
    summary: `총 ${chunks.length}개 구간, ${allRawProblems.length}개 문제 분석 완료`,
    concepts: Array.from(conceptMap.values()),
    problem_types: Array.from(typeMap.entries()).map(([type, v]) => ({
      type,
      count: v.count,
      concepts: Array.from(v.concepts),
    })),
    problems,
  };
}

// Generate similar problems directly from the PDF — Gemini reads the textbook and creates new problems
// matching the exact notation, formulas, and structure of the specified section.
export async function generateSimilarFromPDF(
  pdfBase64: string,
  original: { content: string; problem_type: string; difficulty: number; concepts: string[]; section: string | null },
  count: number = 3
): Promise<RawExtractedProblem[]> {
  const model = getJsonModel();

  const sectionRef = original.section ? `in section "${original.section}"` : "in the relevant section";

  const prompt = `Math education expert. You are given a textbook PDF. Your task is to generate ${count} new problems that are similar to the original problem below, using the actual content, notation, formulas, and examples from the PDF.

Original problem (from this textbook):
- Content: ${original.content}
- Type: ${original.problem_type}
- Difficulty: ${original.difficulty}/5
- Concepts: ${original.concepts.join(", ")}
- Section: ${original.section ?? "General"}

Instructions:
1. Find the relevant material ${sectionRef} in the PDF
2. Generate ${count} new problems based directly on the textbook's content — use its exact notation, formula conventions, and problem structure
3. Each problem must be distinct from the original and from each other (vary the numbers, functions, or scenarios)
4. Match the difficulty level (${original.difficulty}/5) and problem type
5. Each problem MUST be fully self-contained — include all given information, conditions, matrices, equations, and what to find/prove. A student must be able to solve it from the content alone.

Return JSON array only — MATRICES must use $$\\begin{bmatrix}...\\end{bmatrix}$$, never plain text:
[{"content":"Complete problem statement with all given info. Use $LaTeX$ for math.","problem_type":"${original.problem_type}","difficulty":${original.difficulty},"concepts":${JSON.stringify(original.concepts)},"section":${JSON.stringify(original.section)},"page":null,"problem_number":null}]

Return exactly ${count} objects. All text in English.`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await model.generateContent([
      { inlineData: { data: pdfBase64, mimeType: "application/pdf" } },
      prompt,
    ]);
    const finishReason = result.response.candidates?.[0]?.finishReason;
    if (finishReason === "MAX_TOKENS") continue;
    try {
      const parsed = parseGeminiJson(result.response.text());
      return Array.isArray(parsed) ? parsed.slice(0, count) : [];
    } catch {
      if (attempt === 1) return [];
    }
  }
  return [];
}

export async function generateFeedback(
  mistakeType: string,
  problemContent: string,
  cuesUsed: number
): Promise<string> {
  const model = getTextModel();

  const prompt = `You are a math learning coach. Generate precise feedback in English.

Problem: ${problemContent}
Mistake type: ${mistakeType}
Cues used: ${cuesUsed}

Instead of vague feedback like "lacking concept understanding", pinpoint the exact mistake behavior in 1-2 sentences.
Example: "Trap Cue missed → absolute value branching error: you expanded without checking the sign inside the absolute value. Next time, the moment you see |...| split into cases first."

Return feedback text only, in English.`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

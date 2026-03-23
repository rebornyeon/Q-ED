import { GoogleGenerativeAI } from "@google/generative-ai";
import { PDFDocument } from "pdf-lib";
import type { GeminiAnalysisResult, GeneratedCue, GeneratedProblem, SupplementaryInsights, RawProblem } from "@/types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const PAGES_PER_CHUNK = 5; // 한 번에 처리할 페이지 수

// Robustly parse JSON from a Gemini response.
// Handles: markdown code fences, unescaped LaTeX backslashes, leading/trailing whitespace.
function parseGeminiJson<T>(raw: string): T {
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
          // Heuristic: if followed by another letter, it's LaTeX
          const afterNext = text[i + 2];
          if (afterNext !== undefined && /[a-zA-Z]/.test(afterNext)) {
            // LaTeX command like \beta, \frac, \nabla — double the backslash
            result += "\\\\";
            i++;
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
    },
  });
}

function getTextModel() {
  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.5 },
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
- If a problem references a figure, matrix, table, or equation from the textbook, reproduce the relevant data in the content (e.g. write out the matrix, describe the figure, state the equation).
- difficulty/frequency are integers 1-5.
- section: exact chapter or section heading from the PDF.
- page: PDF page number (integer), null if unknown.
- problem_number: the label as printed (e.g. "3.2a", "Problem 5"), null if none.`;

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
  supplementaryContext?: SupplementaryInsights[]
): Promise<GeneratedCue[]> {
  const model = getJsonModel();

  const contextBlock = supplementaryContext && supplementaryContext.length > 0
    ? `\nExam Context (from supplementary materials — weight these heavily):
- Emphasized topics: ${[...new Set(supplementaryContext.flatMap((s) => s.emphasized_topics))].join(", ")}
- Common exam patterns: ${[...new Set(supplementaryContext.flatMap((s) => s.exam_patterns))].join(", ")}
- Professor/exam tips: ${[...new Set(supplementaryContext.flatMap((s) => s.study_tips))].join(", ")}
Use this context to make cues exam-targeted: highlight where this problem connects to the above patterns and tips.\n`
    : "";

  const prompt = `You are a math education expert. Generate 4 step-by-step Cues for this problem in English.
${contextBlock}
Problem: ${problemContent}

Return exactly this JSON array. For multi-step content, use \\n between each step so they display on separate lines (e.g. "Step 1: ...\nStep 2: ...\nStep 3: ..."):
[
  { "cue_type": "kill_shot", "cue_level": 1, "content": "Level 1: Approach strategy — how to think about this problem. Use \\n to separate key points.", "why_explanation": "Why this direction works" },
  { "cue_type": "pattern",   "cue_level": 2, "content": "Level 2: Pattern guide — what structure to recognize. Use \\n between each observation.", "why_explanation": "Why this pattern applies" },
  { "cue_type": "speed",     "cue_level": 3, "content": "Level 3: Step-by-step solution direction. Number each step and separate with \\n:\\n1. First step\\n2. Second step\\n3. Third step", "why_explanation": "Why this method works" },
  { "cue_type": "kill_shot", "cue_level": 4, "content": "Level 4: Kill Shot — the one decisive line that ends the problem", "why_explanation": "Why this is the key move" }
]

Return exactly 4 elements. All text must be in English. Use actual \\n characters (not literal backslash-n) for line breaks within content strings.`;

  const result = await model.generateContent(prompt);
  try {
    return parseGeminiJson(result.response.text()) as GeneratedCue[];
  } catch {
    console.warn("generateCuesForProblem JSON parse failed, returning empty cues");
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
async function generateTargetedProblems(conceptName: string): Promise<RawExtractedProblem[]> {
  const model = getJsonModel();

  const prompt = `Math education expert. The concept "${conceptName}" was identified as important in a PDF but has no practice problems yet. Generate 1-2 representative math problems that directly test this concept.

Return JSON array only:
[{"content":"Complete problem statement with all given info and what to find/prove. Use $LaTeX$ for math.","problem_type":"str","difficulty":3,"concepts":["${conceptName}"],"section":null,"page":null,"problem_number":null}]

Rules: problems must be fully self-contained — a student must be able to solve each problem from the content alone. Include all given values, conditions, and what to compute/prove. Use LaTeX for math notation. difficulty 1-5. Return 1 if concept is narrow, 2 if broad.`;

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

// 메인: PDF 청크 분할 → 문제 추출 → Cue 생성
export async function analyzePDF(base64Data: string): Promise<GeminiAnalysisResult> {
  // 1단계: PDF를 청크로 분할
  const chunks = await splitPDFIntoChunks(base64Data);

  // 2단계: 청크별 문제 추출 (순차 처리 — API 속도 제한 방지)
  const allConcepts: GeminiAnalysisResult["concepts"] = [];
  const allRawProblems: RawExtractedProblem[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const extracted = await extractProblemsFromChunk(chunks[i], i);
    allConcepts.push(...extracted.concepts);
    allRawProblems.push(...extracted.problems);
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

  // 2.5단계: 커버리지 검사 — 중요 개념 중 문제 수가 부족한 것에 대해 보충 문제 생성
  // is_hot/is_key: 최소 2문제, is_trap/frequency≥4: 최소 1문제
  const conceptCoverage = new Map<string, number>();
  for (const p of allRawProblems) {
    for (const c of p.concepts) {
      const key = c.toLowerCase();
      conceptCoverage.set(key, (conceptCoverage.get(key) ?? 0) + 1);
    }
  }
  const uncoveredImportant = Array.from(conceptMap.values()).filter((c) => {
    const count = conceptCoverage.get(c.name.toLowerCase()) ?? 0;
    const minRequired = (c.is_hot || c.is_key) ? 2 : 1;
    return (c.is_hot || c.is_key || c.is_trap || c.frequency >= 4) && count < minRequired;
  });

  if (uncoveredImportant.length > 0) {
    console.log(`Coverage gap: generating targeted problems for ${uncoveredImportant.length} uncovered concept(s): ${uncoveredImportant.map((c) => c.name).join(", ")}`);
    // Cap at 8 to avoid runaway API usage
    const toFill = uncoveredImportant.slice(0, 8);
    for (const concept of toFill) {
      const targeted = await generateTargetedProblems(concept.name);
      allRawProblems.push(...targeted);
    }
  }

  // 3단계: 문제별 Cue 병렬 생성 (5개씩 배치)
  const BATCH_SIZE = 5;
  const problemsWithCues: GeneratedProblem[] = [];

  for (let i = 0; i < allRawProblems.length; i += BATCH_SIZE) {
    const batch = allRawProblems.slice(i, i + BATCH_SIZE);
    const cueResults = await Promise.all(
      batch.map((p) => generateCuesForProblem(p.content))
    );
    batch.forEach((problem, j) => {
      problemsWithCues.push({ ...problem, cues: cueResults[j] });
    });
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

  return {
    summary: `총 ${chunks.length}개 구간, ${allRawProblems.length}개 문제 분석 완료`,
    concepts: Array.from(conceptMap.values()),
    problem_types: Array.from(typeMap.entries()).map(([type, v]) => ({
      type,
      count: v.count,
      concepts: Array.from(v.concepts),
    })),
    problems: problemsWithCues,
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

Return JSON array only:
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

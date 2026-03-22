import { GoogleGenerativeAI } from "@google/generative-ai";
import { PDFDocument } from "pdf-lib";
import type { GeminiAnalysisResult, GeneratedCue, GeneratedProblem } from "@/types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const PAGES_PER_CHUNK = 15; // 한 번에 처리할 페이지 수

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

// 청크 하나에서 문제 목록 추출 (Cue 없이)
async function extractProblemsFromChunk(
  base64Chunk: string,
  chunkIndex: number
): Promise<{ concepts: GeminiAnalysisResult["concepts"]; problems: Array<{ content: string; problem_type: string; difficulty: number; concepts: string[] }> }> {
  const model = getJsonModel();

  const prompt = `수학 교육 전문가로서 이 PDF 청크(${chunkIndex + 1}번째 구간)를 분석하세요. Cue는 생성하지 마세요.

{
  "concepts": [
    { "name": "개념명", "frequency": 1~5, "is_hot": bool, "is_trap": bool, "is_key": bool }
  ],
  "problems": [
    {
      "content": "문제 내용 (수식은 텍스트로, 간결하게)",
      "problem_type": "유형",
      "difficulty": 1~5,
      "concepts": ["개념1"]
    }
  ]
}

규칙:
- 이 청크의 모든 문제를 포함 (생략 없이)
- problems에 cues 필드 없음
- difficulty, frequency는 정수`;

  const result = await model.generateContent([
    { inlineData: { data: base64Chunk, mimeType: "application/pdf" } },
    prompt,
  ]);

  return JSON.parse(result.response.text().trim());
}

// 문제 하나에 대해 Cue 4개 생성
export async function generateCuesForProblem(problemContent: string): Promise<GeneratedCue[]> {
  const model = getJsonModel();

  const prompt = `수학 문제에 대한 4단계 Cue를 JSON 배열로 생성하세요.

문제: ${problemContent}

[
  { "cue_type": "kill_shot", "cue_level": 1, "content": "접근 전략", "why_explanation": "이유" },
  { "cue_type": "pattern",   "cue_level": 2, "content": "패턴 가이드", "why_explanation": "이유" },
  { "cue_type": "speed",     "cue_level": 3, "content": "풀이 방향", "why_explanation": "이유" },
  { "cue_type": "kill_shot", "cue_level": 4, "content": "Kill Shot - 결정적 한 줄", "why_explanation": "이유" }
]

정확히 4개만 반환하세요.`;

  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text().trim()) as GeneratedCue[];
}

// 메인: PDF 청크 분할 → 문제 추출 → Cue 생성
export async function analyzePDF(base64Data: string): Promise<GeminiAnalysisResult> {
  // 1단계: PDF를 청크로 분할
  const chunks = await splitPDFIntoChunks(base64Data);

  // 2단계: 청크별 문제 추출 (순차 처리 — API 속도 제한 방지)
  const allConcepts: GeminiAnalysisResult["concepts"] = [];
  const allRawProblems: Array<{ content: string; problem_type: string; difficulty: number; concepts: string[] }> = [];

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

export async function generateFeedback(
  mistakeType: string,
  problemContent: string,
  cuesUsed: number
): Promise<string> {
  const model = getTextModel();

  const prompt = `수학 학습 피드백을 생성하세요.

문제: ${problemContent}
실수 유형: ${mistakeType}
사용한 Cue 수: ${cuesUsed}

"개념 부족" 같은 모호한 진단 대신, 학생의 실수 행동을 정확히 타격하는 구체적인 피드백을 1-2문장으로 작성하세요.
예: "Trap Cue 미적용 → 절댓값 분기 오류: 절댓값 내부의 부호를 확인하지 않고 전개했습니다. 다음엔 절댓값 기호를 보는 순간 분기 처리를 먼저 하세요."

피드백 텍스트만 반환하세요.`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

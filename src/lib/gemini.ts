import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GeminiAnalysisResult, GeneratedCue, GeneratedProblem } from "@/types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

function getJsonModel() {
  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.3,
      maxOutputTokens: 32768,
    },
  });
}

function getTextModel() {
  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.5 },
  });
}

// 1단계: PDF에서 개념 + 문제 목록만 추출 (Cue 없음 → 출력 작음)
async function extractProblemsFromPDF(
  base64Data: string,
  mimeType: string
): Promise<{ summary: string; concepts: GeminiAnalysisResult["concepts"]; problem_types: GeminiAnalysisResult["problem_types"]; problems: Array<{ content: string; problem_type: string; difficulty: number; concepts: string[] }> }> {
  const model = getJsonModel();

  const prompt = `당신은 수학 교육 전문가입니다. PDF를 분석해 아래 JSON만 반환하세요. Cue는 생성하지 마세요.

{
  "summary": "문서 요약 1-2문장",
  "concepts": [
    { "name": "개념명", "frequency": 1~5, "is_hot": bool, "is_trap": bool, "is_key": bool }
  ],
  "problem_types": [
    { "type": "유형명", "count": 숫자, "concepts": ["개념"] }
  ],
  "problems": [
    {
      "content": "문제 내용 (수식은 텍스트로, 핵심만 간결하게)",
      "problem_type": "유형",
      "difficulty": 1~5,
      "concepts": ["개념1"]
    }
  ]
}

규칙:
- PDF의 모든 문제를 포함하세요 (생략 없이)
- problems에는 cues 필드를 넣지 마세요
- difficulty, frequency는 반드시 정수`;

  const result = await model.generateContent([
    { inlineData: { data: base64Data, mimeType } },
    prompt,
  ]);

  return JSON.parse(result.response.text().trim());
}

// 2단계: 문제 하나에 대해 Cue 4개 생성
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

// 메인: 2단계로 분리 처리
export async function analyzePDF(
  base64Data: string,
  mimeType: string = "application/pdf"
): Promise<GeminiAnalysisResult> {
  // 1단계: 개념 + 문제 목록 추출
  const extracted = await extractProblemsFromPDF(base64Data, mimeType);

  // 2단계: 문제별 Cue 병렬 생성 (최대 5개씩 배치)
  const BATCH_SIZE = 5;
  const problemsWithCues: GeneratedProblem[] = [];

  for (let i = 0; i < extracted.problems.length; i += BATCH_SIZE) {
    const batch = extracted.problems.slice(i, i + BATCH_SIZE);

    const cueResults = await Promise.all(
      batch.map((p) => generateCuesForProblem(p.content))
    );

    batch.forEach((problem, j) => {
      problemsWithCues.push({ ...problem, cues: cueResults[j] });
    });
  }

  return {
    summary: extracted.summary,
    concepts: extracted.concepts,
    problem_types: extracted.problem_types,
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

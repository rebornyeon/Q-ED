export type Locale = "ko" | "en";

export type CueType = "kill_shot" | "trap" | "pattern" | "speed";
export type CueLevel = 1 | 2 | 3 | 4;

export interface Profile {
  id: string;
  display_name: string | null;
  locale: Locale;
  created_at: string;
}

export interface Document {
  id: string;
  user_id: string;
  title: string;
  file_path: string;
  analysis: DocumentAnalysis | null;
  created_at: string;
}

export interface DocumentAnalysis {
  concepts: Concept[];
  problem_types: ProblemType[];
  total_problems: number;
  difficulty_distribution: Record<string, number>;
}

export interface Concept {
  name: string;
  frequency: number; // 1-5: 출제 빈도
  is_hot: boolean; // 🔥 자주 출제
  is_trap: boolean; // ⚠️ 자주 틀리는 포인트
  is_key: boolean; // 💯 고득점 핵심
}

export interface ProblemType {
  type: string;
  count: number;
  concepts: string[];
}

export interface StudySession {
  id: string;
  user_id: string;
  document_id: string;
  name: string | null;
  status: "active" | "completed";
  score_data: ScoreData | null;
  created_at: string;
  document?: Document;
}

export interface ScoreData {
  accuracy: number; // 0-100
  speed: number; // 0-100
  pattern_recognition: number; // 0-100
  trap_avoidance: number; // 0-100
  thinking_depth: number; // 0-100
  weak_concepts?: [string, number][]; // [concept, weight] sorted desc
}

export interface Problem {
  id: string;
  session_id: string;
  document_id: string;
  content: string;
  problem_type: string | null;
  difficulty: number | null; // 1-5
  concepts: string[];
  section: string | null;
  page: number | null;
  problem_number: string | null;
  exam_likelihood: number | null; // 1-5: how likely this appears on exam
  is_exam_overlap: boolean | null; // concepts overlap with past exam problems
  created_at: string;
  cues?: Cue[];
}

export interface Cue {
  id: string;
  problem_id: string;
  cue_type: CueType;
  cue_level: CueLevel;
  content: string;
  why_explanation: string | null;
  created_at: string;
}

export interface AttemptLog {
  id: string;
  problem_id: string;
  user_id: string;
  is_correct: boolean;
  time_spent: number; // seconds
  cues_used: number;
  mistake_type: string | null;
  feedback: string | null;
  created_at: string;
}

export type SupplementaryDocType = "past_exam" | "prof_notes" | "study_guide" | "formula_sheet" | "other";

export interface SupplementaryInsights {
  emphasized_topics: string[];
  exam_patterns: string[];
  study_tips: string[];
  key_formulas: string[];
  summary: string;
  doc_type?: SupplementaryDocType;
}

export interface RawProblem {
  content: string;
  problem_type: string;
  difficulty: number;
  concepts: string[];
  section: string | null;
  page?: number | null;
  problem_number?: string | null;
}

export interface SupplementaryDocument {
  id: string;
  document_id: string;
  title: string;
  file_path: string;
  insights: SupplementaryInsights;
  problems: RawProblem[];
  created_at: string;
}

export interface GeminiAnalysisResult {
  concepts: Concept[];
  problems: GeneratedProblem[];
  problem_types: ProblemType[];
  summary: string;
}

export interface GeneratedProblem {
  content: string;
  problem_type: string;
  difficulty: number;
  concepts: string[];
  section: string | null;
  cues: GeneratedCue[];
}

export interface GeneratedCue {
  cue_type: CueType;
  cue_level: CueLevel;
  content: string;
  why_explanation: string;
}

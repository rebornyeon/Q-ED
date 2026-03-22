import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateFeedback } from "@/lib/gemini";
import type { ScoreData } from "@/types";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { problemId, problemContent, isCorrect, timeSpent, cuesUsed, mistakeType } =
    await request.json();

  // Generate feedback if incorrect
  let feedback: string | null = null;
  if (!isCorrect && mistakeType) {
    feedback = await generateFeedback(mistakeType, problemContent, cuesUsed);
  }

  // Log attempt
  const { error: logError } = await supabase.from("attempt_logs").insert({
    problem_id: problemId,
    user_id: user.id,
    is_correct: isCorrect,
    time_spent: timeSpent,
    cues_used: cuesUsed,
    mistake_type: mistakeType || null,
    feedback,
  });

  if (logError) {
    return NextResponse.json({ error: "Failed to log attempt" }, { status: 500 });
  }

  // Calculate updated score for the session
  const { data: logs } = await supabase
    .from("attempt_logs")
    .select("is_correct, time_spent, cues_used")
    .eq("user_id", user.id);

  let score: ScoreData = {
    accuracy: 0,
    speed: 0,
    pattern_recognition: 0,
    trap_avoidance: 0,
    thinking_depth: 0,
  };

  if (logs && logs.length > 0) {
    const correct = logs.filter((l) => l.is_correct).length;
    const avgTime = logs.reduce((s, l) => s + l.time_spent, 0) / logs.length;
    const avgCues = logs.reduce((s, l) => s + l.cues_used, 0) / logs.length;

    score = {
      accuracy: Math.round((correct / logs.length) * 100),
      speed: Math.max(0, Math.round(100 - (avgTime / 300) * 100)),
      pattern_recognition: Math.round(Math.max(0, 100 - avgCues * 20)),
      trap_avoidance: Math.round((correct / logs.length) * 90 + 10),
      thinking_depth: Math.round(Math.min(100, avgCues * 25)),
    };
  }

  return NextResponse.json({ feedback, score });
}

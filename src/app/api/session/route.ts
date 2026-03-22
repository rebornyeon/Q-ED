import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { GeminiAnalysisResult } from "@/types";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { documentId } = await request.json();

  if (!documentId) {
    return NextResponse.json({ error: "documentId is required" }, { status: 400 });
  }

  // Get document with analysis
  const { data: document, error: docError } = await supabase
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .eq("user_id", user.id)
    .single();

  if (docError || !document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // Create study session
  const { data: session, error: sessionError } = await supabase
    .from("study_sessions")
    .insert({
      user_id: user.id,
      document_id: documentId,
      status: "active",
    })
    .select()
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }

  // Create problems from analysis
  const analysis = document.analysis as GeminiAnalysisResult;
  if (analysis?.problems && analysis.problems.length > 0) {
    const problemsToInsert = analysis.problems.map((p) => ({
      session_id: session.id,
      document_id: documentId,
      content: p.content,
      problem_type: p.problem_type,
      difficulty: p.difficulty,
      concepts: p.concepts,
    }));

    const { data: problems, error: problemsError } = await supabase
      .from("problems")
      .insert(problemsToInsert)
      .select();

    if (problemsError) {
      return NextResponse.json({ error: "Failed to create problems" }, { status: 500 });
    }

    // Insert cues for each problem
    const cuesData = [];
    for (let i = 0; i < problems.length; i++) {
      const sourceProblem = analysis.problems[i];
      if (sourceProblem.cues) {
        for (const cue of sourceProblem.cues) {
          cuesData.push({
            problem_id: problems[i].id,
            cue_type: cue.cue_type,
            cue_level: cue.cue_level,
            content: cue.content,
            why_explanation: cue.why_explanation,
          });
        }
      }
    }

    if (cuesData.length > 0) {
      await supabase.from("cues").insert(cuesData);
    }

    return NextResponse.json({ session, problems });
  }

  return NextResponse.json({ session, problems: [] });
}

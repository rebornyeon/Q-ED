import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateCuesForProblem } from "@/lib/gemini";
import type { SupplementaryInsights } from "@/types";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { problemId, problemContent, regenerate } = await request.json();

  if (!problemId || !problemContent) {
    return NextResponse.json({ error: "problemId and problemContent are required" }, { status: 400 });
  }

  // Delete existing cues if regenerating
  if (regenerate) {
    await supabase.from("cues").delete().eq("problem_id", problemId);
  } else {
    // Check existing cues
    const { data: existingCues } = await supabase
      .from("cues")
      .select("*")
      .eq("problem_id", problemId)
      .order("cue_level");

    if (existingCues && existingCues.length > 0) {
      return NextResponse.json({ cues: existingCues });
    }
  }

  // Get document_id from problem to fetch supplementary context
  const { data: problem } = await supabase
    .from("problems")
    .select("document_id")
    .eq("id", problemId)
    .single();

  let supplementaryContext: SupplementaryInsights[] | undefined;
  if (problem?.document_id) {
    const { data: suppDocs } = await supabase
      .from("supplementary_documents")
      .select("insights")
      .eq("document_id", problem.document_id)
      .eq("user_id", user.id);

    if (suppDocs && suppDocs.length > 0) {
      supplementaryContext = suppDocs.map((d) => d.insights as SupplementaryInsights);
    }
  }

  // Generate new cues with Gemini (enriched with supplementary context)
  const generatedCues = await generateCuesForProblem(problemContent, supplementaryContext);

  const { data: cues, error } = await supabase
    .from("cues")
    .insert(
      generatedCues.map((c) => ({
        problem_id: problemId,
        cue_type: c.cue_type,
        cue_level: c.cue_level,
        content: c.content,
        why_explanation: c.why_explanation,
      }))
    )
    .select();

  if (error) {
    return NextResponse.json({ error: "Failed to save cues" }, { status: 500 });
  }

  return NextResponse.json({ cues });
}

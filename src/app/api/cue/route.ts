import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateCuesForProblem } from "@/lib/gemini";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { problemId, problemContent } = await request.json();

  if (!problemId || !problemContent) {
    return NextResponse.json({ error: "problemId and problemContent are required" }, { status: 400 });
  }

  // Check existing cues
  const { data: existingCues } = await supabase
    .from("cues")
    .select("*")
    .eq("problem_id", problemId)
    .order("cue_level");

  if (existingCues && existingCues.length > 0) {
    return NextResponse.json({ cues: existingCues });
  }

  // Generate new cues with Gemini
  const generatedCues = await generateCuesForProblem(problemContent);

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

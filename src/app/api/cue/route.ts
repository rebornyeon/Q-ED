import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateCuesForProblem } from "@/lib/gemini";
import type { KnowledgeBlock, SupplementaryInsights, DocumentAnalysis } from "@/types";

export async function POST(request: NextRequest) {
  try {
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

  // Check if this document is proof-based
  let isProofBased = false;
  if (problem?.document_id) {
    const { data: doc } = await supabase
      .from("documents")
      .select("analysis")
      .eq("id", problem.document_id)
      .single();
    if (doc?.analysis) {
      isProofBased = !!(doc.analysis as DocumentAnalysis).is_proof_based;
    }
  }

  let supplementaryContext: SupplementaryInsights[] | undefined;
  let supplementaryProblems: { content: string }[] | undefined;
  let knowledgeBlocks: KnowledgeBlock[] | undefined;
  if (problem?.document_id) {
    const { data: suppDocs } = await supabase
      .from("supplementary_documents")
      .select("insights, problems")
      .eq("document_id", problem.document_id)
      .eq("user_id", user.id);

    if (suppDocs && suppDocs.length > 0) {
      supplementaryContext = suppDocs.map((d) => d.insights as SupplementaryInsights);
      // Collect up to 10 problems from supplementary docs as concrete examples
      const allProblems = suppDocs.flatMap((d) =>
        Array.isArray(d.problems) ? (d.problems as { content: string }[]) : []
      );
      if (allProblems.length > 0) supplementaryProblems = allProblems.slice(0, 10);
      // Extract knowledge_blocks from insights
      const allBlocks = suppDocs.flatMap((d) => {
        const insights = d.insights as SupplementaryInsights;
        return Array.isArray(insights?.knowledge_blocks) ? insights.knowledge_blocks : [];
      });
      if (allBlocks.length > 0) knowledgeBlocks = allBlocks;
    }
  }

  // Generate new cues with Gemini (enriched with supplementary context)
  const generatedCues = await generateCuesForProblem(problemContent, supplementaryContext, supplementaryProblems, knowledgeBlocks, isProofBased);

  if (generatedCues.length === 0) {
    return NextResponse.json({ cues: [] });
  }

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
    console.error("Failed to save cues:", error);
    return NextResponse.json({ error: "Failed to save cues" }, { status: 500 });
  }

  return NextResponse.json({ cues });
  } catch (e) {
    console.error("cue route unhandled error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

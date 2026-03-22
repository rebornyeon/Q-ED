import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateSimilarFromPDF, generateCuesForProblem } from "@/lib/gemini";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { problemId, count = 3 } = await request.json();
  if (!problemId) return NextResponse.json({ error: "problemId required" }, { status: 400 });

  // Fetch the original problem (verify ownership via session)
  const { data: problem, error: probError } = await supabase
    .from("problems")
    .select("*, study_sessions!inner(user_id)")
    .eq("id", problemId)
    .single();

  if (probError || !problem) {
    return NextResponse.json({ error: "Problem not found" }, { status: 404 });
  }
  if (problem.study_sessions.user_id !== user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Fetch document (need file_path for PDF download + analysis for supplementary context)
  const { data: doc } = await supabase
    .from("documents")
    .select("file_path, analysis")
    .eq("id", problem.document_id)
    .eq("user_id", user.id)
    .single();

  if (!doc?.file_path) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // Download the PDF from Supabase Storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from("pdfs")
    .download(doc.file_path);

  if (downloadError || !fileData) {
    console.error("PDF download error:", downloadError);
    return NextResponse.json({ error: "PDF unavailable for generation" }, { status: 500 });
  }

  // Convert Blob → base64
  const arrayBuffer = await fileData.arrayBuffer();
  const pdfBase64 = Buffer.from(arrayBuffer).toString("base64");

  // Generate similar problems directly from the PDF
  const generated = await generateSimilarFromPDF(
    pdfBase64,
    {
      content: problem.content,
      problem_type: problem.problem_type,
      difficulty: problem.difficulty,
      concepts: problem.concepts,
      section: problem.section,
    },
    count
  );

  if (generated.length === 0) {
    return NextResponse.json({ error: "Failed to generate similar problems" }, { status: 500 });
  }

  return insertAndReturn(supabase, problem, generated);
}

async function insertAndReturn(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  problem: { session_id: string; document_id: string; exam_likelihood: number | null; is_exam_overlap: boolean | null },
  generated: Array<{ content: string; problem_type: string; difficulty: number; concepts: string[]; section: string | null }>
) {
  const toInsert = generated.map((p) => ({
    session_id: problem.session_id,
    document_id: problem.document_id,
    content: p.content,
    problem_type: p.problem_type,
    difficulty: p.difficulty,
    concepts: p.concepts,
    section: p.section,
    exam_likelihood: problem.exam_likelihood,
    is_exam_overlap: problem.is_exam_overlap,
  }));

  const { data: inserted, error: insertError } = await supabase
    .from("problems")
    .insert(toInsert)
    .select();

  if (insertError || !inserted) {
    console.error("Similar problems insert error:", insertError);
    return NextResponse.json({ error: "Failed to save problems" }, { status: 500 });
  }

  // Generate cues for each new problem
  const cuesData = [];
  for (const newProblem of inserted) {
    const cues = await generateCuesForProblem(newProblem.content);
    for (const cue of cues) {
      cuesData.push({
        problem_id: newProblem.id,
        cue_type: cue.cue_type,
        cue_level: cue.cue_level,
        content: cue.content,
        why_explanation: cue.why_explanation,
      });
    }
  }

  if (cuesData.length > 0) {
    await supabase.from("cues").insert(cuesData);
  }

  return NextResponse.json({ problems: inserted, count: inserted.length });
}

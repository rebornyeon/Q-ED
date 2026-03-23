import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PDFDocument } from "pdf-lib";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { parseGeminiJson } from "@/lib/gemini";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { problemId } = await request.json();
  if (!problemId) return NextResponse.json({ error: "problemId required" }, { status: 400 });

  // Fetch problem + document
  const { data: problem } = await supabase
    .from("problems")
    .select("*, documents(title, file_path)")
    .eq("id", problemId)
    .single();

  if (!problem) return NextResponse.json({ error: "Problem not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = (problem as any).documents;
  if (!doc?.file_path) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  // Download PDF
  const { data: fileData, error: fileError } = await supabase.storage.from("pdfs").download(doc.file_path);
  if (fileError || !fileData) return NextResponse.json({ error: "Failed to download PDF" }, { status: 500 });

  const arrayBuffer = await fileData.arrayBuffer();
  const pdfBytes = new Uint8Array(arrayBuffer);

  // Extract relevant pages: the problem's page ±2 (or first 3 pages if no page info)
  const srcDoc = await PDFDocument.load(pdfBytes);
  const totalPages = srcDoc.getPageCount();
  const problemPage = problem.page ? problem.page - 1 : 0; // convert 1-based to 0-based
  const startPage = Math.max(0, problemPage - 1);
  const endPage = Math.min(totalPages - 1, problemPage + 2);

  const chunkDoc = await PDFDocument.create();
  const pageIndices = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
  const copiedPages = await chunkDoc.copyPages(srcDoc, pageIndices);
  copiedPages.forEach((p) => chunkDoc.addPage(p));
  const chunkBase64 = Buffer.from(await chunkDoc.save()).toString("base64");

  // Re-extract with Gemini
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 8192 },
  });

  const sectionHint = problem.section ? `Focus on section: "${problem.section}".` : "";
  const pageHint = problem.page ? `The problem is on page ${problem.page}.` : "";
  const numberHint = problem.problem_number ? `Problem number: ${problem.problem_number}.` : "";

  const prompt = `Math education expert. ${sectionHint} ${pageHint} ${numberHint}

Find and re-extract the COMPLETE statement of this specific problem from the PDF pages provided.

Original (possibly incomplete) problem content:
${problem.content}

Return ONLY valid JSON — no markdown, no code blocks:
{
  "content": "The COMPLETE and ACCURATE problem statement. Include ALL given information, conditions, constraints, and exactly what the student needs to find/prove/compute. Use $LaTeX$ for math.",
  "problem_type": "${problem.problem_type}",
  "difficulty": ${problem.difficulty ?? 3},
  "concepts": ${JSON.stringify(problem.concepts ?? [])}
}

Rules:
- The content MUST be complete — a student must be able to solve the problem without looking at the PDF.
- Include all given values, matrices, functions, conditions.
- End with a clear instruction: "Find...", "Prove that...", "Show that...", "Compute...", etc.
- Use LaTeX for all math.`;

  const result = await model.generateContent([
    { inlineData: { data: chunkBase64, mimeType: "application/pdf" } },
    prompt,
  ]);

  let parsed: { content: string; problem_type: string; difficulty: number; concepts: string[] };
  try {
    parsed = parseGeminiJson(result.response.text());
  } catch {
    return NextResponse.json({ error: "Failed to parse Gemini response" }, { status: 500 });
  }

  if (!parsed.content || parsed.content.trim().length < 20) {
    return NextResponse.json({ error: "Generated content too short" }, { status: 500 });
  }

  // Update problem + delete old cues
  const { data: updated, error: updateError } = await supabase
    .from("problems")
    .update({
      content: parsed.content.trim(),
      problem_type: parsed.problem_type || problem.problem_type,
      difficulty: parsed.difficulty || problem.difficulty,
      concepts: parsed.concepts?.length ? parsed.concepts : problem.concepts,
    })
    .eq("id", problemId)
    .select()
    .single();

  if (updateError) return NextResponse.json({ error: "Failed to update problem" }, { status: 500 });

  // Delete stale cues so they get regenerated fresh
  await supabase.from("cues").delete().eq("problem_id", problemId);

  return NextResponse.json({ problem: updated });
}

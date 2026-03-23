import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { problemId, sessionId } = await request.json();

  // Check if note already exists for this exact problem
  const { data: existing } = await supabase
    .from("study_notes")
    .select("*")
    .eq("problem_id", problemId)
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .single();

  if (existing) {
    return NextResponse.json({ note: existing, skipped: true });
  }

  // Fetch problem and join document
  const { data: problem } = await supabase
    .from("problems")
    .select("*, documents(title, file_path)")
    .eq("id", problemId)
    .single();

  if (!problem) {
    return NextResponse.json({ error: "Problem not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = (problem as any).documents;
  if (!doc?.file_path) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // Download the PDF from Supabase Storage
  const { data: fileData, error: fileError } = await supabase.storage
    .from("pdfs")
    .download(doc.file_path);

  if (fileError || !fileData) {
    return NextResponse.json({ error: "Failed to download PDF" }, { status: 500 });
  }

  // Convert to base64
  const arrayBuffer = await fileData.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  // Call Gemini 2.5 Flash with PDF inline
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const conceptsStr = Array.isArray(problem.concepts) ? problem.concepts.join(", ") : "";
  const sectionStr = problem.section ? `\nSection: ${problem.section}` : "";

  const prompt = `You are analyzing a math textbook PDF. A student just worked on this problem:

Problem: ${problem.content}
Concepts: ${conceptsStr}${sectionStr}

Find the KEY theorem, definition, or formula from this textbook PDF that is MOST essential for solving this problem.

Return ONLY valid JSON (no markdown, no code blocks):
{
  "title": "Full name, e.g. 'Theorem 3.2: Linearity of Transformations'",
  "reference": "Short reference, e.g. 'Theorem 3.2, p.47' or 'Definition 2.1, p.23'",
  "page": 47,
  "content": "The exact statement from the textbook. Use LaTeX: $...$ for inline math, $$...$$ for display math. Use \\n for line breaks between parts.",
  "summary": "One sentence: why this theorem/definition is the key to solving the problem above."
}

Rules:
- NEVER write math expressions twice (no "$T+S$ T+S" — use LaTeX only)
- If multiple theorems apply, pick the MOST essential one
- If no specific theorem found, use title "Key Concept: [name]" and reference the nearest page`;

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: "application/pdf",
        data: base64,
      },
    },
    prompt,
  ]);

  const rawText = result.response.text().trim();
  // Strip ```json code blocks if present
  const jsonText = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: {
    title: string;
    reference: string;
    page: number;
    content: string;
    summary: string;
  };

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return NextResponse.json({ error: "Failed to parse Gemini response" }, { status: 500 });
  }

  // Skip if same theorem/title already exists in this session
  const { data: titleDuplicate } = await supabase
    .from("study_notes")
    .select("id")
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .ilike("title", parsed.title.trim())
    .maybeSingle();

  if (titleDuplicate) {
    // Increment reference_count to show importance
    const { data: current } = await supabase
      .from("study_notes")
      .select("reference_count")
      .eq("id", titleDuplicate.id)
      .single();
    await supabase
      .from("study_notes")
      .update({ reference_count: (current?.reference_count ?? 1) + 1 })
      .eq("id", titleDuplicate.id);
    return NextResponse.json({ note: titleDuplicate, skipped: true });
  }

  // Insert into study_notes table
  const { data: note, error: insertError } = await supabase
    .from("study_notes")
    .insert({
      session_id: sessionId,
      problem_id: problemId,
      user_id: user.id,
      title: parsed.title,
      reference: parsed.reference ?? null,
      page: parsed.page ?? null,
      content: parsed.content,
      summary: parsed.summary ?? null,
      user_note: "",
    })
    .select("*")
    .single();

  if (insertError) {
    return NextResponse.json({ error: "Failed to save note" }, { status: 500 });
  }

  return NextResponse.json({ note });
}

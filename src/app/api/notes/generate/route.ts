import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { problemId, sessionId, cuesUsed, qaHistory } = await request.json();

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
  // @ts-expect-error thinkingConfig not yet in SDK types
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { thinkingConfig: { thinkingBudget: 0 } } });

  const conceptsStr = Array.isArray(problem.concepts) ? problem.concepts.join(", ") : "";
  const sectionStr = problem.section ? `\nSection: ${problem.section}` : "";

  const cuesBlock = cuesUsed && cuesUsed.length > 0
    ? `\n\nHINTS THE STUDENT USED:\n${cuesUsed.map((c: { level: number; content: string; why?: string }) =>
        `[L${c.level}] ${c.content}${c.why ? `\n  Why: ${c.why}` : ""}`
      ).join("\n")}`
    : "";

  const qaBlock = qaHistory && qaHistory.length > 0
    ? `\n\nQ&A DURING SOLVING:\n${qaHistory.map((h: { q: string; a: string }, i: number) =>
        `Q${i + 1}: ${h.q}\nA${i + 1}: ${h.a}`
      ).join("\n\n")}`
    : "";

  const prompt = `You are analyzing a math textbook PDF. A student just worked on this problem:

Problem: ${problem.content}
Concepts: ${conceptsStr}${sectionStr}${cuesBlock}${qaBlock}

STEP 1 — Detect explicit references: Check the problem text AND the hints/Q&A above for any explicitly named theorem, definition, or lemma (e.g. "Theorem 56", "Definition 3.2"). If a theorem was mentioned or used in the hints or Q&A, prioritize finding that exact theorem in the PDF. Does the problem explicitly name a theorem, definition, or lemma by number or name? (e.g. "use Theorem 56", "by Definition 3.2", "applying Lemma 4.1")
- If YES: you MUST find and quote THAT exact theorem/definition from the PDF. Do not substitute a different one.
- If NO: find the theorem or definition most essential for solving this problem.

STEP 2 — Find it in the PDF: Locate the exact statement in the PDF text. Quote it verbatim.

Return ONLY valid JSON (no markdown, no code blocks):
{
  "title": "Full name as it appears in the PDF, e.g. 'Theorem 56: Invertibility Criterion'",
  "reference": "Short reference, e.g. 'Theorem 56, p.183' or 'Definition 2.1, p.23'",
  "page": 183,
  "content": "The EXACT statement copied from the PDF. Use LaTeX: $...$ for inline math, $$...$$ for display math. Matrices must use $$\\begin{bmatrix}...\\end{bmatrix}$$. Use \\n for line breaks.",
  "summary": "One sentence: why this theorem is the key to solving the problem."
}

Rules:
- NEVER write math expressions twice (no "$T+S$ T+S" — use LaTeX only)
- CRITICAL: If the problem text OR any hint OR any Q&A answer explicitly names a theorem/definition (e.g. "Theorem 56", "Definition 3.2"), that is the one to save — find it in the PDF and quote it exactly. Do not substitute.
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

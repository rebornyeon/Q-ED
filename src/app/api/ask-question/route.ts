import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { problemId, question, history, imageBase64, imageMimeType } = await request.json();

  if (!problemId || !question) {
    return NextResponse.json({ error: "problemId and question are required" }, { status: 400 });
  }

  const priorQA: { q: string; a: string }[] = Array.isArray(history) ? history : [];

  // Fetch problem with full details
  const { data: problem } = await supabase
    .from("problems")
    .select("*")
    .eq("id", problemId)
    .single();

  if (!problem) {
    return NextResponse.json({ error: "Problem not found" }, { status: 404 });
  }

  // Fetch cues for this problem
  const { data: cues } = await supabase
    .from("cues")
    .select("*")
    .eq("problem_id", problemId)
    .order("cue_level");

  // Build cue context
  const cueContext = cues && cues.length > 0
    ? cues.map((c) => `Level ${c.cue_level} (${c.cue_type}): ${c.content}\nWhy: ${c.why_explanation}`).join("\n\n")
    : "No cues available yet.";

  // Fetch document title if available
  let docTitle = "";
  if (problem.document_id) {
    const { data: doc } = await supabase
      .from("documents")
      .select("title")
      .eq("id", problem.document_id)
      .single();
    if (doc?.title) docTitle = doc.title;
  }

  // Build conversation history block
  const historyBlock = priorQA.length > 0
    ? `--- PRIOR CONVERSATION (the student already asked these questions — DO NOT repeat answers, build on them) ---\n${priorQA.map((h, i) => `Q${i + 1}: ${h.q}\nA${i + 1}: ${h.a}`).join("\n\n")}\n\n`
    : "";

  // Use Gemini to answer
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
  });

  const prompt = `You are a patient, expert math tutor helping a student who is studying for an exam. Answer the student's NEW question about the problem below.

IMPORTANT GUIDELINES:
- Answer directly and clearly — explain the concept, not just the answer
- Use LaTeX notation for all math: inline $x^2$, display $$\\int_0^1 f(x)\\,dx$$
- If the student asks "how do I start?", guide them with the approach, don't solve it entirely
- If the student asks about a specific concept, explain the underlying theory with examples
- Reference the cues provided when relevant — they represent the ideal solution path
- Keep your answer concise but complete — aim for 2-5 paragraphs max
- You have access to the full conversation history below. Build on previous answers — do NOT repeat what you already explained. If the student is following up, go deeper or clarify further.
- Write in English

--- PROBLEM CONTEXT ---
${docTitle ? `Source: ${docTitle}` : ""}
${problem.section ? `Section: ${problem.section}` : ""}
${problem.page ? `Page: ${problem.page}` : ""}
${problem.problem_number ? `Problem #: ${problem.problem_number}` : ""}

Problem Statement:
${problem.content}

Concepts: ${(problem.concepts as string[]).join(", ")}
Difficulty: ${problem.difficulty}/5
Problem Type: ${problem.problem_type}

--- CUES (step-by-step hints provided to the student) ---
${cueContext}

${historyBlock}--- STUDENT'S NEW QUESTION ---
${question}`;

  const result = await model.generateContent(
    imageBase64 && imageMimeType
      ? [{ inlineData: { data: imageBase64, mimeType: imageMimeType } }, prompt]
      : prompt
  );
  const answer = result.response.text().trim();

  return NextResponse.json({ answer });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { problemId, question, history, imageBase64, imageMimeType, clientCues } = await request.json();

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

  // Build cue context — prefer DB cues, fall back to client-provided cues
  const cueSource = (cues && cues.length > 0) ? cues : (clientCues ?? []);
  const cueContext = cueSource.length > 0
    ? cueSource.map((c: { cue_level: number; cue_type: string; content: string; why_explanation: string }) => `Level ${c.cue_level} (${c.cue_type}): ${c.content}\nWhy: ${c.why_explanation}`).join("\n\n")
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

  const prompt = `You are a patient, expert math tutor helping a student studying for an exam. Answer the student's NEW question below.

CRITICAL FORMAT RULES:
- Split your answer into exactly 2-4 short steps, separated by a line containing only "---"
- Each step must be 2-4 sentences maximum — one focused idea per step
- First step: the key insight or direct answer. Subsequent steps: elaboration or follow-through
- Use LaTeX for all math: inline $x^2$, display $$\\begin{align*}...\\end{align*}$$
- NEVER write the same expression twice (no "$T+S$ T+S" — LaTeX only)
- If the student asks "how do I start?", give the approach only — do NOT solve it fully
- Build on prior conversation — never repeat what was already explained
- Write in English

Example format:
The key idea here is that we apply the chain rule to the outer function first.

---

Specifically, let $u = g(x)$, so the derivative becomes $f'(u) \cdot g'(x)$.

---

Applying this to your problem: $$\\frac{d}{dx}[\\sin(x^2)] = \\cos(x^2) \\cdot 2x$$

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

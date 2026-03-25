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

  type Intent = "INTUITION" | "PROCEDURAL" | "AUTO";

  const intentInstructions: Record<Intent, string> = {
    INTUITION: `→ INTUITION MODE: explain WHY the method/theorem is mathematically true.
  Step 1: Core idea in 1 sentence — what does the theorem really say?
  ---
  Step 2: Geometric or concrete analogy — a picture in words
  ---
  Step 3: Therefore, for this problem: [1 sentence application]`,
    PROCEDURAL: `→ PROCEDURAL MODE: minimum steps to move forward.
  Step 1: The key formula or theorem (LaTeX block)
  ---
  Step 2: Map this problem's values into the formula
  ---
  Step 3: The first concrete calculation`,
    AUTO: `→ AUTO MODE: judge from the question. If conceptual → intuition first. If stuck → formula first.
  Split into 2-3 steps separated by ---. Each step ≤ 3 sentences.`,
  };

  const q = question.toLowerCase();
  const intent: Intent =
    /why|왜|어떻게 성립|이유|직관|증명|intuition/.test(q) ? "INTUITION" :
    /how|어떻게|start|시작|what.*first|첫|어디서|approach/.test(q) ? "PROCEDURAL" :
    "AUTO";

  const prompt = `You are a concise math tutor. Answer the student's question below.

INTENT: ${intent}
${intentInstructions[intent]}

FORMAT RULES:
- Separate steps with a line containing only "---"
- Each step: ≤ 3 sentences, one focused idea
- Use LaTeX for all math: inline $x^2$, display $$\\begin{align*}...\\end{align*}$$
- No preamble, no "great question", no "let's think about"
- Build on prior conversation — never repeat what was already explained
- Write in English

--- PROBLEM CONTEXT ---
${docTitle ? `Source: ${docTitle}` : ""}
${problem.section ? `Section: ${problem.section}` : ""}
${problem.problem_number ? `Problem #: ${problem.problem_number}` : ""}

Problem: ${problem.content}

Concepts: ${(problem.concepts as string[]).join(", ")}

--- CUES SHOWN TO STUDENT ---
${cueContext}

${historyBlock}--- STUDENT'S QUESTION ---
${question}`;

  const result = await model.generateContent(
    imageBase64 && imageMimeType
      ? [{ inlineData: { data: imageBase64, mimeType: imageMimeType } }, prompt]
      : prompt
  );
  const answer = result.response.text().trim();

  return NextResponse.json({ answer });
}

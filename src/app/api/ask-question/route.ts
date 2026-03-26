import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const INTUITION_RE = /why|왜|어떻게 성립|이유|직관|증명|intuition/;
const PROCEDURAL_RE = /how|어떻게|start|시작|what.*first|첫|어디서|approach/;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { problemId, sessionId, question, history, imageBase64, imageMimeType, clientCues } = await request.json();

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

  // Fetch document title + session notes (textbook theorems already extracted)
  let docTitle = "";
  let notesContext = "";
  let suppMaterialContext = "";
  if (problem.document_id) {
    const { data: doc } = await supabase
      .from("documents")
      .select("title")
      .eq("id", problem.document_id)
      .single();
    if (doc?.title) docTitle = doc.title;

    // Fetch supplementary knowledge_blocks for this document
    const { data: suppDocs } = await supabase
      .from("supplementary_documents")
      .select("title, insights")
      .eq("document_id", problem.document_id)
      .eq("user_id", user.id);

    if (suppDocs && suppDocs.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allBlocks = suppDocs.flatMap((d: any) => {
        const blocks = d.insights?.knowledge_blocks;
        return Array.isArray(blocks) ? blocks : [];
      });
      if (allBlocks.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        suppMaterialContext = allBlocks.slice(0, 10).map((b: any, i: number) =>
          `${i + 1}. [${(b.type as string).charAt(0).toUpperCase() + (b.type as string).slice(1)}]${b.title ? ` ${b.title}` : ""}: ${(b.content as string).slice(0, 400)}`
        ).join("\n\n");
      }
    }
  }

  // Pull study_notes for this session — these contain verbatim theorem statements from the textbook
  const { data: sessionNotes } = await supabase
    .from("study_notes")
    .select("title, reference, content, summary")
    .eq("session_id", sessionId ?? "")
    .order("created_at", { ascending: false })
    .limit(5);

  if (sessionNotes && sessionNotes.length > 0) {
    notesContext = sessionNotes
      .map((n: { title: string; reference: string; content: string; summary: string }) =>
        `### ${n.title} (${n.reference})\n${n.content}${n.summary ? `\n→ ${n.summary}` : ""}`
      )
      .join("\n\n");
  }

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
    INTUITION_RE.test(q) ? "INTUITION" :
    PROCEDURAL_RE.test(q) ? "PROCEDURAL" :
    "AUTO";

  // Keep systemInstruction short — Gemini rejects overly long system prompts.
  // Long context (problem, theorems, cues) goes into the first history turn instead.
  const systemPrompt = `You are a concise math tutor helping a student work through a specific problem.

INTENT FOR THIS QUESTION: ${intent}
${intentInstructions[intent]}

FORMAT RULES:
- Separate steps with a line containing only "---"
- Each step: ≤ 3 sentences, one focused idea
- Use LaTeX for all math: inline $x^2$, display $$\\begin{align*}...\\end{align*}$$
- No preamble, no "great question", no "let's think about"
- Write in English`;

  // Build context block injected as the first user turn in history
  const contextBlock = `[CONTEXT — read before answering]
${docTitle ? `Source: ${docTitle}` : ""}${problem.section ? `\nSection: ${problem.section}` : ""}${problem.problem_number ? `\nProblem #: ${problem.problem_number}` : ""}

Problem: ${problem.content}

Concepts: ${(problem.concepts as string[]).join(", ")}
${notesContext ? `\n--- TEXTBOOK THEOREMS ---\n${notesContext}\n` : ""}${suppMaterialContext ? `\n--- SUPPLEMENTARY MATERIAL ---\n${suppMaterialContext}\n` : ""}
--- HINTS SHOWN TO STUDENT ---
${cueContext}`;

  // Build real chat history so Gemini maintains conversation state.
  // Inject context as the very first exchange so it stays in the conversation window.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatHistory: any[] = [
    { role: "user", parts: [{ text: contextBlock }] },
    { role: "model", parts: [{ text: "Understood. I have the problem context, textbook theorems, and hints. Ready to help." }] },
    ...priorQA.flatMap((h) => [
      { role: "user", parts: [{ text: h.q }] },
      { role: "model", parts: [{ text: h.a }] },
    ]),
  ];

  const chat = model.startChat({
    systemInstruction: systemPrompt,
    history: chatHistory,
  });

  const userParts = imageBase64 && imageMimeType
    ? [{ inlineData: { data: imageBase64, mimeType: imageMimeType } }, { text: question }]
    : [{ text: question }];

  const result = await chat.sendMessage(userParts);
  const answer = result.response.text().trim();

  return NextResponse.json({ answer });
}

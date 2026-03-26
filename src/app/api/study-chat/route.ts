import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId, documentId, question, history } = await request.json();
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

  const priorQA: { q: string; a: string }[] = Array.isArray(history) ? history : [];

  // Fetch session notes (textbook theorems extracted during study)
  const { data: sessionNotes } = await supabase
    .from("study_notes")
    .select("title, reference, content, summary")
    .eq("session_id", sessionId ?? "")
    .order("reference_count", { ascending: false })
    .limit(15);

  // Fetch supplementary knowledge_blocks
  let suppMaterialContext = "";
  if (documentId) {
    const { data: suppDocs } = await supabase
      .from("supplementary_documents")
      .select("title, insights")
      .eq("document_id", documentId)
      .eq("user_id", user.id);

    if (suppDocs && suppDocs.length > 0) {
      const sections: string[] = [];
      for (const d of suppDocs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const blocks: any[] = d.insights?.knowledge_blocks ?? [];
        if (blocks.length > 0) {
          sections.push(
            `=== ${d.title} ===\n` +
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            blocks.slice(0, 8).map((b: any, i: number) =>
              `${i + 1}. [${b.type}]${b.title ? ` ${b.title}` : ""}: ${(b.content as string).slice(0, 500)}`
            ).join("\n\n")
          );
        }
      }
      suppMaterialContext = sections.join("\n\n");
    }
  }

  // Fetch top concepts from session problems
  let topicSummary = "";
  if (sessionId) {
    const { data: problems } = await supabase
      .from("problems")
      .select("concepts, section")
      .eq("session_id", sessionId);

    if (problems && problems.length > 0) {
      const conceptCounts = new Map<string, number>();
      for (const p of problems) {
        for (const c of (p.concepts as string[])) {
          conceptCounts.set(c, (conceptCounts.get(c) ?? 0) + 1);
        }
      }
      const topConcepts = Array.from(conceptCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([c]) => c);
      topicSummary = `Topics in this study session: ${topConcepts.join(", ")}`;
    }
  }

  // Build context block injected as first history turn
  const notesSection = (sessionNotes && sessionNotes.length > 0)
    ? "=== TEXTBOOK THEOREMS ===\n" + sessionNotes.map((n) =>
        `${n.title} (${n.reference})\n${n.content}${n.summary ? `\n→ ${n.summary}` : ""}`
      ).join("\n\n")
    : "";

  const contextBlock = [
    topicSummary,
    notesSection,
    suppMaterialContext ? `=== SUPPLEMENTARY MATERIALS ===\n${suppMaterialContext}` : "",
  ].filter(Boolean).join("\n\n") || "No session materials available yet.";

  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    // @ts-expect-error thinkingConfig not yet in SDK types
    generationConfig: { temperature: 0.5, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
  });

  const systemPrompt = `You are a study assistant helping a student review their math course materials.
You have access to textbook theorems, lecture notes, and supplementary materials from their study session.
Answer questions clearly and concisely. Use LaTeX for all math: inline $...$ and display $$...$$.
No preamble, no "great question". Write in English.`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatHistory: any[] = [
    { role: "user", parts: [{ text: `[SESSION MATERIALS]\n${contextBlock}` }] },
    { role: "model", parts: [{ text: "Got it. I have your session materials. Ask me anything about the topics, theorems, or concepts you've studied." }] },
    ...priorQA.flatMap((h) => [
      { role: "user", parts: [{ text: h.q }] },
      { role: "model", parts: [{ text: h.a }] },
    ]),
  ];

  const chat = model.startChat({
    systemInstruction: { role: "user", parts: [{ text: systemPrompt }] },
    history: chatHistory,
  });

  const result = await chat.sendMessage([{ text: question }]);
  const answer = result.response.text().trim();

  return NextResponse.json({ answer });
}

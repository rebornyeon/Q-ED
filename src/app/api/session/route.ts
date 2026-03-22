import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { GeminiAnalysisResult, RawProblem, SupplementaryInsights } from "@/types";

// Rule-based exam likelihood scoring (no extra API call)
function scoreProblems(
  problems: RawProblem[],
  suppInsights: SupplementaryInsights[],
  suppProblems: RawProblem[]
): { exam_likelihood: number; is_exam_overlap: boolean }[] {
  const emphasized = new Set(suppInsights.flatMap((s) => s.emphasized_topics.map((t) => t.toLowerCase())));
  const patterns = new Set(suppInsights.flatMap((s) => s.exam_patterns.map((p) => p.toLowerCase())));
  const tips = new Set(suppInsights.flatMap((s) => s.study_tips.map((t) => t.toLowerCase())));

  // Build concept set from all past exam problems
  const pastExamConcepts = new Set(suppProblems.flatMap((p) => p.concepts.map((c) => c.toLowerCase())));
  const pastExamTypes = new Set(suppProblems.map((p) => p.problem_type.toLowerCase()));

  function fuzzyMatch(a: string, set: Set<string>) {
    const al = a.toLowerCase();
    return [...set].some((b) => al.includes(b) || b.includes(al));
  }

  return problems.map((p) => {
    let raw = 0;

    // +2 per concept matching emphasized topics (high weight)
    for (const c of p.concepts) {
      if (fuzzyMatch(c, emphasized)) raw += 2;
    }

    // +1 if problem type matches known exam patterns
    if (p.problem_type && fuzzyMatch(p.problem_type, patterns)) raw += 1;

    // +1 if any concept appears in professor's study tips
    for (const c of p.concepts) {
      if (fuzzyMatch(c, tips)) { raw += 1; break; }
    }

    // +2 if problem type directly matches past exam problem types (strong signal)
    if (p.problem_type && fuzzyMatch(p.problem_type, pastExamTypes)) raw += 2;

    // Past exam concept overlap (cross-reference)
    const overlap = p.concepts.some((c) => fuzzyMatch(c, pastExamConcepts));
    if (overlap) raw += 1;

    // Effective difficulty boost: hard + high-likelihood = prioritize
    const difficultyBoost = p.difficulty ? (p.difficulty - 3) * 0.5 : 0;
    raw += difficultyBoost;

    // Normalize raw score to 1-5
    // Max theoretical raw ≈ 10+ → clamp
    const likelihood = Math.min(5, Math.max(1, Math.round(raw)));

    return { exam_likelihood: likelihood, is_exam_overlap: overlap };
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { documentId: singleDocId, documentIds: multiDocIds, conceptFilter, includeSupplementary } = await request.json();
  const documentIds: string[] = multiDocIds ?? (singleDocId ? [singleDocId] : []);
  const primaryDocId = documentIds[0];
  const filterConcepts: string[] | null = conceptFilter ?? null;

  if (documentIds.length === 0) {
    return NextResponse.json({ error: "documentId or documentIds is required" }, { status: 400 });
  }

  const { data: documents, error: docError } = await supabase
    .from("documents")
    .select("*")
    .in("id", documentIds)
    .eq("user_id", user.id);

  if (docError || !documents || documents.length === 0) {
    return NextResponse.json({ error: "Documents not found" }, { status: 404 });
  }

  const { data: session, error: sessionError } = await supabase
    .from("study_sessions")
    .insert({ user_id: user.id, document_id: primaryDocId, status: "active" })
    .select()
    .single();

  if (sessionError || !session) {
    console.error("Session insert error:", sessionError);
    return NextResponse.json({ error: "Failed to create session", detail: sessionError?.message }, { status: 500 });
  }

  // Collect all main problems
  const multiDoc = documents.length > 1;
  const mainProblems: RawProblem[] = [];
  const sourceProblemsByDocId = new Map<string, GeminiAnalysisResult["problems"]>();

  for (const docId of documentIds) {
    const doc = documents.find((d) => d.id === docId);
    if (!doc) continue;
    const analysis = doc.analysis as GeminiAnalysisResult;
    sourceProblemsByDocId.set(docId, analysis?.problems ?? []);
    for (const p of analysis?.problems ?? []) {
      mainProblems.push({
        content: p.content,
        problem_type: p.problem_type,
        difficulty: p.difficulty,
        concepts: p.concepts,
        section: multiDoc ? `[${doc.title}] ${p.section ?? "General"}` : (p.section ?? null),
      });
    }
  }

  // Fetch supplementary docs (always — even if not including their problems, need insights for scoring)
  const { data: suppDocs } = await supabase
    .from("supplementary_documents")
    .select("title, problems, insights")
    .eq("document_id", primaryDocId)
    .eq("user_id", user.id);

  const suppInsights: SupplementaryInsights[] = (suppDocs ?? []).map((d) => d.insights as SupplementaryInsights);
  const allSuppProblems: RawProblem[] = (suppDocs ?? []).flatMap((d) =>
    Array.isArray(d.problems) ? (d.problems as RawProblem[]) : []
  );

  // Apply concept filter
  function applyFilter(probs: RawProblem[]) {
    return filterConcepts
      ? probs.filter((p) => p.concepts.some((c) => filterConcepts.includes(c)))
      : probs;
  }

  const filteredMain = applyFilter(mainProblems);

  // Score problems against supplementary (if supplementary exists)
  const hasSupplementary = suppInsights.length > 0 || allSuppProblems.length > 0;
  const scores = hasSupplementary
    ? scoreProblems(filteredMain, suppInsights, allSuppProblems)
    : filteredMain.map(() => ({ exam_likelihood: null, is_exam_overlap: null }));

  // Sort by exam_likelihood descending WITHIN each section
  const indexedMain = filteredMain.map((p, i) => ({ p, i, score: scores[i] }));
  const sectionGroups = new Map<string, typeof indexedMain>();
  for (const item of indexedMain) {
    const key = item.p.section ?? "__none__";
    if (!sectionGroups.has(key)) sectionGroups.set(key, []);
    sectionGroups.get(key)!.push(item);
  }
  for (const group of sectionGroups.values()) {
    group.sort((a, b) => (b.score.exam_likelihood ?? 0) - (a.score.exam_likelihood ?? 0));
  }
  // Also sort sections themselves by avg exam_likelihood when supplementary data is available
  const sectionsSorted = hasSupplementary
    ? [...sectionGroups.entries()].sort((a, b) => {
        const avg = (items: typeof indexedMain) =>
          items.reduce((s, x) => s + (x.score.exam_likelihood ?? 0), 0) / items.length;
        return avg(b[1]) - avg(a[1]);
      })
    : [...sectionGroups.entries()];
  const sortedMain = sectionsSorted.flatMap(([, group]) => group);

  // Supplementary problems (appended after main)
  const suppRawProblems: (RawProblem & { suppTitle: string })[] = [];
  if (includeSupplementary) {
    for (const doc of suppDocs ?? []) {
      for (const p of (Array.isArray(doc.problems) ? doc.problems : []) as RawProblem[]) {
        suppRawProblems.push({ ...p, suppTitle: doc.title });
      }
    }
  }
  const filteredSupp = applyFilter(suppRawProblems);

  const allProblemsToInsert = [
    ...sortedMain.map(({ p, score }) => ({
      session_id: session.id,
      document_id: primaryDocId,
      content: p.content,
      problem_type: p.problem_type,
      difficulty: p.difficulty,
      concepts: p.concepts,
      section: p.section ?? null,
      page: p.page ?? null,
      problem_number: p.problem_number ?? null,
      exam_likelihood: score.exam_likelihood,
      is_exam_overlap: score.is_exam_overlap,
    })),
    ...(filteredSupp as (RawProblem & { suppTitle: string })[]).map((p) => ({
      session_id: session.id,
      document_id: primaryDocId,
      content: p.content,
      problem_type: p.problem_type,
      difficulty: p.difficulty,
      concepts: p.concepts,
      section: p.section ? `[${p.suppTitle}] ${p.section}` : `[${p.suppTitle}]`,
      exam_likelihood: null,
      is_exam_overlap: null,
    })),
  ];

  if (allProblemsToInsert.length === 0) {
    return NextResponse.json({ session, problems: [] });
  }

  const { data: problems, error: problemsError } = await supabase
    .from("problems")
    .insert(allProblemsToInsert)
    .select();

  if (problemsError) {
    console.error("Problems insert error:", problemsError);
    return NextResponse.json({ error: "Failed to create problems", detail: problemsError.message }, { status: 500 });
  }

  // Insert pre-generated cues for main problems
  const cuesData = [];
  let problemOffset = 0;
  for (const docId of documentIds) {
    const srcProblems = sourceProblemsByDocId.get(docId) ?? [];
    const docFiltered = filterConcepts
      ? srcProblems.filter((p) => p.concepts.some((c) => filterConcepts.includes(c)))
      : srcProblems;

    // Match filtered+sorted problems back to source for cue insertion
    for (let i = 0; i < sortedMain.filter((x) => {
      const doc = documents.find((d) => d.id === docId);
      return doc && (x.p.section?.startsWith(`[${doc.title}]`) || !multiDoc);
    }).length; i++) {
      const src = docFiltered[i];
      if (src?.cues) {
        for (const cue of src.cues) {
          cuesData.push({
            problem_id: problems[problemOffset + i]?.id,
            cue_type: cue.cue_type,
            cue_level: cue.cue_level,
            content: cue.content,
            why_explanation: cue.why_explanation,
          });
        }
      }
    }
    problemOffset += docFiltered.length;
  }

  const validCues = cuesData.filter((c) => c.problem_id);
  if (validCues.length > 0) {
    await supabase.from("cues").insert(validCues);
  }

  return NextResponse.json({
    session,
    problems,
    filtered: filterConcepts !== null,
    supplementaryCount: filteredSupp.length,
    hasExamScoring: hasSupplementary,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { GeminiAnalysisResult, RawProblem, SupplementaryInsights } from "@/types";

export const maxDuration = 120;

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

// Proportional section distribution for max problem count
function selectByMaxCount(
  sorted: { p: RawProblem; i: number; score: { exam_likelihood: number | null; is_exam_overlap: boolean | null } }[],
  maxCount: number
): typeof sorted {
  if (sorted.length <= maxCount) return sorted;

  // Group by section, preserving sorted order within each section
  const sectionMap = new Map<string, typeof sorted>();
  for (const item of sorted) {
    const key = item.p.section ?? "__none__";
    if (!sectionMap.has(key)) sectionMap.set(key, []);
    sectionMap.get(key)!.push(item);
  }

  const sections = [...sectionMap.values()];
  const total = sorted.length;
  const selected: typeof sorted = [];

  // Proportional quota per section (at least 1 per section if possible)
  const quotas = sections.map((items) =>
    Math.max(1, Math.round((items.length / total) * maxCount))
  );

  // Trim quotas if sum exceeds maxCount (trim largest sections)
  let sum = quotas.reduce((a, b) => a + b, 0);
  if (sum > maxCount) {
    // Sort sections by size descending, reduce largest first
    const order = quotas.map((q, i) => i).sort((a, b) => quotas[b] - quotas[a]);
    for (const idx of order) {
      if (sum <= maxCount) break;
      const reduce = Math.min(quotas[idx] - 1, sum - maxCount);
      if (reduce > 0) { quotas[idx] -= reduce; sum -= reduce; }
    }
  }

  for (let i = 0; i < sections.length; i++) {
    selected.push(...sections[i].slice(0, quotas[i]));
  }

  // If still under maxCount due to rounding, fill with remaining highest-scored
  if (selected.length < maxCount) {
    const selectedSet = new Set(selected.map((x) => x.i));
    const remaining = sorted.filter((x) => !selectedSet.has(x.i));
    selected.push(...remaining.slice(0, maxCount - selected.length));
  }

  return selected.slice(0, maxCount);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    documentId: singleDocId,
    documentIds: multiDocIds,
    conceptFilter,
    includeSupplementary,
    maxProblems,
    difficultyRange,
    problemTypes,
    sections,
  } = await request.json();
  const documentIds: string[] = multiDocIds ?? (singleDocId ? [singleDocId] : []);
  const primaryDocId = documentIds[0];
  const filterConcepts: string[] | null = conceptFilter ?? null;
  const filterMaxProblems: number | null = maxProblems ?? null;
  const filterDifficultyRange: [number, number] | null = difficultyRange ?? null;
  const filterProblemTypes: string[] | null = problemTypes?.length > 0 ? problemTypes : null;
  const filterSections: string[] | null = sections?.length > 0 ? sections : null;

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

  // Apply all filters
  function applyFilter(probs: RawProblem[]) {
    let result = probs;
    if (filterConcepts) {
      result = result.filter((p) => p.concepts.some((c) => filterConcepts.includes(c)));
    }
    if (filterDifficultyRange) {
      const [min, max] = filterDifficultyRange;
      result = result.filter((p) => p.difficulty == null || (p.difficulty >= min && p.difficulty <= max));
    }
    if (filterProblemTypes) {
      result = result.filter((p) =>
        !p.problem_type || filterProblemTypes.some((t) => p.problem_type.toLowerCase().includes(t.toLowerCase()))
      );
    }
    if (filterSections) {
      result = result.filter((p) => filterSections.includes(p.section ?? ""));
    }
    return result;
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
  const allSortedMain = sectionsSorted.flatMap(([, group]) => group);
  // Apply max problem count with proportional section distribution
  const sortedMain = filterMaxProblems ? selectByMaxCount(allSortedMain, filterMaxProblems) : allSortedMain;

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

  // Test whether page/problem_number columns exist yet
  const { error: colCheck } = await supabase
    .from("problems")
    .select("page")
    .limit(0);
  const hasPageCol = !colCheck;

  const allProblemsToInsert = [
    ...sortedMain.map(({ p, score }) => ({
      session_id: session.id,
      document_id: primaryDocId,
      content: p.content,
      problem_type: p.problem_type,
      difficulty: p.difficulty,
      concepts: p.concepts,
      section: p.section ?? null,
      ...(hasPageCol ? { page: p.page ?? null, problem_number: p.problem_number ?? null } : {}),
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

  console.log(`[session] Inserting ${allProblemsToInsert.length} problems in batches`);

  // Batch insert to avoid PostgREST row limits on large datasets
  const BATCH_SIZE = 150;
  let insertError: { message: string } | null = null;
  for (let i = 0; i < allProblemsToInsert.length; i += BATCH_SIZE) {
    const batch = allProblemsToInsert.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("problems").insert(batch);
    if (error) {
      console.error(`[session] Batch ${Math.floor(i / BATCH_SIZE) + 1} insert error:`, error);
      insertError = error;
      break;
    }
  }

  if (insertError) {
    return NextResponse.json({ error: "Failed to create problems", detail: insertError.message }, { status: 500 });
  }

  console.log(`[session] All batches inserted successfully`);

  return NextResponse.json({
    session,
    filtered: filterConcepts !== null,
    supplementaryCount: filteredSupp.length,
    hasExamScoring: hasSupplementary,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId, suppDocId } = await request.json();
  if (!sessionId || !suppDocId) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  // Fetch the supplementary document (must belong to this user)
  const { data: suppDoc } = await supabase
    .from("supplementary_documents")
    .select("*")
    .eq("id", suppDocId)
    .eq("user_id", user.id)
    .single();

  if (!suppDoc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawProblems: any[] = suppDoc.problems ?? [];
  if (rawProblems.length === 0) return NextResponse.json({ problems: [], count: 0 });

  // Insert raw problems as Problem rows for this session
  const toInsert = rawProblems.map((p) => ({
    session_id: sessionId,
    document_id: suppDoc.document_id,
    content: p.content,
    problem_type: p.problem_type ?? null,
    difficulty: p.difficulty ?? null,
    concepts: p.concepts ?? [],
    section: p.section ?? null,
    page: p.page ?? null,
    problem_number: p.problem_number ?? null,
  }));

  const { data: inserted, error } = await supabase
    .from("problems")
    .insert(toInsert)
    .select("*");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ problems: inserted ?? [], count: inserted?.length ?? 0 });
}

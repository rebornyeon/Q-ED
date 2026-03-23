import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const { data: notes, error } = await supabase
    .from("study_notes")
    .select("*")
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .order("created_at");

  if (error) {
    return NextResponse.json({ error: "Failed to fetch notes" }, { status: 500 });
  }

  return NextResponse.json({ notes });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId, title, content } = await request.json();

  const { data: note, error } = await supabase
    .from("study_notes")
    .insert({
      session_id: sessionId,
      problem_id: null,
      user_id: user.id,
      title,
      reference: null,
      page: null,
      content,
      summary: null,
      user_note: "",
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }

  return NextResponse.json({ note });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { noteId } = await params;
  const { user_note } = await request.json();

  const { error } = await supabase
    .from("study_notes")
    .update({ user_note })
    .eq("id", noteId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { noteId } = await params;

  const { error } = await supabase
    .from("study_notes")
    .delete()
    .eq("id", noteId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

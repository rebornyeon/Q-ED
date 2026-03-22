import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify the session belongs to this user
  const { data: session } = await supabase
    .from("study_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .single();

  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Get all problem IDs for this session
  const { data: problems } = await supabase
    .from("problems")
    .select("id")
    .eq("session_id", sessionId);

  const problemIds = (problems ?? []).map((p) => p.id);

  if (problemIds.length > 0) {
    // Delete cues first (RLS references problems+sessions — must go before both)
    await supabase.from("cues").delete().in("problem_id", problemIds);
    // Delete attempt logs
    await supabase.from("attempt_logs").delete().in("problem_id", problemIds);
    // Delete problems
    await supabase.from("problems").delete().in("id", problemIds);
  }

  // Delete session
  const { error } = await supabase
    .from("study_sessions")
    .delete()
    .eq("id", sessionId);

  if (error) {
    console.error("Session delete error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

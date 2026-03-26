import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzePDF } from "@/lib/gemini";
import type { GeminiAnalysisResult } from "@/types";

export const maxDuration = 300; // 5 minutes (requires Vercel Pro)

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { filePath, title, selectedPageRanges } = await request.json();

  if (!filePath || !title) {
    return NextResponse.json({ error: "filePath and title are required" }, { status: 400 });
  }

  // Download from Supabase Storage (already uploaded by client)
  const { data: fileData, error: downloadError } = await supabase.storage
    .from("pdfs")
    .download(filePath);

  if (downloadError || !fileData) {
    return NextResponse.json({ error: "Failed to download PDF from storage" }, { status: 500 });
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());

  // Analyze with Gemini (only selected page ranges if provided)
  const base64 = buffer.toString("base64");
  let analysis: GeminiAnalysisResult;
  try {
    analysis = await analyzePDF(base64, selectedPageRanges);
  } catch (e) {
    console.error("analyzePDF error:", e);
    return NextResponse.json({ error: `PDF analysis failed: ${String(e)}` }, { status: 500 });
  }

  // Save document to DB (filePath already exists in storage)
  const { data: document, error: dbError } = await supabase
    .from("documents")
    .insert({
      user_id: user.id,
      title,
      file_path: filePath,
      analysis,
    })
    .select()
    .single();

  if (dbError) {
    console.error("DB insert error:", dbError);
    return NextResponse.json({ error: "Failed to save document" }, { status: 500 });
  }

  return NextResponse.json({ document, analysis });
}

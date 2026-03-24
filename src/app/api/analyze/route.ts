import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzePDF } from "@/lib/gemini";

export const maxDuration = 300; // 5 minutes (requires Vercel Pro)

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File;
  const title = formData.get("title") as string;
  const pageRangesRaw = formData.get("selectedPageRanges") as string | null;
  const selectedPageRanges: { start: number; end: number }[] | undefined = pageRangesRaw
    ? JSON.parse(pageRangesRaw)
    : undefined;

  if (!file || !title) {
    return NextResponse.json({ error: "File and title are required" }, { status: 400 });
  }

  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
  }

  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "File size must be under 50MB" }, { status: 400 });
  }

  // Upload to Supabase Storage
  const filePath = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await supabase.storage
    .from("pdfs")
    .upload(filePath, buffer, { contentType: "application/pdf" });

  if (uploadError) {
    console.error("Storage upload error:", uploadError);
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }

  // Analyze with Gemini (only selected page ranges if provided)
  const base64 = buffer.toString("base64");
  const analysis = await analyzePDF(base64, selectedPageRanges);

  // Save document to DB
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

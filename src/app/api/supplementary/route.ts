import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeSupplementaryPDF } from "@/lib/gemini";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File;
  const title = formData.get("title") as string;
  const documentId = formData.get("documentId") as string;
  const docType = (formData.get("docType") as string) || "other";

  if (!file || !documentId) {
    return NextResponse.json({ error: "file and documentId are required" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
  }

  const filePath = `${user.id}/supplementary/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await supabase.storage
    .from("pdfs")
    .upload(filePath, buffer, { contentType: "application/pdf" });

  if (uploadError) {
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }

  const { insights, problems } = await analyzeSupplementaryPDF(buffer.toString("base64"));
  const insightsWithType = { ...insights, doc_type: docType };

  const { data: doc, error: dbError } = await supabase
    .from("supplementary_documents")
    .insert({
      document_id: documentId,
      user_id: user.id,
      title: title || file.name.replace(".pdf", ""),
      file_path: filePath,
      insights: insightsWithType,
      problems,
    })
    .select()
    .single();

  if (dbError) {
    console.error("Supplementary DB insert error:", dbError);
    return NextResponse.json({ error: dbError.message ?? "Failed to save supplementary document" }, { status: 500 });
  }

  return NextResponse.json({ doc, insights, problemCount: problems.length });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const documentId = request.nextUrl.searchParams.get("documentId");
  if (!documentId) return NextResponse.json({ error: "documentId required" }, { status: 400 });

  const { data } = await supabase
    .from("supplementary_documents")
    .select("*")
    .eq("document_id", documentId)
    .eq("user_id", user.id)
    .order("created_at");

  return NextResponse.json({ docs: data ?? [] });
}

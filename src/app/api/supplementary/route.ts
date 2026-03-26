import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeSupplementaryPDF } from "@/lib/gemini";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { filePath, title, documentId, docType = "other" } = await request.json();

  if (!filePath || !documentId) {
    return NextResponse.json({ error: "filePath and documentId are required" }, { status: 400 });
  }

  // Download from Supabase Storage (already uploaded by client)
  const { data: fileData, error: downloadError } = await supabase.storage
    .from("pdfs")
    .download(filePath);

  if (downloadError || !fileData) {
    return NextResponse.json({ error: "Failed to download PDF from storage" }, { status: 500 });
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());
  const { insights, problems } = await analyzeSupplementaryPDF(buffer.toString("base64"));
  const insightsWithType = { ...insights, doc_type: docType };

  const { data: doc, error: dbError } = await supabase
    .from("supplementary_documents")
    .insert({
      document_id: documentId,
      user_id: user.id,
      title: title || (filePath.split("/").pop()?.replace(".pdf", "") ?? "Supplementary"),
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

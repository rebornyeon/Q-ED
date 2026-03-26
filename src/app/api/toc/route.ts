import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractTOC } from "@/lib/gemini";

export const maxDuration = 60;

const MAX_PAGES_TO_ANALYZE = 150;
const MAX_SELECTABLE_CHAPTERS = 5;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { filePath } = await request.json();
  if (!filePath) return NextResponse.json({ error: "filePath is required" }, { status: 400 });

  const { data: fileData, error: downloadError } = await supabase.storage.from("pdfs").download(filePath);
  if (downloadError || !fileData) return NextResponse.json({ error: "Failed to download PDF" }, { status: 500 });

  const buffer = Buffer.from(await fileData.arrayBuffer());
  const base64 = buffer.toString("base64");

  const { totalPages, chapters } = await extractTOC(base64);

  // Calculate max selectable chapters based on target page budget
  let maxSelectableChapters = MAX_SELECTABLE_CHAPTERS;
  if (chapters.length > 0) {
    const avgPagesPerChapter = totalPages / chapters.length;
    maxSelectableChapters = Math.min(
      MAX_SELECTABLE_CHAPTERS,
      Math.max(1, Math.floor(MAX_PAGES_TO_ANALYZE / avgPagesPerChapter))
    );
  }

  // Annotate chapters with page counts
  const annotatedChapters = chapters.map((c) => ({
    ...c,
    pageCount: Math.max(1, c.endPage - c.startPage + 1),
  }));

  return NextResponse.json({
    totalPages,
    chapters: annotatedChapters,
    maxSelectableChapters,
    needsSelection: totalPages > MAX_PAGES_TO_ANALYZE && chapters.length > 0,
  });
}

"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  filePath: string;
  initialPage?: number; // 1-based
  mode?: "page" | "full"; // page = single page view, full = full scrollable viewer
}

export function PDFPageViewer({ filePath, initialPage = 1, mode = "page" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfRef = useRef<any>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  // Load PDF once on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        // Get signed URL from Supabase (valid 5 min)
        const supabase = createClient();
        const { data, error: urlError } = await supabase.storage
          .from("pdfs")
          .createSignedUrl(filePath, 300);

        if (urlError || !data?.signedUrl) {
          setError("Failed to load PDF");
          return;
        }

        // Dynamically import pdfjs to avoid SSR issues
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const pdf = await pdfjsLib.getDocument({ url: data.signedUrl }).promise;
        if (cancelled) return;

        pdfRef.current = pdf;
        setTotalPages(pdf.numPages);
        setLoading(false);
      } catch {
        if (!cancelled) setError("Failed to load PDF");
      }
    }

    load();
    return () => { cancelled = true; };
  }, [filePath]);

  // Render page whenever currentPage or pdf changes
  useEffect(() => {
    if (!pdfRef.current || loading || error) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    async function render() {
      // Cancel any in-progress render
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      try {
        const page = await pdfRef.current.getPage(currentPage);
        if (cancelled) return;

        const container = canvas!.parentElement;
        const containerWidth = container?.clientWidth ?? 600;
        const viewport = page.getViewport({ scale: 1 });
        const scale = containerWidth / viewport.width;
        const scaled = page.getViewport({ scale });

        canvas!.width = scaled.width;
        canvas!.height = scaled.height;

        const ctx = canvas!.getContext("2d")!;
        const task = page.render({ canvasContext: ctx, viewport: scaled });
        renderTaskRef.current = task;
        await task.promise;
        if (!cancelled) renderTaskRef.current = null;
      } catch (e: unknown) {
        // RenderingCancelledException is expected when we cancel
        if (e instanceof Error && e.name !== "RenderingCancelledException" && !cancelled) {
          setError("Render failed");
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [currentPage, loading, error]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-destructive bg-destructive/5 rounded-lg border border-destructive/20">
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 bg-muted/30 rounded-lg">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Page navigation */}
      {(mode === "full" || totalPages > 1) && (
        <div className="flex items-center justify-between px-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Canvas */}
      <div className="rounded-lg overflow-hidden border border-border/40 bg-white">
        <canvas ref={canvasRef} className="w-full block" />
      </div>
    </div>
  );
}

// Convenience: open full PDF in new tab via signed URL
export function openPDFInNewTab(filePath: string) {
  const supabase = createClient();
  supabase.storage
    .from("pdfs")
    .createSignedUrl(filePath, 3600)
    .then(({ data }) => {
      if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    });
}

"use client";

import { useState, useRef } from "react";
import { Upload, Loader2, X, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SupplementaryDocument, SupplementaryDocType } from "@/types";

const DOC_TYPES: { value: SupplementaryDocType; label: string; color: string }[] = [
  { value: "past_exam",     label: "Past Exam",     color: "bg-red-500/15 text-red-600 border-red-500/30" },
  { value: "prof_notes",    label: "Prof Notes",    color: "bg-purple-500/15 text-purple-600 border-purple-500/30" },
  { value: "study_guide",   label: "Study Guide",   color: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  { value: "formula_sheet", label: "Formula Sheet", color: "bg-green-500/15 text-green-600 border-green-500/30" },
  { value: "other",         label: "Other",         color: "bg-muted text-muted-foreground border-border" },
];

function docTypeConfig(type: SupplementaryDocType | undefined) {
  return DOC_TYPES.find((d) => d.value === type) ?? DOC_TYPES[4];
}

interface Props {
  documentId: string;
  initialDocs?: SupplementaryDocument[];
  onDocsChange?: (docs: SupplementaryDocument[]) => void;
}

export function SupplementaryUpload({ documentId, initialDocs = [], onDocsChange }: Props) {
  const [docs, setDocs] = useState<SupplementaryDocument[]>(initialDocs);
  const [selectedType, setSelectedType] = useState<SupplementaryDocType>("past_exam");
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadElapsed, setUploadElapsed] = useState(0);
  const [uploadEstimate, setUploadEstimate] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function estimateSupplementarySecs(bytes: number) {
    const pages = Math.max(1, Math.round(bytes / 75000));
    const chunks = Math.ceil(pages / 8);
    const batches = Math.ceil(chunks / 3);
    return Math.max(30, batches * 45 + 20);
  }

  async function uploadFile(file: File) {
    if (file.type !== "application/pdf") {
      setError("Only PDF files are supported.");
      return;
    }
    setError(null);
    setUploading(file.name);
    const estimate = estimateSupplementarySecs(file.size);
    setUploadEstimate(estimate);
    setUploadElapsed(0);
    const start = Date.now();
    timerRef.current = setInterval(() => setUploadElapsed(Math.floor((Date.now() - start) / 1000)), 500);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("documentId", documentId);
    formData.append("title", file.name.replace(/\.pdf$/i, ""));
    formData.append("docType", selectedType);

    const res = await fetch("/api/supplementary", { method: "POST", body: formData });
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setUploadElapsed(0);
    setUploadEstimate(0);

    if (res.ok) {
      const data = await res.json();
      const next = [...docs, data.doc as SupplementaryDocument];
      setDocs(next);
      onDocsChange?.(next);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Upload failed. Please try again.");
    }
    setUploading(null);
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      await uploadFile(file);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  function removeDoc(id: string) {
    const next = docs.filter((d) => d.id !== id);
    setDocs(next);
    onDocsChange?.(next);
  }

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* Type picker */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Material type</p>
        <div className="flex flex-wrap gap-1.5">
          {DOC_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setSelectedType(t.value)}
              className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-all ${
                selectedType === t.value
                  ? `${t.color} ring-1 ring-offset-1 ring-current`
                  : "bg-muted/40 text-muted-foreground border-border/50 hover:border-border"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border border-dashed rounded-lg px-4 py-5 text-center cursor-pointer transition-colors select-none ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/40 hover:bg-muted/20"
        }`}
      >
        {uploading ? (
          <div className="space-y-1.5 py-1">
            <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Analyzing <span className="font-medium">{uploading}</span>...</span>
            </div>
            <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{uploadElapsed}초</span>
              <span>·</span>
              <span>{uploadElapsed < uploadEstimate ? `~${uploadEstimate - uploadElapsed}초 남음` : "마무리 중..."}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
            <Upload className="h-4 w-4" />
            <span>
              {dragOver
                ? "Drop PDF here"
                : `Upload as ${docTypeConfig(selectedType).label} — click or drop`}
            </span>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {/* Uploaded docs */}
      {docs.length > 0 && (
        <div className="space-y-2">
          {docs.map((doc) => {
            const cfg = docTypeConfig(doc.insights?.doc_type);
            return (
              <div key={doc.id} className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/50">
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-medium truncate flex-1">{doc.title}</p>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    {doc.problems?.length > 0 && (
                      <span className="text-xs text-primary font-semibold shrink-0">{doc.problems.length}q</span>
                    )}
                  </div>
                  {doc.insights?.summary && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{doc.insights.summary}</p>
                  )}
                  {doc.insights?.emphasized_topics?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {doc.insights.emphasized_topics.slice(0, 3).map((t, i) => (
                        <Badge key={i} variant="secondary" className="text-xs py-0">{t}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => removeDoc(doc.id)}
                  className="text-muted-foreground hover:text-foreground shrink-0 ml-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

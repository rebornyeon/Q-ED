"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Upload, FileText, CheckCircle2, AlertCircle,
  Flame, AlertTriangle, Trophy, Filter, Star, X, Plus, Clock,
} from "lucide-react";

// Estimate pages from file size (~75KB per page average)
function estimatePages(bytes: number) { return Math.max(1, Math.round(bytes / 75000)); }
// Estimate seconds per file: chunks ceil(pages/8) processed in groups of 3, ~25s per batch + overhead
function estimateSeconds(bytes: number) {
  const pages = estimatePages(bytes);
  const chunks = Math.ceil(pages / 8);
  const batches = Math.ceil(chunks / 3);
  return Math.max(15, batches * 25 + 10);
}

const PHASES = [
  "PDF 파일 업로드 중...",
  "페이지 분석 중...",
  "문제 추출 중...",
  "개념 정리 중...",
  "마무리 중...",
];
import type { Concept, SupplementaryDocument, GeminiAnalysisResult, SupplementaryDocType } from "@/types";
import { SupplementaryUpload } from "@/components/supplementary-upload";

type UploadStep = "idle" | "scanning" | "selecting" | "analyzing" | "done" | "error";

type FileEntry = { id: string; file: File; title: string };
type FileResult = { documentId: string; analysis: GeminiAnalysisResult };

type TOCChapter = { name: string; startPage: number; endPage: number; pageCount: number };
type FileTOCData = {
  fileId: string;
  totalPages: number;
  chapters: TOCChapter[];
  maxSelectableChapters: number;
  selectedIndices: Set<number>;
};

function mergeAnalyses(results: FileResult[]): { concepts: Concept[]; totalProblems: number } {
  const conceptMap = new Map<string, Concept>();
  let total = 0;
  for (const { analysis } of results) {
    for (const c of analysis.concepts ?? []) {
      const ex = conceptMap.get(c.name);
      if (ex) {
        ex.frequency = Math.min(5, ex.frequency + 1);
        ex.is_hot = ex.is_hot || c.is_hot;
        ex.is_trap = ex.is_trap || c.is_trap;
        ex.is_key = ex.is_key || c.is_key;
      } else {
        conceptMap.set(c.name, { ...c });
      }
    }
    total += analysis.problems?.length ?? 0;
  }
  return { concepts: Array.from(conceptMap.values()), totalProblems: total };
}

export default function UploadPage() {
  const t = useTranslations("upload");
  const locale = useLocale();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // File list state
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Processing state
  const [step, setStep] = useState<UploadStep>("idle");
  const [progress, setProgress] = useState(0);
  const [currentFileName, setCurrentFileName] = useState("");
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [estimatedSecs, setEstimatedSecs] = useState(0);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Real-time timer during analysis
  useEffect(() => {
    if (step === "analyzing") {
      startTimeRef.current = Date.now();
      setElapsed(0);
      setPhaseIndex(0);
      timerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setElapsed(s);
        // Advance phase every ~20% of estimated time
        const ratio = estimatedSecs > 0 ? s / estimatedSecs : 0;
        setPhaseIndex(Math.min(PHASES.length - 1, Math.floor(ratio * PHASES.length)));
        setProgress(Math.min(92, Math.round(ratio * 92)));
      }, 500);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (step === "done") { setProgress(100); }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [step, estimatedSecs]);

  // Results state
  const [fileResults, setFileResults] = useState<FileResult[]>([]);

  // Chapter selection state (for large PDFs)
  const [tocDataMap, setTocDataMap] = useState<Map<string, FileTOCData>>(new Map());

  // Concept + supplementary state
  const [selectedConcepts, setSelectedConcepts] = useState<Set<string>>(new Set());
  const [supplementaryDocs, setSupplementaryDocs] = useState<SupplementaryDocument[]>([]);
  const [includeSupplementary, setIncludeSupplementary] = useState(false);

  // Per-file error tracking
  const [fileErrors, setFileErrors] = useState<Map<string, string>>(new Map());

  // Session creation state
  const [startingStudy, setStartingStudy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // ── File management ──────────────────────────────────────────────
  function addFiles(newFiles: FileList | null) {
    if (!newFiles) return;
    const pdfs = Array.from(newFiles).filter((f) => f.type === "application/pdf");
    setFileEntries((prev) => [
      ...prev,
      ...pdfs
        .filter((f) => !prev.some((e) => e.file.name === f.name && e.file.size === f.size))
        .map((f) => ({ id: crypto.randomUUID(), file: f, title: f.name.replace(/\.pdf$/i, "") })),
    ]);
    setError(null);
  }

  function removeEntry(id: string) {
    setFileEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function updateTitle(id: string, title: string) {
    setFileEntries((prev) => prev.map((e) => (e.id === id ? { ...e, title } : e)));
  }

  // ── TOC scan then chapter selection (for large PDFs) ─────────────
  async function handleUpload() {
    if (fileEntries.length === 0) return;
    setError(null);
    setFileErrors(new Map());

    // Scan TOC for each file to check if chapter selection is needed
    setStep("scanning");
    const tocResults = await Promise.all(
      fileEntries.map(async (entry) => {
        const fd = new FormData();
        fd.append("file", entry.file);
        try {
          const res = await fetch("/api/toc", { method: "POST", body: fd });
          if (res.ok) return { fileId: entry.id, ...(await res.json()) };
        } catch { /* ignore, proceed without TOC */ }
        return null;
      })
    );

    // Build TOC map for files that need chapter selection
    const newTocMap = new Map<string, FileTOCData>();
    let anyNeedsSelection = false;
    for (const toc of tocResults) {
      if (toc && toc.needsSelection) {
        newTocMap.set(toc.fileId, {
          fileId: toc.fileId,
          totalPages: toc.totalPages,
          chapters: toc.chapters,
          maxSelectableChapters: toc.maxSelectableChapters,
          selectedIndices: new Set(),
        });
        anyNeedsSelection = true;
      }
    }

    if (anyNeedsSelection) {
      setTocDataMap(newTocMap);
      setStep("selecting");
    } else {
      // No large PDFs — go straight to analysis
      await runAnalysis(new Map());
    }
  }

  // ── Analysis (called after chapter selection or directly) ─────────
  async function runAnalysis(tocMap: Map<string, FileTOCData>) {
    setEstimatedSecs(fileEntries.reduce((s, e) => s + estimateSeconds(e.file.size), 0));
    setStep("analyzing");
    const results: FileResult[] = [];
    const errors = new Map<string, string>();

    for (let i = 0; i < fileEntries.length; i++) {
      const entry = fileEntries[i];
      setCurrentFileIndex(i + 1);
      setCurrentFileName(entry.file.name);

      const formData = new FormData();
      formData.append("file", entry.file);
      formData.append("title", entry.title.trim() || entry.file.name.replace(/\.pdf$/i, ""));

      // Attach selected page ranges if chapter selection was done for this file
      const tocData = tocMap.get(entry.id);
      if (tocData && tocData.selectedIndices.size > 0) {
        const ranges = Array.from(tocData.selectedIndices)
          .map((idx) => ({ start: tocData.chapters[idx].startPage, end: tocData.chapters[idx].endPage }));
        formData.append("selectedPageRanges", JSON.stringify(ranges));
      }

      try {
        const res = await fetch("/api/analyze", { method: "POST", body: formData });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          errors.set(entry.id, data.error ?? "분석 실패");
        } else {
          const data = await res.json();
          results.push({ documentId: data.document.id, analysis: data.analysis });
        }
      } catch {
        errors.set(entry.id, "네트워크 오류");
      }
    }

    setFileErrors(errors);
    setFileResults(results);
    setProgress(100);

    if (results.length === 0) {
      setStep("error");
      setError("모든 PDF 분석에 실패했습니다.");
    } else {
      setStep("done");
    }
  }

  // ── Chapter selection helpers ─────────────────────────────────────
  function toggleChapter(fileId: string, chapterIdx: number) {
    setTocDataMap((prev) => {
      const next = new Map(prev);
      const data = next.get(fileId);
      if (!data) return prev;
      const sel = new Set(data.selectedIndices);
      if (sel.has(chapterIdx)) {
        sel.delete(chapterIdx);
      } else if (sel.size < data.maxSelectableChapters) {
        sel.add(chapterIdx);
      }
      next.set(fileId, { ...data, selectedIndices: sel });
      return next;
    });
  }

  function allChaptersSelected() {
    for (const data of tocDataMap.values()) {
      if (data.selectedIndices.size === 0) return false;
    }
    return tocDataMap.size > 0;
  }

  // ── Concept helpers ───────────────────────────────────────────────
  function toggleConcept(name: string) {
    setSelectedConcepts((prev) => {
      const next = new Set(prev);
      if (next.has(name)) { next.delete(name); } else { next.add(name); }
      return next;
    });
  }

  const { concepts, totalProblems } = mergeAnalyses(fileResults);

  function selectAll() {
    setSelectedConcepts(new Set(concepts.map((c) => c.name)));
  }

  // ── Start study ───────────────────────────────────────────────────
  async function handleStartStudy() {
    const documentIds = fileResults.map((r) => r.documentId);
    if (documentIds.length === 0) return;
    setStartingStudy(true);
    setStartError(null);

    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds,
          // If all concepts selected, treat as no filter (avoids excluding problems with empty concepts)
          conceptFilter: selectedConcepts.size > 0 && selectedConcepts.size < concepts.length
            ? Array.from(selectedConcepts)
            : null,
          includeSupplementary,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStartError(data.error ?? `Server error (${res.status}) — check console for details`);
        return;
      }

      const data = await res.json();
      router.push(`/${locale}/study/${data.session.id}`);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Network error — could not reach server");
    } finally {
      setStartingStudy(false);
    }
  }

  const primaryDocumentId = fileResults[0]?.documentId ?? null;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-black tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>

        {/* ── IDLE / ERROR ── */}
        {(step === "idle" || step === "error") && (
          <div className="space-y-6">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />

            {/* Drop zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors select-none ${
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
              }`}
            >
              <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">{dragOver ? t("dropzoneActive") : t("dropzone")}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t("maxSize")} · Multiple PDFs supported
              </p>
            </div>

            {/* File list */}
            {fileEntries.length > 0 && (
              <div className="space-y-2">
                {fileEntries.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20">
                    <FileText className="h-5 w-5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0 grid grid-cols-2 gap-2 items-center">
                      <p className="text-sm text-muted-foreground truncate">{entry.file.name}</p>
                      <Input
                        value={entry.title}
                        onChange={(e) => updateTitle(entry.id, e.target.value)}
                        placeholder="Title"
                        className="h-7 text-sm"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="secondary" className="text-xs">
                        {(entry.file.size / 1024 / 1024).toFixed(1)} MB
                      </Badge>
                      <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        ~{estimateSeconds(entry.file.size)}초
                      </Badge>
                    </div>
                    <button onClick={() => removeEntry(entry.id)} className="text-muted-foreground hover:text-destructive shrink-0">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}

                {/* Add more */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus className="h-4 w-4" /> Add more PDFs
                </button>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" /> {error}
              </div>
            )}

            <Button
              className="w-full"
              size="lg"
              onClick={handleUpload}
              disabled={fileEntries.length === 0 || fileEntries.some((e) => !e.title.trim())}
            >
              {t("analyzeButton")} {fileEntries.length > 1 ? `(${fileEntries.length} PDFs)` : ""}
            </Button>
          </div>
        )}

        {/* ── SCANNING (quick TOC scan) ── */}
        {step === "scanning" && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center space-y-5">
              <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
              <div>
                <p className="font-bold text-lg">Scanning table of contents...</p>
                <p className="text-sm text-muted-foreground mt-1">Detecting chapter structure (~5–10 seconds)</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── CHAPTER SELECTION ── */}
        {step === "selecting" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold">Select chapters to study</h2>
              <p className="text-sm text-muted-foreground mt-1">
                This textbook is large. Select the chapters you want to analyze to stay within the ~150-page analysis budget.
              </p>
            </div>
            {Array.from(tocDataMap.values()).map((data) => {
              const entry = fileEntries.find((e) => e.id === data.fileId);
              return (
                <Card key={data.fileId}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{entry?.title || entry?.file.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {data.totalPages} pages total · Select up to <span className="font-semibold text-foreground">{data.maxSelectableChapters}</span> chapter{data.maxSelectableChapters > 1 ? "s" : ""}
                      {" "}· {data.selectedIndices.size}/{data.maxSelectableChapters} selected
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {data.chapters.map((ch, idx) => {
                      const isSelected = data.selectedIndices.has(idx);
                      const isDisabled = !isSelected && data.selectedIndices.size >= data.maxSelectableChapters;
                      return (
                        <button
                          key={idx}
                          onClick={() => toggleChapter(data.fileId, idx)}
                          disabled={isDisabled}
                          className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-all ${
                            isSelected
                              ? "bg-primary text-primary-foreground border-primary"
                              : isDisabled
                              ? "opacity-40 cursor-not-allowed bg-muted/20 border-border/30 text-muted-foreground"
                              : "bg-muted/30 border-border/50 hover:border-primary/50 text-foreground"
                          }`}
                        >
                          <span className="font-medium truncate mr-2">{ch.name}</span>
                          <span className="text-xs shrink-0 opacity-70">{ch.pageCount} pp.</span>
                        </button>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
            <Button
              className="w-full"
              size="lg"
              onClick={() => runAnalysis(tocDataMap)}
              disabled={!allChaptersSelected()}
            >
              Analyze selected chapters
            </Button>
            <p className="text-xs text-center text-muted-foreground -mt-3">
              Each selected chapter will be fully analyzed for problems and concepts.
            </p>
          </div>
        )}

        {/* ── ANALYZING ── */}
        {step === "analyzing" && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center space-y-5">
              <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
              <div>
                <p className="font-bold text-lg">{t("analyzing")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {fileEntries.length > 1 ? `${currentFileIndex}/${fileEntries.length} — ${currentFileName}` : currentFileName || fileEntries[0]?.file.name}
                </p>
              </div>
              <Progress value={progress} className="max-w-sm mx-auto h-2" />
              {/* Phase + timer */}
              <div className="space-y-1">
                <p className="text-sm font-medium text-primary animate-pulse">{PHASES[phaseIndex]}</p>
                <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    경과: {elapsed}초
                  </span>
                  <span>·</span>
                  <span>
                    {elapsed < estimatedSecs
                      ? `예상: ~${estimatedSecs - elapsed}초 남음`
                      : "예상보다 오래 걸리고 있어요..."}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── DONE ── */}
        {step === "done" && fileResults.length > 0 && (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-green-600">
                <CheckCircle2 className="h-6 w-6" />
                <span className="font-bold text-lg">
                  {fileResults.length}/{fileEntries.length} PDF{fileEntries.length > 1 ? "s" : ""} analyzed — {t("uploadSuccess")}
                </span>
              </div>
              {fileErrors.size > 0 && (
                <div className="space-y-1 pl-1">
                  {fileEntries.filter((e) => fileErrors.has(e.id)).map((entry) => (
                    <div key={entry.id} className="flex items-center gap-2 text-sm text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span className="font-medium truncate">{entry.file.name}</span>
                      <span className="text-xs opacity-75 shrink-0">— {fileErrors.get(entry.id)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Concept selection */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Filter className="h-4 w-4" />
                      학습할 개념 선택
                    </CardTitle>
                    <CardDescription>
                      총 {totalProblems}개 문제 · {concepts.length}개 개념 — 클릭해서 원하는 개념만 선택하세요
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={selectAll} className="text-xs shrink-0">
                    전체 선택
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {(() => {
                  // Build per-type emphasis maps from supplementary docs
                  const TYPE_PRIORITY: SupplementaryDocType[] = ["past_exam", "prof_notes", "study_guide", "formula_sheet", "other"];
                  const docTypeEmphasis = new Map<SupplementaryDocType, Set<string>>();
                  for (const doc of supplementaryDocs) {
                    const type = (doc.insights?.doc_type ?? "other") as SupplementaryDocType;
                    if (!docTypeEmphasis.has(type)) docTypeEmphasis.set(type, new Set());
                    for (const topic of doc.insights?.emphasized_topics ?? []) {
                      docTypeEmphasis.get(type)!.add(topic.toLowerCase());
                    }
                  }

                  function getEmphasisType(name: string): SupplementaryDocType | null {
                    for (const type of TYPE_PRIORITY) {
                      const topics = docTypeEmphasis.get(type);
                      if (topics?.size && [...topics].some((e) => name.toLowerCase().includes(e) || e.includes(name.toLowerCase()))) {
                        return type;
                      }
                    }
                    return null;
                  }

                  const emphasisStyle: Record<SupplementaryDocType, { badge: string; icon: string; label: string }> = {
                    past_exam:     { badge: "bg-amber-500/10 border-amber-500/50 hover:border-amber-500",   icon: "text-amber-500",  label: "Past Exam 출제 예상" },
                    prof_notes:    { badge: "bg-purple-500/10 border-purple-500/50 hover:border-purple-500", icon: "text-purple-500", label: "교수 노트 강조" },
                    study_guide:   { badge: "bg-blue-500/10 border-blue-500/50 hover:border-blue-500",       icon: "text-blue-500",   label: "스터디 가이드 중심" },
                    formula_sheet: { badge: "bg-green-500/10 border-green-500/50 hover:border-green-500",    icon: "text-green-500",  label: "공식 중점" },
                    other:         { badge: "bg-muted border-border/60 hover:border-border",                 icon: "text-muted-foreground", label: "보충자료 강조" },
                  };

                  const sorted = [...concepts].sort((a, b) => {
                    const aE = getEmphasisType(a.name) ? 1 : 0;
                    const bE = getEmphasisType(b.name) ? 1 : 0;
                    return bE - aE || b.frequency - a.frequency;
                  });

                  // Which types are actually present (have emphasized topics)
                  const presentTypes = TYPE_PRIORITY.filter((t) => (docTypeEmphasis.get(t)?.size ?? 0) > 0);

                  return (
                    <>
                    <div className="flex flex-wrap gap-2">
                      {sorted.map((concept: Concept, i: number) => {
                        const selected = selectedConcepts.has(concept.name);
                        const emphType = getEmphasisType(concept.name);
                        const style = emphType ? emphasisStyle[emphType] : null;
                        return (
                          <button
                            key={i}
                            onClick={() => toggleConcept(concept.name)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                              selected
                                ? "bg-primary text-primary-foreground border-primary"
                                : style
                                ? `${style.badge} text-foreground`
                                : "bg-background border-border text-muted-foreground hover:border-primary/50"
                            }`}
                          >
                            {style && <Star className={`h-3 w-3 ${style.icon}`} />}
                            {concept.is_hot && <Flame className="h-3 w-3" />}
                            {concept.is_trap && <AlertTriangle className="h-3 w-3" />}
                            {concept.is_key && <Trophy className="h-3 w-3" />}
                            {concept.name}
                            <span className="opacity-60">×{concept.frequency}</span>
                          </button>
                        );
                      })}
                    </div>

                <div className="flex gap-4 text-xs text-muted-foreground pt-2 border-t border-border/40 flex-wrap">
                  {presentTypes.map((type) => (
                    <span key={type} className={`flex items-center gap-1 ${emphasisStyle[type].icon}`}>
                      <Star className="h-3 w-3" /> {emphasisStyle[type].label}
                    </span>
                  ))}
                  <span className="flex items-center gap-1"><Flame className="h-3 w-3" /> 자주 출제</span>
                  <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-destructive" /> 자주 틀림</span>
                  <span className="flex items-center gap-1"><Trophy className="h-3 w-3" /> 고득점 핵심</span>
                </div>
                    </>
                  );
                })()}

                {selectedConcepts.size > 0 && (
                  <p className="text-xs text-primary font-medium">{selectedConcepts.size}개 개념 선택됨</p>
                )}
              </CardContent>
            </Card>

            {/* Supplementary materials */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Supplementary Materials</CardTitle>
                <CardDescription className="text-xs">
                  Optional — add past exams, professor notes, or study guides. Gemini will use them to make Cues more exam-targeted.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {primaryDocumentId && (
                  <SupplementaryUpload
                    documentId={primaryDocumentId}
                    onDocsChange={setSupplementaryDocs}
                  />
                )}
                {supplementaryDocs.some((d) => d.problems?.length > 0) && (
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeSupplementary}
                      onChange={(e) => setIncludeSupplementary(e.target.checked)}
                      className="accent-primary h-4 w-4"
                    />
                    <span className="text-sm font-medium">Include questions from supplementary materials</span>
                    <span className="text-xs text-muted-foreground">
                      ({supplementaryDocs.reduce((s, d) => s + (d.problems?.length ?? 0), 0)} questions)
                    </span>
                  </label>
                )}
              </CardContent>
            </Card>

            <Button
              className="w-full"
              size="lg"
              onClick={handleStartStudy}
              disabled={startingStudy}
            >
              {startingStudy
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />세션 준비 중... (잠시 기다려주세요)</>
                : <>🚀 {selectedConcepts.size > 0 ? `선택한 ${selectedConcepts.size}개 개념으로 학습 시작` : "전체 학습 시작"}</>
              }
            </Button>

            {startingStudy && (
              <div className="text-center space-y-1">
                <p className="text-xs text-muted-foreground animate-pulse">
                  문제를 구성하고 Cue를 생성하는 중입니다 — 보통 10~30초 소요됩니다
                </p>
                <Progress value={null} className="h-1 max-w-xs mx-auto opacity-50" />
              </div>
            )}

            {startError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">학습 시작 실패</p>
                  <p className="text-xs mt-0.5 opacity-80">{startError}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

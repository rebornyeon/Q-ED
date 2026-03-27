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
  Flame, AlertTriangle, Trophy, Filter, Star, X, Plus, Clock, BookOpen, GraduationCap, ClipboardList,
  Sparkles, ArrowRight, ChevronDown,
} from "lucide-react";

function estimatePages(bytes: number) { return Math.max(1, Math.round(bytes / 75000)); }
function estimateSeconds(bytes: number) {
  const pages = estimatePages(bytes);
  const chunks = Math.ceil(pages / 8);
  const batches = Math.ceil(chunks / 3);
  return Math.max(30, batches * 45 + 20);
}

const PHASES = [
  "Uploading PDF files...",
  "Scanning pages...",
  "Extracting problems...",
  "Organizing concepts...",
  "Finishing up...",
];

import type { Concept, SupplementaryDocument, GeminiAnalysisResult, SupplementaryDocType } from "@/types";
import { createClient } from "@/lib/supabase/client";

type UploadStep = "idle" | "scanning" | "selecting" | "analyzing" | "done" | "error";
type FileEntry = { id: string; file: File; title: string };
type ExamPrepEntry = FileEntry & { docType: SupplementaryDocType };
type FileResult = { documentId: string; analysis: GeminiAnalysisResult };
type TOCChapter = { name: string; startPage: number; endPage: number; pageCount: number };
type FileTOCData = {
  fileId: string; totalPages: number; chapters: TOCChapter[];
  maxSelectablePages: number; selectedIndices: Set<number>;
};

const EXAM_PREP_TYPES: { value: SupplementaryDocType; label: string; color: string }[] = [
  { value: "past_exam",     label: "Past Exam",     color: "bg-red-500/15 text-red-600 border-red-500/30" },
  { value: "prof_notes",    label: "Prof Notes",    color: "bg-purple-500/15 text-purple-600 border-purple-500/30" },
  { value: "study_guide",   label: "Study Guide",   color: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  { value: "formula_sheet", label: "Formula Sheet", color: "bg-green-500/15 text-green-600 border-green-500/30" },
  { value: "other",         label: "Other",         color: "bg-muted text-muted-foreground border-border" },
];

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

// Reusable drop zone for a section
function FileDropSection({
  sectionRef, entries, onAdd, onRemove, onTitleChange, placeholder,
}: {
  sectionRef: React.RefObject<HTMLInputElement | null>;
  entries: FileEntry[];
  onAdd: (files: FileList | null) => void;
  onRemove: (id: string) => void;
  onTitleChange: (id: string, title: string) => void;
  placeholder?: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div className="space-y-2">
      <input ref={sectionRef} type="file" accept=".pdf,application/pdf" multiple className="hidden"
        onChange={(e) => onAdd(e.target.files)} />
      <div
        onClick={() => sectionRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onAdd(e.dataTransfer.files); }}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors select-none ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/20"
        }`}
      >
        <Upload className="h-7 w-7 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm font-medium">{dragOver ? "Drop here" : placeholder ?? "Click or drop PDFs"}</p>
      </div>
      {entries.length > 0 && (
        <div className="space-y-1.5">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-muted/20">
              <FileText className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0 grid grid-cols-2 gap-2 items-center">
                <p className="text-xs text-muted-foreground truncate">{e.file.name}</p>
                <Input value={e.title} onChange={(ev) => onTitleChange(e.id, ev.target.value)}
                  placeholder="Title" className="h-6 text-xs" />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Badge variant="secondary" className="text-xs">{(e.file.size / 1024 / 1024).toFixed(1)} MB</Badge>
                <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
                  <Clock className="h-2.5 w-2.5" />~{estimateSeconds(e.file.size)}s
                </Badge>
              </div>
              <button onClick={() => onRemove(e.id)} className="text-muted-foreground hover:text-destructive shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button onClick={() => sectionRef.current?.click()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Plus className="h-3.5 w-3.5" /> Add more
          </button>
        </div>
      )}
    </div>
  );
}

export default function UploadPage() {
  const t = useTranslations("upload");
  const locale = useLocale();
  const router = useRouter();

  const lectureRef = useRef<HTMLInputElement | null>(null);
  const textbookRef = useRef<HTMLInputElement | null>(null);
  const examPrepRef = useRef<HTMLInputElement | null>(null);

  const [lectureEntries, setLectureEntries] = useState<FileEntry[]>([]);
  const [textbookEntries, setTextbookEntries] = useState<FileEntry[]>([]);
  const [examPrepEntries, setExamPrepEntries] = useState<ExamPrepEntry[]>([]);
  const [examPrepDocType, setExamPrepDocType] = useState<SupplementaryDocType>("past_exam");

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

  useEffect(() => {
    if (step === "analyzing") {
      startTimeRef.current = Date.now();
      setElapsed(0); setPhaseIndex(0);
      timerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setElapsed(s);
        const ratio = estimatedSecs > 0 ? s / estimatedSecs : 0;
        setPhaseIndex(Math.min(PHASES.length - 1, Math.floor(ratio * PHASES.length)));
        setProgress(Math.min(92, Math.round(ratio * 92)));
      }, 500);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (step === "done") setProgress(100);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [step, estimatedSecs]);

  const [fileResults, setFileResults] = useState<FileResult[]>([]);
  const [supplementaryDocs, setSupplementaryDocs] = useState<SupplementaryDocument[]>([]);
  const [fileErrors, setFileErrors] = useState<Map<string, string>>(new Map());
  const [tocDataMap, setTocDataMap] = useState<Map<string, FileTOCData>>(new Map());
  const [uploadedPaths, setUploadedPaths] = useState<Map<string, string>>(new Map());

  const [selectedConcepts, setSelectedConcepts] = useState<Set<string>>(new Set());
  const [includeSupplementary, setIncludeSupplementary] = useState(false);
  const [isProofBased, setIsProofBased] = useState(false);
  const [textbookOpen, setTextbookOpen] = useState(false);
  const [examPrepOpen, setExamPrepOpen] = useState(false);
  const [startingStudy, setStartingStudy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // ── File management helpers ───────────────────────────────────────
  function makeAdder<T extends FileEntry>(
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    extra?: (f: File) => Partial<T>
  ) {
    return (files: FileList | null) => {
      if (!files) return;
      const pdfs = Array.from(files).filter((f) => f.type === "application/pdf");
      setter((prev) => [
        ...prev,
        ...pdfs
          .filter((f) => !prev.some((e) => e.file.name === f.name && e.file.size === f.size))
          .map((f) => ({
            id: crypto.randomUUID(), file: f,
            title: f.name.replace(/\.pdf$/i, ""),
            ...(extra?.(f) ?? {}),
          } as T)),
      ]);
      setError(null);
    };
  }

  const addLectureFiles = makeAdder(setLectureEntries);
  const addTextbookFiles = makeAdder(setTextbookEntries);
  const addExamPrepFiles = makeAdder<ExamPrepEntry>(setExamPrepEntries, () => ({ docType: examPrepDocType }));

  function makeTitleUpdater<T extends FileEntry>(setter: React.Dispatch<React.SetStateAction<T[]>>) {
    return (id: string, title: string) => setter((prev) => prev.map((e) => e.id === id ? { ...e, title } : e));
  }

  // ── Main upload + analysis flow ───────────────────────────────────
  async function handleUpload() {
    if (lectureEntries.length === 0) return;
    setError(null); setFileErrors(new Map());
    setStep("scanning");

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Please sign in."); setStep("error"); return; }

    // Upload all files to storage
    const allEntries = [
      ...lectureEntries.map((e) => ({ ...e, section: "lecture" as const })),
      ...textbookEntries.map((e) => ({ ...e, section: "textbook" as const })),
      ...examPrepEntries.map((e) => ({ ...e, section: "exam_prep" as const })),
    ];
    const paths = new Map<string, string>();
    await Promise.all(allEntries.map(async (entry) => {
      const filePath = `${user.id}/${Date.now()}-${entry.file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error } = await supabase.storage.from("pdfs").upload(filePath, entry.file, { contentType: "application/pdf" });
      if (!error) paths.set(entry.id, filePath);
    }));

    // TOC scan for lecture entries only
    const tocResults = await Promise.all(
      lectureEntries.map(async (entry) => {
        const filePath = paths.get(entry.id);
        if (!filePath) return null;
        try {
          const res = await fetch("/api/toc", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filePath }),
          });
          if (res.ok) return { fileId: entry.id, ...(await res.json()) };
        } catch { /* ignore */ }
        return null;
      })
    );

    const newTocMap = new Map<string, FileTOCData>();
    let anyNeedsSelection = false;
    for (const toc of tocResults) {
      if (toc?.needsSelection) {
        newTocMap.set(toc.fileId, {
          fileId: toc.fileId, totalPages: toc.totalPages, chapters: toc.chapters,
          maxSelectablePages: toc.maxSelectablePages, selectedIndices: new Set(),
        });
        anyNeedsSelection = true;
      }
    }

    setUploadedPaths(paths);
    if (anyNeedsSelection) {
      setTocDataMap(newTocMap); setStep("selecting");
    } else {
      await runAnalysis(new Map(), paths, textbookEntries, examPrepEntries);
    }
  }

  async function runAnalysis(
    tocMap: Map<string, FileTOCData>,
    paths: Map<string, string>,
    tbEntries: FileEntry[],
    epEntries: ExamPrepEntry[],
  ) {
    setEstimatedSecs(lectureEntries.reduce((s, e) => s + estimateSeconds(e.file.size), 0));
    setStep("analyzing");
    const results: FileResult[] = [];
    const errors = new Map<string, string>();

    // 1. Analyze lecture entries (primary)
    for (let i = 0; i < lectureEntries.length; i++) {
      const entry = lectureEntries[i];
      setCurrentFileIndex(i + 1); setCurrentFileName(entry.file.name);
      const filePath = paths.get(entry.id);
      if (!filePath) { errors.set(entry.id, "Upload failed"); continue; }
      const tocData = tocMap.get(entry.id);
      const selectedPageRanges = tocData && tocData.selectedIndices.size > 0
        ? Array.from(tocData.selectedIndices).map((idx) => ({
            start: tocData.chapters[idx].startPage, end: tocData.chapters[idx].endPage,
          }))
        : undefined;
      try {
        const res = await fetch("/api/analyze", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath, title: entry.title.trim() || entry.file.name.replace(/\.pdf$/i, ""), selectedPageRanges, isProofBased }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          errors.set(entry.id, data.error ?? "Analysis failed");
        } else {
          const data = await res.json();
          results.push({ documentId: data.document.id, analysis: data.analysis });
        }
      } catch { errors.set(entry.id, "Network error"); }
    }

    setFileErrors(errors);
    setFileResults(results);

    // 2. Process textbook + exam prep as supplementary (needs documentId)
    const primaryDocId = results[0]?.documentId;
    const suppDocs: SupplementaryDocument[] = [];
    if (primaryDocId) {
      const suppEntries = [
        ...tbEntries.map((e) => ({ ...e, docType: "textbook" as SupplementaryDocType })),
        ...epEntries,
      ];
      for (const entry of suppEntries) {
        const filePath = paths.get(entry.id);
        if (!filePath) continue;
        try {
          const res = await fetch("/api/supplementary", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filePath, documentId: primaryDocId, title: entry.title, docType: entry.docType }),
          });
          if (res.ok) { const data = await res.json(); suppDocs.push(data.doc); }
        } catch { /* ignore supplementary failures */ }
      }
    }
    setSupplementaryDocs(suppDocs);
    setProgress(100);

    if (results.length === 0) {
      setStep("error"); setError("All PDFs failed to analyze.");
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
      if (sel.has(chapterIdx)) { sel.delete(chapterIdx); }
      else {
        const selectedPages = Array.from(sel).reduce((sum, i) => sum + data.chapters[i].pageCount, 0);
        if (selectedPages + data.chapters[chapterIdx].pageCount <= data.maxSelectablePages) sel.add(chapterIdx);
      }
      next.set(fileId, { ...data, selectedIndices: sel });
      return next;
    });
  }

  function allChaptersSelected() {
    for (const data of tocDataMap.values()) if (data.selectedIndices.size === 0) return false;
    return tocDataMap.size > 0;
  }

  // ── Concept helpers ───────────────────────────────────────────────
  function toggleConcept(name: string) {
    setSelectedConcepts((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }
  const { concepts, totalProblems } = mergeAnalyses(fileResults);
  function selectAll() { setSelectedConcepts(new Set(concepts.map((c) => c.name))); }

  // ── Start study ───────────────────────────────────────────────────
  async function handleStartStudy() {
    const documentIds = fileResults.map((r) => r.documentId);
    if (documentIds.length === 0) return;
    setStartingStudy(true); setStartError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds,
          conceptFilter: selectedConcepts.size > 0 && selectedConcepts.size < concepts.length
            ? Array.from(selectedConcepts) : null,
          includeSupplementary,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStartError(data.error ?? `Server error (${res.status})`);
        return;
      }
      const data = await res.json();
      router.push(`/${locale}/study/${data.session.id}`);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Network error");
    } finally { setStartingStudy(false); }
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-black tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>

        {/* ── HOW IT WORKS ── */}
        <div className="mb-8 rounded-xl border border-border/60 bg-muted/30 p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">How it works</p>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {/* Step 1 */}
            <div className="flex-1 flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs">1</div>
              <div>
                <p className="text-sm font-semibold flex items-center gap-1.5"><Upload className="h-3.5 w-3.5 text-primary" /> Upload PDFs</p>
                <p className="text-xs text-muted-foreground mt-0.5">Drop lecture notes, homework, textbook chapters, or past exams. Add titles and pick a type for each file.</p>
              </div>
            </div>
            <ArrowRight className="hidden sm:block h-4 w-4 shrink-0 text-muted-foreground/40" />
            {/* Step 2 */}
            <div className="flex-1 flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 font-bold text-xs">2</div>
              <div>
                <p className="text-sm font-semibold flex items-center gap-1.5"><Filter className="h-3.5 w-3.5 text-amber-500" /> Select chapters</p>
                <p className="text-xs text-muted-foreground mt-0.5">For large PDFs, the table of contents is auto-detected. Pick only the chapters relevant to your exam — skip the rest.</p>
              </div>
            </div>
            <ArrowRight className="hidden sm:block h-4 w-4 shrink-0 text-muted-foreground/40" />
            {/* Step 3 */}
            <div className="flex-1 flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 font-bold text-xs">3</div>
              <div>
                <p className="text-sm font-semibold flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-emerald-500" /> AI analysis</p>
                <p className="text-xs text-muted-foreground mt-0.5">Gemini scans every page and extracts problems, concepts, and theorems — ranked by exam likelihood. Takes ~1–3 min.</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── IDLE / ERROR ── */}
        {(step === "idle" || step === "error") && (
          <div className="space-y-4">
            {/* Section 1: Lecture Notes & Homework */}
            <Card className="border-primary/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <GraduationCap className="h-4 w-4 text-primary" />
                  Lecture Notes & Homework
                  <Badge className="ml-auto text-xs">Required</Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Problems are extracted from this for active drilling. Upload lecture slides, handouts, or homework sets — anything with problems you need to solve for the exam.
                </CardDescription>
                <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isProofBased}
                    onChange={(e) => setIsProofBased(e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <span className="text-xs text-muted-foreground">
                    Proof-based course — optimizes cues for proof structure (Proof Goal → Technique → Outline → Key Step → Full Proof)
                  </span>
                </label>
              </CardHeader>
              <CardContent>
                <FileDropSection
                  sectionRef={lectureRef}
                  entries={lectureEntries}
                  onAdd={makeAdder(setLectureEntries)}
                  onRemove={(id) => setLectureEntries((p) => p.filter((e) => e.id !== id))}
                  onTitleChange={makeTitleUpdater(setLectureEntries)}
                  placeholder="Drop lecture notes or homework PDFs here"
                />
              </CardContent>
            </Card>

            {/* Section 2: Textbook */}
            <Card>
              <CardHeader className="pb-3 cursor-pointer select-none" onClick={() => setTextbookOpen((o) => !o)}>
                <CardTitle className="text-base flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  Textbook
                  {textbookEntries.length > 0 && (
                    <Badge variant="secondary" className="text-xs">{textbookEntries.length} file{textbookEntries.length > 1 ? "s" : ""}</Badge>
                  )}
                  <Badge variant="outline" className="ml-auto text-xs">Optional</Badge>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${textbookOpen ? "rotate-180" : ""}`} />
                </CardTitle>
                {!textbookOpen && (
                  <CardDescription className="text-xs">
                    Theorems &amp; definitions extracted as reference. Pull problems into your session on demand.
                  </CardDescription>
                )}
              </CardHeader>
              {textbookOpen && (
                <CardContent className="space-y-3 pt-0">
                  <p className="text-xs text-muted-foreground">
                    Theorems, definitions, and worked examples are extracted as a reference base. During study, you can pull textbook problems into your session on demand. Upload the relevant chapters — the full book isn&apos;t needed.
                  </p>
                  <FileDropSection
                    sectionRef={textbookRef}
                    entries={textbookEntries}
                    onAdd={makeAdder(setTextbookEntries)}
                    onRemove={(id) => setTextbookEntries((p) => p.filter((e) => e.id !== id))}
                    onTitleChange={makeTitleUpdater(setTextbookEntries)}
                    placeholder="Drop textbook PDF here"
                  />
                </CardContent>
              )}
            </Card>

            {/* Section 3: Exam Prep */}
            <Card>
              <CardHeader className="pb-3 cursor-pointer select-none" onClick={() => setExamPrepOpen((o) => !o)}>
                <CardTitle className="text-base flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  Exam Prep
                  {examPrepEntries.length > 0 && (
                    <Badge variant="secondary" className="text-xs">{examPrepEntries.length} file{examPrepEntries.length > 1 ? "s" : ""}</Badge>
                  )}
                  <Badge variant="outline" className="ml-auto text-xs">Optional</Badge>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${examPrepOpen ? "rotate-180" : ""}`} />
                </CardTitle>
                {!examPrepOpen && (
                  <CardDescription className="text-xs">
                    Past exams, prof notes, study guides — calibrates which concepts get emphasized in cues.
                  </CardDescription>
                )}
              </CardHeader>
              {examPrepOpen && (
              <CardContent className="space-y-3 pt-0">
                <p className="text-xs text-muted-foreground">
                  Used to calibrate which concepts are emphasized and how cues are weighted. Past exams show what the professor actually tests; prof notes and study guides reveal what to prioritize. The more context, the sharper the hints.
                </p>
                {/* Type picker */}
                <div className="flex flex-wrap gap-1.5">
                  {EXAM_PREP_TYPES.map((t) => (
                    <button key={t.value} onClick={() => setExamPrepDocType(t.value)}
                      className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-all ${
                        examPrepDocType === t.value
                          ? `${t.color} ring-1 ring-offset-1 ring-current`
                          : "bg-muted/40 text-muted-foreground border-border/50 hover:border-border"
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <FileDropSection
                  sectionRef={examPrepRef}
                  entries={examPrepEntries}
                  onAdd={makeAdder<ExamPrepEntry>(setExamPrepEntries, () => ({ docType: examPrepDocType }))}
                  onRemove={(id) => setExamPrepEntries((p) => p.filter((e) => e.id !== id))}
                  onTitleChange={makeTitleUpdater(setExamPrepEntries)}
                  placeholder={`Drop PDF here as ${EXAM_PREP_TYPES.find((t) => t.value === examPrepDocType)?.label}`}
                />
              </CardContent>
              )}
            </Card>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" /> {error}
              </div>
            )}

            <Button className="w-full" size="lg" onClick={handleUpload}
              disabled={lectureEntries.length === 0 || lectureEntries.some((e) => !e.title.trim())}>
              {t("analyzeButton")}
              {lectureEntries.length > 1 ? ` (${lectureEntries.length} files)` : ""}
              {textbookEntries.length > 0 ? ` + ${textbookEntries.length} textbook` : ""}
              {examPrepEntries.length > 0 ? ` + ${examPrepEntries.length} exam prep` : ""}
            </Button>
          </div>
        )}

        {/* ── SCANNING ── */}
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
              <h2 className="text-xl font-bold">Select chapters to analyze</h2>
              <p className="text-sm text-muted-foreground mt-1">
                This PDF is large. Select chapters to stay within the ~150-page analysis limit.
              </p>
            </div>
            {Array.from(tocDataMap.values()).map((data) => {
              const entry = lectureEntries.find((e) => e.id === data.fileId);
              return (
                <Card key={data.fileId}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{entry?.title || entry?.file.name}</CardTitle>
                    {(() => {
                      const selectedPages = Array.from(data.selectedIndices).reduce((sum, i) => sum + data.chapters[i].pageCount, 0);
                      return (
                        <p className="text-xs text-muted-foreground">
                          {data.totalPages} pages total · limit{" "}
                          <span className="font-semibold text-foreground">{data.maxSelectablePages}</span>p
                          {" "}·{" "}
                          <span className={selectedPages > data.maxSelectablePages * 0.9 ? "text-orange-500 font-semibold" : ""}>
                            {selectedPages}/{data.maxSelectablePages}p selected
                          </span>
                        </p>
                      );
                    })()}
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {data.chapters.map((ch, idx) => {
                      const isSelected = data.selectedIndices.has(idx);
                      const selectedPages = Array.from(data.selectedIndices).reduce((sum, i) => sum + data.chapters[i].pageCount, 0);
                      const isDisabled = !isSelected && selectedPages + ch.pageCount > data.maxSelectablePages;
                      return (
                        <button key={idx} onClick={() => toggleChapter(data.fileId, idx)} disabled={isDisabled}
                          className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-all ${
                            isSelected ? "bg-primary text-primary-foreground border-primary"
                              : isDisabled ? "opacity-40 cursor-not-allowed bg-muted/20 border-border/30 text-muted-foreground"
                              : "bg-muted/30 border-border/50 hover:border-primary/50 text-foreground"
                          }`}>
                          <span className="font-medium truncate mr-2">{ch.name}</span>
                          <span className="text-xs shrink-0 opacity-70">{ch.pageCount} pp.</span>
                        </button>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
            <Button className="w-full" size="lg"
              onClick={() => runAnalysis(tocDataMap, uploadedPaths, textbookEntries, examPrepEntries)}
              disabled={!allChaptersSelected()}>
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
                  {lectureEntries.length > 1
                    ? `${currentFileIndex}/${lectureEntries.length} — ${currentFileName}`
                    : currentFileName || lectureEntries[0]?.file.name}
                </p>
              </div>
              <Progress value={progress} className="max-w-sm mx-auto h-2" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-primary animate-pulse">{PHASES[phaseIndex]}</p>
                <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Elapsed: {elapsed}s</span>
                  <span>·</span>
                  <span>~{Math.max(0, estimatedSecs - elapsed)}s remaining</span>
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
                  {fileResults.length}/{lectureEntries.length} PDF{lectureEntries.length > 1 ? "s" : ""} analyzed — {t("uploadSuccess")}
                </span>
              </div>
              {fileErrors.size > 0 && (
                <div className="space-y-1 pl-1">
                  {lectureEntries.filter((e) => fileErrors.has(e.id)).map((entry) => (
                    <div key={entry.id} className="flex items-center gap-2 text-sm text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span className="font-medium truncate">{entry.file.name}</span>
                      <span className="text-xs opacity-75 shrink-0">— {fileErrors.get(entry.id)}</span>
                    </div>
                  ))}
                </div>
              )}
              {supplementaryDocs.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  + {supplementaryDocs.length} supplementary document{supplementaryDocs.length > 1 ? "s" : ""} processed
                </p>
              )}
            </div>

            {/* Concept filter */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Filter className="h-4 w-4" />
                      Filter by Concept
                    </CardTitle>
                    <CardDescription>
                      {totalProblems} problems · {concepts.length} concepts — click to include only selected concepts
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={selectAll} className="text-xs shrink-0">
                    Select All
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {(() => {
                  const TYPE_PRIORITY: SupplementaryDocType[] = ["past_exam", "prof_notes", "study_guide", "formula_sheet", "other"];
                  const docTypeEmphasis = new Map<SupplementaryDocType, Set<string>>();
                  for (const doc of supplementaryDocs) {
                    const type = (doc.insights?.doc_type ?? "other") as SupplementaryDocType;
                    if (!docTypeEmphasis.has(type)) docTypeEmphasis.set(type, new Set());
                    for (const topic of doc.insights?.emphasized_topics ?? []) docTypeEmphasis.get(type)!.add(topic.toLowerCase());
                  }
                  function getEmphasisType(name: string): SupplementaryDocType | null {
                    for (const type of TYPE_PRIORITY) {
                      const topics = docTypeEmphasis.get(type);
                      if (topics?.size && [...topics].some((e) => name.toLowerCase().includes(e) || e.includes(name.toLowerCase()))) return type;
                    }
                    return null;
                  }
                  const emphasisStyle: Record<SupplementaryDocType, { badge: string; icon: string; label: string }> = {
                    past_exam:     { badge: "bg-amber-500/10 border-amber-500/50 hover:border-amber-500",   icon: "text-amber-500",  label: "On Past Exams" },
                    prof_notes:    { badge: "bg-purple-500/10 border-purple-500/50 hover:border-purple-500", icon: "text-purple-500", label: "Prof Notes Emphasis" },
                    study_guide:   { badge: "bg-blue-500/10 border-blue-500/50 hover:border-blue-500",       icon: "text-blue-500",   label: "Study Guide Focus" },
                    formula_sheet: { badge: "bg-green-500/10 border-green-500/50 hover:border-green-500",    icon: "text-green-500",  label: "Formula Focus" },
                    textbook:      { badge: "bg-muted border-border/60 hover:border-border",                 icon: "text-muted-foreground", label: "Textbook" },
                    other:         { badge: "bg-muted border-border/60 hover:border-border",                 icon: "text-muted-foreground", label: "Supplementary" },
                  };
                  const sorted = [...concepts].sort((a, b) => {
                    const aE = getEmphasisType(a.name) ? 1 : 0;
                    const bE = getEmphasisType(b.name) ? 1 : 0;
                    return bE - aE || b.frequency - a.frequency;
                  });
                  const presentTypes = TYPE_PRIORITY.filter((t) => (docTypeEmphasis.get(t)?.size ?? 0) > 0);
                  return (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {sorted.map((concept: Concept, i: number) => {
                          const selected = selectedConcepts.has(concept.name);
                          const emphType = getEmphasisType(concept.name);
                          const style = emphType ? emphasisStyle[emphType] : null;
                          return (
                            <button key={i} onClick={() => toggleConcept(concept.name)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                                selected ? "bg-primary text-primary-foreground border-primary"
                                  : style ? `${style.badge} text-foreground`
                                  : "bg-background border-border text-muted-foreground hover:border-primary/50"
                              }`}>
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
                        <span className="flex items-center gap-1"><Flame className="h-3 w-3" /> Frequently tested</span>
                        <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-destructive" /> Common mistake</span>
                        <span className="flex items-center gap-1"><Trophy className="h-3 w-3" /> Key concept</span>
                      </div>
                    </>
                  );
                })()}
                {selectedConcepts.size > 0 && (
                  <p className="text-xs text-primary font-medium">{selectedConcepts.size} concept{selectedConcepts.size > 1 ? "s" : ""} selected</p>
                )}
              </CardContent>
            </Card>

            {supplementaryDocs.some((d) => d.problems?.length > 0) && (
              <label className="flex items-center gap-2 cursor-pointer select-none px-1">
                <input type="checkbox" checked={includeSupplementary}
                  onChange={(e) => setIncludeSupplementary(e.target.checked)}
                  className="accent-primary h-4 w-4" />
                <span className="text-sm font-medium">Include questions from supplementary materials</span>
                <span className="text-xs text-muted-foreground">
                  ({supplementaryDocs.reduce((s, d) => s + (d.problems?.length ?? 0), 0)} questions)
                </span>
              </label>
            )}

            <Button className="w-full" size="lg" onClick={handleStartStudy} disabled={startingStudy}>
              {startingStudy
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Preparing session...</>
                : <>🚀 {selectedConcepts.size > 0
                    ? `Start with ${selectedConcepts.size} selected concept${selectedConcepts.size > 1 ? "s" : ""}`
                    : "Start Session"}</>
              }
            </Button>

            {startingStudy && (
              <div className="text-center space-y-1">
                <p className="text-xs text-muted-foreground animate-pulse">
                  Building your session and generating Cues — usually 10–30 seconds
                </p>
                <Progress value={null as unknown as number} className="h-1 max-w-xs mx-auto opacity-50" />
              </div>
            )}

            {startError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Failed to start session</p>
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

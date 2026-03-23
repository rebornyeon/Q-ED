"use client";

import { useEffect, useState, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useStudyStore } from "@/stores/study-store";
import { useCueStore } from "@/stores/cue-store";
import { Navbar } from "@/components/navbar";
import { CueReveal } from "@/components/cue-reveal";
import { StudyTimer } from "@/components/study-timer";
import { ScoreRadar } from "@/components/score-radar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ChevronLeft, ChevronRight, Trophy, AlertTriangle,
  Loader2, List, BookPlus, CopyPlus, CheckSquare, Square, Check,
  MessageCircleQuestion, Send, ChevronDown, ChevronUp, Sparkles, ImageIcon, X
} from "lucide-react";
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { SupplementaryUpload } from "@/components/supplementary-upload";
import { MathContent } from "@/components/math-content";
import { StudyNotesPanel } from "@/components/study-notes-panel";
import type { Problem, Cue, ScoreData } from "@/types";

export default function StudySessionPage({
  params,
}: {
  params: Promise<{ locale: string; sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const t = useTranslations("study");
  const locale = useLocale();
  const router = useRouter();
  const supabase = createClient();

  const { problems, currentProblemIndex, nextProblem, prevProblem, setProblems, appendProblems, jumpToIndex } = useStudyStore();

  const [generatedIds, setGeneratedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const saved = localStorage.getItem(`qed-generated-${sessionId}`);
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const { cues, setCues, resetCues, revealedLevel } = useCueStore();

  type DifficultyRating = "again" | "hard" | "good" | "easy";
  const RATING = {
    again: { label: "Again",  desc: "I couldn't solve it yet",          isCorrect: false, offset: 2, maxRetries: 3, weight: 3, className: "border-red-500/40 hover:bg-red-500/10 hover:text-red-600 text-red-500" },
    hard:  { label: "Hard",   desc: "I got there, but it was painful", isCorrect: false, offset: 4, maxRetries: 2, weight: 1, className: "border-orange-500/40 hover:bg-orange-500/10 hover:text-orange-600 text-orange-500" },
    good:  { label: "Good",   desc: "I understood the logic",          isCorrect: true,  offset: 0, maxRetries: 0, weight: 0, className: "border-blue-500/40 hover:bg-blue-500/10 hover:text-blue-600 text-blue-500" },
    easy:  { label: "Easy",   desc: "No sweat, I've mastered this",    isCorrect: true,  offset: 0, maxRetries: 0, weight: 0, className: "border-green-500/40 hover:bg-green-500/10 hover:text-green-600 text-green-500" },
  } as const;

  const [loading, setLoading] = useState(true);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [rating, setRating] = useState<DifficultyRating | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [score, setScore] = useState<ScoreData | null>(null);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [loadingCues, setLoadingCues] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [suppOpen, setSuppOpen] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [documentTitle, setDocumentTitle] = useState<string | null>(null);
  const [generatingNoteFor, setGeneratingNoteFor] = useState<string | null>(null);
  const [generatingSimilar, setGeneratingSimilar] = useState(false);
  const [similarAdded, setSimilarAdded] = useState<number | null>(null);
  const [weakConceptCounts, setWeakConceptCounts] = useState<Map<string, number>>(() => {
    if (typeof window === "undefined") return new Map();
    try {
      const saved = localStorage.getItem(`qed-weak-${sessionId}`);
      return saved ? new Map(JSON.parse(saved) as [string, number][]) : new Map();
    } catch { return new Map(); }
  });
  const [triedIds, setTriedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const saved = localStorage.getItem(`qed-tried-${sessionId}`);
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const [ratingHistory, setRatingHistory] = useState<Map<string, DifficultyRating[]>>(() => {
    if (typeof window === "undefined") return new Map();
    try {
      const saved = localStorage.getItem(`qed-ratings-${sessionId}`);
      return saved ? new Map(JSON.parse(saved) as [string, DifficultyRating[]][]) : new Map();
    } catch { return new Map(); }
  });
  const [showSuggestSimilar, setShowSuggestSimilar] = useState(false);
  const [startingWeakSession, setStartingWeakSession] = useState(false);
  const [askQuestion, setAskQuestion] = useState("");
  const [, setAskAnswer] = useState<string | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askHistory, setAskHistory] = useState<{ q: string; a: string; img?: string }[]>([]);
  const [askExpanded, setAskExpanded] = useState<Set<number>>(new Set());
  const [askImage, setAskImage] = useState<{ base64: string; mimeType: string; preview: string } | null>(null);
  const askInputRef = useRef<HTMLTextAreaElement>(null);
  const askImageInputRef = useRef<HTMLInputElement>(null);

  const currentProblem: Problem | undefined = problems[currentProblemIndex];

  // Persist weakConceptCounts to localStorage and sync to DB on every change
  useEffect(() => {
    localStorage.setItem(`qed-weak-${sessionId}`, JSON.stringify([...weakConceptCounts]));
    // Eagerly sync to DB so list page always shows up-to-date weak spots
    if (weakConceptCounts.size === 0) return;
    const weakList = Array.from(weakConceptCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    supabase
      .from("study_sessions")
      .update({ score_data: { weak_concepts: weakList } })
      .eq("id", sessionId)
      .then(() => {}); // fire and forget
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weakConceptCounts]);

  // Persist triedIds, ratingHistory, and generatedIds to localStorage
  useEffect(() => {
    localStorage.setItem(`qed-tried-${sessionId}`, JSON.stringify([...triedIds]));
  }, [triedIds, sessionId]);

  useEffect(() => {
    localStorage.setItem(`qed-ratings-${sessionId}`, JSON.stringify([...ratingHistory]));
  }, [ratingHistory, sessionId]);

  useEffect(() => {
    localStorage.setItem(`qed-generated-${sessionId}`, JSON.stringify([...generatedIds]));
  }, [generatedIds, sessionId]);

  // Load session and problems
  useEffect(() => {
    async function load() {
      const { data: sessionData } = await supabase
        .from("study_sessions")
        .select("*, documents(*)")
        .eq("id", sessionId)
        .single();

      if (!sessionData) { router.push(`/${locale}/study`); return; }

      const { data: problemsData } = await supabase
        .from("problems")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at");

      if (problemsData) {
        setProblems(problemsData as Problem[]);
        // Restore last position
        const savedIndex = localStorage.getItem(`qed-index-${sessionId}`);
        if (savedIndex) {
          const idx = parseInt(savedIndex, 10);
          if (idx > 0 && idx < problemsData.length) jumpToIndex(idx);
        }
      }
      if (sessionData.document_id) setDocumentId(sessionData.document_id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docs = (sessionData as any).documents;
      if (docs?.title) setDocumentTitle(docs.title);
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Persist current problem index
  useEffect(() => {
    localStorage.setItem(`qed-index-${sessionId}`, String(currentProblemIndex));
  }, [currentProblemIndex, sessionId]);

  // Reset per-problem transient state when problem changes
  useEffect(() => {
    setSimilarAdded(null);
    setShowSuggestSimilar(false);
    setAskQuestion("");
    setAskAnswer(null);
    setAskHistory([]);
    setAskExpanded(new Set());
  }, [currentProblemIndex]);

  // Load cues when problem changes
  useEffect(() => {
    if (!currentProblem) return;
    resetCues();
    setRating(null);
    setFeedback(null);
    setTimerSeconds(0);
    loadCues(currentProblem);
    // Prefetch next problem's cues in background
    const nextProblem = problems[currentProblemIndex + 1];
    if (nextProblem) {
      fetch("/api/cue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problemId: nextProblem.id, problemContent: nextProblem.content }),
      }).catch(() => {}); // fire and forget
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProblemIndex, currentProblem?.id]);

  async function loadCues(problem: Problem) {
    setLoadingCues(true);
    const res = await fetch("/api/cue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ problemId: problem.id, problemContent: problem.content }),
    });
    if (res.ok) {
      const data = await res.json();
      setCues(data.cues as Cue[]);
    }
    setLoadingCues(false);
  }

  function toggleTried(problemId: string) {
    setTriedIds((prev) => {
      const next = new Set(prev);
      if (next.has(problemId)) next.delete(problemId);
      else next.add(problemId);
      return next;
    });
  }

  async function startWeakSession() {
    if (!documentId) return;
    setStartingWeakSession(true);
    const topConcepts = Array.from(weakConceptCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([c]) => c);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, conceptFilter: topConcepts }),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/${locale}/study/${data.session.id}`);
      }
    } finally {
      setStartingWeakSession(false);
    }
  }

  async function handleRate(r: DifficultyRating) {
    if (!currentProblem || rating) return;
    setRating(r);
    const cfg = RATING[r];

    // Auto-mark as tried + record rating history
    setTriedIds((prev) => new Set([...prev, currentProblem.id]));
    setRatingHistory((prev) => {
      const next = new Map(prev);
      next.set(currentProblem.id, [...(next.get(currentProblem.id) ?? []), r]);
      return next;
    });

    // Track weak concepts weighted by difficulty
    if (cfg.weight > 0) {
      setWeakConceptCounts((prev) => {
        const next = new Map(prev);
        for (const c of currentProblem.concepts) {
          next.set(c, (next.get(c) ?? 0) + cfg.weight);
        }
        return next;
      });
      // Suggest similar if rated Again twice (computed from updated history)
      const prevHistory = ratingHistory.get(currentProblem.id) ?? [];
      const againCount = [...prevHistory, r].filter((x) => x === "again").length;
      if (againCount >= 2) setShowSuggestSimilar(true);
    }

    // Only call feedback API for Again/Hard
    if (!cfg.isCorrect) {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problemId: currentProblem.id,
          problemContent: currentProblem.content,
          isCorrect: false,
          timeSpent: timerSeconds,
          cuesUsed: revealedLevel,
          mistakeType: r === "again" ? "couldn't solve" : "struggled",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setFeedback(data.feedback);
        setScore(data.score);
      }
    }

    // Fire-and-forget note generation
    setGeneratingNoteFor(currentProblem.id);
    fetch("/api/notes/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ problemId: currentProblem.id, sessionId }),
    }).then(() => setGeneratingNoteFor(null)).catch(() => setGeneratingNoteFor(null));
  }

  async function handleGenerateSimilar() {
    if (!currentProblem || generatingSimilar) return;
    setGeneratingSimilar(true);
    setSimilarAdded(null);

    const res = await fetch("/api/generate-similar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ problemId: currentProblem.id, count: 3 }),
    });

    if (res.ok) {
      const data = await res.json();
      appendProblems(data.problems);
      setGeneratedIds((prev) => new Set([...prev, ...(data.problems as Problem[]).map((p) => p.id)]));
      setSimilarAdded(data.count);
    }
    setGeneratingSimilar(false);
  }

  function handleNext() {
    if (currentProblemIndex === problems.length - 1) {
      setSessionComplete(true);
    } else {
      nextProblem();
    }
  }

  function handleImageSelect(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const base64 = dataUrl.split(",")[1];
      setAskImage({ base64, mimeType: file.type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  }

  async function handleAsk() {
    if (!currentProblem || (!askQuestion.trim() && !askImage) || askLoading) return;
    const q = askQuestion.trim();
    const imgSnapshot = askImage;
    setAskLoading(true);
    setAskAnswer(null);
    setAskImage(null);
    setAskQuestion("");
    if (askInputRef.current) askInputRef.current.style.height = "36px";
    try {
      const res = await fetch("/api/ask-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problemId: currentProblem.id,
          question: q || "What is shown in this image?",
          history: askHistory,
          imageBase64: imgSnapshot?.base64 ?? null,
          imageMimeType: imgSnapshot?.mimeType ?? null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAskAnswer(data.answer);
        setAskHistory((prev) => {
          const newIdx = prev.length;
          setAskExpanded(new Set([newIdx]));
          return [...prev, { q: q || "📷 Image", a: data.answer, img: imgSnapshot?.preview }];
        });
      }
    } finally {
      setAskLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (sessionComplete) {
    const weakSpots = Array.from(weakConceptCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 py-12 text-center space-y-8">
          <div>
            <Trophy className="h-16 w-16 text-primary mx-auto mb-4" />
            <h1 className="text-3xl font-black">{t("sessionComplete")}</h1>
          </div>

          {score && (
            <Card>
              <CardHeader><CardTitle>Score & Thinking Radar</CardTitle></CardHeader>
              <CardContent>
                <ScoreRadar score={score} size={320} />
                <div className="grid grid-cols-5 gap-2 mt-4 text-center text-xs text-muted-foreground">
                  {[
                    { label: t("accuracy"), val: score.accuracy },
                    { label: t("speed"), val: score.speed },
                    { label: t("pattern"), val: score.pattern_recognition },
                    { label: t("trapAvoid"), val: score.trap_avoidance },
                    { label: t("thinking"), val: score.thinking_depth },
                  ].map((s) => (
                    <div key={s.label}>
                      <div className="text-lg font-bold text-foreground">{s.val}</div>
                      <div>{s.label}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {weakSpots.length > 0 && (
            <Card className="text-left">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Weak Spots — Review Before Exam
                </CardTitle>
                <p className="text-xs text-muted-foreground">Concepts you got wrong most often this session</p>
              </CardHeader>
              <CardContent className="space-y-2">
                {weakSpots.map(([concept, count]) => (
                  <div key={concept} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                    <span className="text-sm font-medium">{concept}</span>
                    <Badge variant="destructive" className="text-xs">
                      {count}× wrong
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {weakSpots.length > 0 && documentId && (
              <Button
                size="lg"
                variant="outline"
                onClick={startWeakSession}
                disabled={startingWeakSession}
                className="gap-2"
              >
                {startingWeakSession
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <AlertTriangle className="h-4 w-4 text-amber-500" />
                }
                Practice Weak Spots
              </Button>
            )}
            <Button size="lg" onClick={() => router.push(`/${locale}/dashboard`)}>
              Back to Dashboard
            </Button>
          </div>
        </main>
      </div>
    );
  }

  if (!currentProblem) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 py-12 text-center">
          <p className="text-muted-foreground">문제가 없습니다.</p>
          <Button onClick={() => router.push(`/${locale}/study`)} className="mt-4">
            학습 목록으로
          </Button>
        </main>
      </div>
    );
  }

  const progressPercent = ((currentProblemIndex + 1) / problems.length) * 100;
  const currentLastRating = ratingHistory.get(currentProblem.id)?.at(-1);
  const currentNeedsRetry = (currentLastRating === "again" || currentLastRating === "hard") && !generatedIds.has(currentProblem.id);
  const isMastered = currentLastRating === "easy" && revealedLevel === 0;

  // Build question list groups (outside JSX to avoid IIFE parser issues)
  const sectionOrder: string[] = [];
  const sectionMap = new Map<string, { problem: Problem; index: number }[]>();
  problems.forEach((p, i) => {
    const key = p.section ?? "General";
    if (!sectionMap.has(key)) { sectionMap.set(key, []); sectionOrder.push(key); }
    sectionMap.get(key)!.push({ problem: p, index: i });
  });
  const questionGroups = sectionOrder.map((s) => ({ section: s, items: sectionMap.get(s)! }));
  const hasRealSections = questionGroups.some((g) => g.section !== "General") || questionGroups.length > 1;

  return (
    <div className="min-h-screen bg-background">
      {/* Slim top nav — progress + secondary actions */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border/40">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-12">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold tabular-nums text-foreground">
              {currentProblemIndex + 1}<span className="text-muted-foreground font-normal">/{problems.length}</span>
            </span>
            {/* Progress mini-map: colored dots for each problem */}
            <div className="relative group">
              <Progress value={progressPercent} className="w-24 h-1.5 cursor-pointer" />
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 hidden group-hover:flex flex-wrap gap-[3px] p-2 rounded-lg bg-popover border border-border shadow-lg z-50 max-w-[280px]">
                {problems.map((p, i) => {
                  const lr = ratingHistory.get(p.id)?.at(-1);
                  const dotColor = lr === "easy" ? "bg-green-500" : lr === "good" ? "bg-blue-500" : lr === "hard" ? "bg-orange-500" : lr === "again" ? "bg-red-500" : i === currentProblemIndex ? "bg-primary ring-1 ring-primary/50" : "bg-muted-foreground/20";
                  return (
                    <button
                      key={p.id}
                      onClick={() => jumpToIndex(i)}
                      className={`h-2.5 w-2.5 rounded-full ${dotColor} hover:scale-150 transition-transform cursor-pointer`}
                      title={`Q${i + 1}${lr ? ` — ${lr}` : ""}`}
                    />
                  );
                })}
              </div>
            </div>
            <StudyTimer isRunning={!rating} onTick={setTimerSeconds} />
          </div>
          <div className="flex items-center gap-2">
            <Sheet open={listOpen} onOpenChange={setListOpen}>
              <SheetTrigger
                render={<Button variant="ghost" size="sm" className="gap-1.5 text-xs h-8" />}
              >
                <List className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Questions</span>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-0">
                <SheetHeader className="p-4 border-b border-border sticky top-0 bg-background z-10">
                  <SheetTitle>Question List ({problems.length})</SheetTitle>
                </SheetHeader>
                <div>
                  {questionGroups.map((group, gi) => (
                    <div key={group.section}>
                      {hasRealSections && (
                        <div className="px-4 py-2.5 bg-background border-y border-border/60 sticky top-0 z-10 shadow-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-primary/70 tabular-nums shrink-0">§{gi + 1}</span>
                            <p className="text-xs font-semibold text-foreground leading-snug">{group.section}</p>
                            <span className="ml-auto text-xs text-muted-foreground shrink-0 pl-2">{group.items.length}q</span>
                          </div>
                        </div>
                      )}
                      <div className="divide-y divide-border/30">
                        {group.items.map(({ problem: p, index: i }) => {
                          const lastRating = ratingHistory.get(p.id)?.at(-1);
                          const needsRetry = lastRating === "again" || lastRating === "hard";
                          const checkboxColor = !triedIds.has(p.id)
                            ? "text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/50"
                            : lastRating === "again" ? "text-red-600 bg-red-500/10"
                            : lastRating === "hard"  ? "text-orange-600 bg-orange-500/10"
                            : lastRating === "good"  ? "text-blue-600 bg-blue-500/10"
                            : "text-green-600 bg-green-500/10";
                          return (
                            <div
                              key={p.id}
                              className={`flex items-stretch border-l-2 transition-colors ${
                                i === currentProblemIndex ? "bg-primary/5 border-l-primary" :
                                generatedIds.has(p.id) ? "bg-sky-500/5 border-l-sky-400" :
                                needsRetry ? "bg-amber-500/5 border-l-amber-400" : "border-l-transparent"
                              }`}
                            >
                              <button
                                onClick={() => { jumpToIndex(i); setListOpen(false); }}
                                className="flex-1 text-left px-4 py-3 hover:bg-muted/40 transition-colors min-w-0"
                              >
                                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                  <span className={`text-xs font-bold tabular-nums shrink-0 ${i === currentProblemIndex ? "text-primary" : "text-muted-foreground"}`}>Q{i + 1}</span>
                                  {p.difficulty && <span className="text-xs text-amber-500">{"★".repeat(p.difficulty)}</span>}
                                  {generatedIds.has(p.id) && <span className="text-xs font-semibold text-sky-600 bg-sky-500/15 px-1.5 py-0.5 rounded-full">✦ AI</span>}
                                  {needsRetry && !generatedIds.has(p.id) && <span className="text-xs font-semibold text-amber-600 bg-amber-500/15 px-1.5 py-0.5 rounded-full">⟳</span>}
                                  {p.is_exam_overlap && <span className="text-xs font-semibold text-red-600 bg-red-500/15 px-1.5 py-0.5 rounded-full">Exam</span>}
                                  {p.exam_likelihood != null && p.exam_likelihood > 0 && (
                                    <span className="text-[10px] text-red-500 tracking-tight" title={`Exam likelihood: ${p.exam_likelihood}/5`}>
                                      {"●".repeat(p.exam_likelihood)}{"○".repeat(5 - p.exam_likelihood)}
                                    </span>
                                  )}
                                </div>
                                {p.concepts.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {p.concepts.slice(0, 3).map((c, ci) => (
                                      <span key={ci} className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{c}</span>
                                    ))}
                                  </div>
                                )}
                              </button>
                              <div
                                role="button" tabIndex={0}
                                onClick={() => toggleTried(p.id)}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleTried(p.id); }}
                                className={`shrink-0 flex flex-col items-center justify-center gap-1 w-12 cursor-pointer transition-colors border-l border-border/30 ${checkboxColor}`}
                              >
                                {triedIds.has(p.id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                                {(ratingHistory.get(p.id)?.length ?? 0) > 0 && (
                                  <div className="flex flex-col items-center gap-px">
                                    {(ratingHistory.get(p.id) ?? []).slice(0, 3).map((r, j) => (
                                      <Check key={j} className={`h-2.5 w-2.5 ${r === "again" ? "text-red-500" : r === "hard" ? "text-orange-500" : r === "good" ? "text-blue-500" : "text-green-500"}`} />
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </SheetContent>
            </Sheet>
            {documentId && (
              <Sheet open={suppOpen} onOpenChange={setSuppOpen}>
                <SheetTrigger render={<Button variant="ghost" size="sm" className="gap-1.5 text-xs h-8" />}>
                  <BookPlus className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Materials</span>
                </SheetTrigger>
                <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-0">
                  <SheetHeader className="p-4 border-b border-border">
                    <SheetTitle>Supplementary Materials</SheetTitle>
                    <p className="text-xs text-muted-foreground mt-1">Add past exams, professor notes, or study guides.</p>
                  </SheetHeader>
                  <div className="p-4"><SupplementaryUpload documentId={documentId} /></div>
                </SheetContent>
              </Sheet>
            )}
            <StudyNotesPanel
              sessionId={sessionId}
              generatingNoteFor={generatingNoteFor}
              onNoteGenerated={() => {}}
            />
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-8" onClick={() => router.push(`/${locale}/study`)}>
              <ChevronLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Study Sessions</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Main content — two-column: problem left, AI tutor pinned right */}
      <main className="max-w-6xl mx-auto px-4 pt-8 lg:flex lg:gap-6">
        {/* LEFT COLUMN — problem, hints, post-mortem */}
        <div className="flex-1 min-w-0">
        {/* Problem title row — with tried checkmark inline */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold text-foreground">
              {t("problem")} {currentProblemIndex + 1}
            </h1>
            {currentProblem.difficulty && (
              <span className="text-sm text-amber-500">{"★".repeat(currentProblem.difficulty)}</span>
            )}
            {isMastered && (
              <Badge variant="outline" className="text-[11px] border-0 bg-green-500/10 text-green-600 font-semibold">Mastered</Badge>
            )}
            {generatedIds.has(currentProblem.id) && (
              <Badge variant="outline" className="text-[11px] border-0 bg-sky-500/10 text-sky-600 font-semibold">✦ AI Generated</Badge>
            )}
            {currentNeedsRetry && (
              <Badge variant="outline" className="text-[11px] border-0 bg-amber-500/10 text-amber-600 font-semibold">⟳ Retry</Badge>
            )}
            {currentProblem.exam_likelihood != null && currentProblem.exam_likelihood > 0 && (
              <span className="text-[11px] text-red-500 tracking-tight" title={`Exam likelihood: ${currentProblem.exam_likelihood}/5`}>
                {"●".repeat(currentProblem.exam_likelihood)}{"○".repeat(5 - currentProblem.exam_likelihood)}
              </span>
            )}
            {currentProblem.is_exam_overlap && (
              <Badge variant="outline" className="text-[11px] border-0 bg-purple-500/10 text-purple-600 font-semibold">Past Exam</Badge>
            )}
          </div>
          {/* Tried + rating history — top right */}
          <div className="flex items-center gap-2 shrink-0">
            {(ratingHistory.get(currentProblem.id)?.length ?? 0) > 0 && (
              <span className="flex items-center gap-0.5">
                {(ratingHistory.get(currentProblem.id) ?? []).map((r, j) => (
                  <Check key={j} className={`h-3 w-3 ${r === "again" ? "text-red-500" : r === "hard" ? "text-orange-500" : r === "good" ? "text-blue-500" : "text-green-500"}`} />
                ))}
              </span>
            )}
            <button
              onClick={() => toggleTried(currentProblem.id)}
              className={`flex items-center gap-1 text-xs font-medium transition-colors ${triedIds.has(currentProblem.id) ? "text-green-600" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
              title={triedIds.has(currentProblem.id) ? "Tried" : "Mark as tried"}
            >
              {triedIds.has(currentProblem.id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Concept tags — subtle, below title */}
        {currentProblem.concepts.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-4">
            {currentProblem.concepts.map((c, i) => (
              <Badge key={i} variant="secondary" className="text-xs font-normal">{c}</Badge>
            ))}
          </div>
        )}

        {/* Hero question block — prominent card with Similar sparkle inside */}
        {(() => {
          const len = currentProblem.content.length;
          const sizeClass = len < 100 ? "text-2xl leading-loose" : len < 300 ? "text-xl leading-relaxed" : len < 600 ? "text-base leading-relaxed" : "text-sm leading-normal";
          return (
        <div className="relative rounded-xl bg-card border border-border/60 shadow-md px-8 py-10 mb-3">
          <MathContent className={`${sizeClass} font-serif`}>
            {currentProblem.content}
          </MathContent>
          {/* Similar button — pinned bottom-right of card */}
          <button
            onClick={handleGenerateSimilar}
            disabled={generatingSimilar}
            className={`absolute bottom-3 right-3 flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1.5 transition-all border ${
              rating && !RATING[rating].isCorrect
                ? "border-sky-400/60 bg-sky-500/10 text-sky-600 hover:bg-sky-500/20 shadow-sm shadow-sky-500/10 animate-pulse"
                : "border-border/60 bg-background/80 text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5"
            } disabled:opacity-50 backdrop-blur-sm hover:backdrop-blur-md`}
          >
            {generatingSimilar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {generatingSimilar ? "Generating..." : similarAdded !== null ? `+${similarAdded} added` : "Generate Similar Problems"}
          </button>
        </div>
          );
        })()}

        {/* Source metadata */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground/50 mb-6">
          {documentTitle && <span className="font-medium">{documentTitle}</span>}
          {currentProblem.section && <><span>·</span><span>{currentProblem.section}</span></>}
          {currentProblem.page && <><span>·</span><span>p.{currentProblem.page}</span></>}
          {currentProblem.problem_number && <><span>·</span><span>#{currentProblem.problem_number}</span></>}
        </div>

        {/* Hint Stack — tighter gap from question */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Hints</h2>
            <div className="flex items-center gap-3">
              {loadingCues && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {!loadingCues && currentProblem && (
                <button
                  onClick={async () => {
                    const { createClient } = await import("@/lib/supabase/client");
                    const sb = createClient();
                    await sb.from("cues").delete().eq("problem_id", currentProblem.id);
                    await loadCues(currentProblem);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Regenerate
                </button>
              )}
            </div>
          </div>
          {!loadingCues && <CueReveal cues={cues} />}
        </div>

        {/* Post-mortem — feedback + similar suggestion (only for Again/Hard) */}
        {rating && !RATING[rating].isCorrect && (feedback || showSuggestSimilar) && (
          <div className={`rounded-lg border p-4 space-y-3 mb-8 ${
            rating === "again" ? "border-red-500/20 bg-red-500/5" : "border-orange-500/20 bg-orange-500/5"
          }`}>
            <div className="flex items-center gap-2">
              <AlertTriangle className={`h-4 w-4 shrink-0 ${rating === "again" ? "text-red-500" : "text-orange-500"}`} />
              <h3 className={`text-sm font-bold ${rating === "again" ? "text-red-600" : "text-orange-600"}`}>
                Post-Mortem
              </h3>
            </div>
            {feedback && (
              <MathContent className="text-sm leading-relaxed text-foreground">
                {feedback}
              </MathContent>
            )}
            {showSuggestSimilar && similarAdded === null && (
              <div className="pt-2 border-t border-border/30">
                <p className="text-xs text-muted-foreground mb-2">Struggled twice — want more practice?</p>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleGenerateSimilar} disabled={generatingSimilar}>
                  {generatingSimilar ? <Loader2 className="h-3 w-3 animate-spin" /> : <CopyPlus className="h-3 w-3" />}
                  {generatingSimilar ? "Generating..." : "Generate Similar"}
                </Button>
              </div>
            )}
            {similarAdded !== null && (
              <p className="text-xs text-green-600 font-medium">+{similarAdded} questions added</p>
            )}
          </div>
        )}
        {/* Success confirmation for Good/Easy */}
        {rating && RATING[rating].isCorrect && similarAdded !== null && (
          <p className="text-xs text-green-600 font-medium mb-8">+{similarAdded} questions added</p>
        )}

        {/* Post-solve action pill — centered, floating feel */}
        <div className="flex justify-center mt-10 mb-12">
          <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card shadow-sm px-1.5 py-1.5">
            {/* Prev */}
            <button
              onClick={prevProblem}
              disabled={currentProblemIndex === 0}
              className="h-9 rounded-full flex items-center gap-1 px-3 text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-30"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>

            <div className="h-5 w-px bg-border/40 mx-0.5" />

            {/* Rating buttons — compact colored circles with numbers */}
            {!rating ? (
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-muted-foreground/60">Personal Evaluation</span>
                <div className="flex items-center gap-1">
                {(["easy", "good", "hard", "again"] as const).map((r) => {
                  const colorMap = {
                    again: "bg-red-500 hover:bg-red-600 text-white",
                    hard: "bg-orange-500 hover:bg-orange-600 text-white",
                    good: "bg-blue-500 hover:bg-blue-600 text-white",
                    easy: "bg-green-500 hover:bg-green-600 text-white",
                  };
                  const numberMap = { easy: "1", good: "2", hard: "3", again: "4" };
                  return (
                    <button
                      key={r}
                      onClick={() => handleRate(r)}
                      className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold transition-all ${colorMap[r]} shadow-sm hover:scale-110`}
                      title={`${numberMap[r]} — ${RATING[r].label}: ${RATING[r].desc}`}
                    >
                      {numberMap[r]}
                    </button>
                  );
                })}
                </div>
              </div>
            ) : (
              <div className={`px-4 py-1.5 rounded-full text-xs font-semibold ${
                rating === "again" ? "bg-red-500/10 text-red-600" :
                rating === "hard"  ? "bg-orange-500/10 text-orange-600" :
                rating === "good"  ? "bg-blue-500/10 text-blue-600" :
                                     "bg-green-500/10 text-green-600"
              }`}>
                {RATING[rating].label}
              </div>
            )}

            <div className="h-5 w-px bg-border/40 mx-0.5" />

            {/* Next / Finish */}
            <button
              onClick={handleNext}
              className={`h-9 rounded-full flex items-center gap-1 px-4 text-xs font-semibold transition-all ${
                rating
                  ? "bg-foreground text-background hover:opacity-90 shadow-sm"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              {currentProblemIndex === problems.length - 1 ? "Finish" : "Next"}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        </div>{/* end LEFT COLUMN */}

        {/* RIGHT COLUMN — Ask AI Tutor, sticky side panel (desktop only) */}
        <div className="hidden lg:block w-[420px] shrink-0">
          <div className="sticky top-16 max-h-[calc(100vh-8rem)] flex flex-col rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-muted/30">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <MessageCircleQuestion className="h-4 w-4" />
                Ask AI Tutor
                {askHistory.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] ml-2">{askHistory.length}</Badge>
                )}
              </h2>
            </div>

            {/* Scrollable Q&A history */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {askHistory.length === 0 && !askLoading && (
                <p className="text-xs text-muted-foreground/50 text-center py-6">
                  Ask anything about this problem
                </p>
              )}
              {askHistory.map((item, i) => {
                const isOpen = askExpanded.has(i);
                return (
                  <div key={i} className="rounded-lg border border-border/50 overflow-hidden">
                    <button
                      onClick={() => setAskExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i); else next.add(i);
                        return next;
                      })}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                    >
                      {isOpen ? <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
                      <span className="text-xs font-bold text-primary shrink-0">Q{i + 1}:</span>
                      <span className="text-sm text-foreground truncate">{item.q}</span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 pt-1 border-t border-border/30 space-y-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {item.img && <img src={item.img} alt="question image" className="h-24 rounded-md border border-border object-cover" />}
                        <p className="text-sm text-foreground whitespace-pre-wrap">{item.q}</p>
                        <div className="flex gap-2">
                          <span className="text-xs font-bold text-green-600 shrink-0 mt-0.5">A:</span>
                          <MathContent className="text-sm leading-relaxed">{item.a}</MathContent>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {askLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Thinking...
                </div>
              )}
            </div>

            {/* Input — pinned to bottom of panel */}
            <div className="px-3 py-3 border-t border-border/40 bg-muted/20">
              {askImage && (
                <div className="relative inline-block mb-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={askImage.preview} alt="upload preview" className="h-16 rounded-md border border-border object-cover" />
                  <button onClick={() => setAskImage(null)} className="absolute -top-1.5 -right-1.5 bg-background border border-border rounded-full p-0.5 hover:bg-muted">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              <div className="flex gap-2 items-end">
                <input ref={askImageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageSelect(f); e.target.value = ""; }} />
                <button onClick={() => askImageInputRef.current?.click()} className="shrink-0 p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Attach image">
                  <ImageIcon className="h-4 w-4" />
                </button>
                <textarea
                  ref={askInputRef}
                  value={askQuestion}
                  onChange={(e) => {
                    setAskQuestion(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
                  placeholder="Ask anything..."
                  rows={1}
                  className="flex-1 text-sm px-2.5 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none overflow-hidden"
                  style={{ minHeight: "32px" }}
                  disabled={askLoading}
                />
                <Button size="sm" onClick={handleAsk} disabled={askLoading || (!askQuestion.trim() && !askImage)} className="shrink-0 gap-1 h-8 px-2.5">
                  {askLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* MOBILE — Ask AI Tutor inline (visible only on small screens) */}
        <div className="lg:hidden w-full mb-10">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-5 flex items-center gap-1.5">
            <MessageCircleQuestion className="h-4 w-4" />
            Ask AI Tutor
            {askHistory.length > 0 && (
              <Badge variant="secondary" className="text-[10px] ml-2">{askHistory.length}</Badge>
            )}
          </h2>

          {askHistory.length > 0 && (
            <div className="space-y-2 mb-4">
              {askHistory.map((item, i) => {
                const isOpen = askExpanded.has(i);
                return (
                  <div key={i} className="rounded-lg border border-border/50 overflow-hidden">
                    <button
                      onClick={() => setAskExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i); else next.add(i);
                        return next;
                      })}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                    >
                      {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      <span className="text-xs font-bold text-primary shrink-0">Q{i + 1}:</span>
                      <span className="text-sm text-foreground truncate">{item.q}</span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 pt-1 border-t border-border/30 space-y-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {item.img && <img src={item.img} alt="question image" className="h-24 rounded-md border border-border object-cover" />}
                        <p className="text-sm text-foreground whitespace-pre-wrap">{item.q}</p>
                        <div className="flex gap-2">
                          <span className="text-xs font-bold text-green-600 shrink-0 mt-1">A:</span>
                          <MathContent className="text-sm leading-relaxed">{item.a}</MathContent>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {askLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2 mb-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking...
            </div>
          )}

          {askImage && (
            <div className="relative inline-block mb-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={askImage.preview} alt="upload preview" className="h-16 rounded-md border border-border object-cover" />
              <button onClick={() => setAskImage(null)} className="absolute -top-1.5 -right-1.5 bg-background border border-border rounded-full p-0.5 hover:bg-muted">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="flex gap-2 items-end">
            <button onClick={() => askImageInputRef.current?.click()} className="shrink-0 p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Attach image">
              <ImageIcon className="h-4 w-4" />
            </button>
            <textarea
              value={askQuestion}
              onChange={(e) => {
                setAskQuestion(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
              }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
              placeholder="Ask anything — e.g. How do I start? What formula should I use?"
              rows={1}
              className="flex-1 text-sm px-3 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none overflow-hidden"
              style={{ minHeight: "36px" }}
              disabled={askLoading}
            />
            <Button size="sm" onClick={handleAsk} disabled={askLoading || (!askQuestion.trim() && !askImage)} className="shrink-0 gap-1 h-9">
              {askLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </main>

    </div>
  );
} //

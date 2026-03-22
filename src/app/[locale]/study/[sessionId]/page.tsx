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
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeft, ChevronRight, Trophy, AlertTriangle,
  Loader2, List, BookPlus, CopyPlus, CheckSquare, Square, Check
} from "lucide-react";
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { SupplementaryUpload } from "@/components/supplementary-upload";
import { MathContent } from "@/components/math-content";
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
    again: { label: "Again",  desc: "Couldn't solve", isCorrect: false, offset: 2, maxRetries: 3, weight: 3, className: "border-red-500/40 hover:bg-red-500/10 hover:text-red-600 text-red-500" },
    hard:  { label: "Hard",   desc: "Struggled",      isCorrect: false, offset: 4, maxRetries: 2, weight: 1, className: "border-orange-500/40 hover:bg-orange-500/10 hover:text-orange-600 text-orange-500" },
    good:  { label: "Good",   desc: "Got it",          isCorrect: true,  offset: 0, maxRetries: 0, weight: 0, className: "border-blue-500/40 hover:bg-blue-500/10 hover:text-blue-600 text-blue-500" },
    easy:  { label: "Easy",   desc: "No problem",      isCorrect: true,  offset: 0, maxRetries: 0, weight: 0, className: "border-green-500/40 hover:bg-green-500/10 hover:text-green-600 text-green-500" },
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

      if (problemsData) setProblems(problemsData as Problem[]);
      if (sessionData.document_id) setDocumentId(sessionData.document_id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docs = (sessionData as any).documents;
      if (docs?.title) setDocumentTitle(docs.title);
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Reset per-problem transient state when problem changes
  useEffect(() => {
    setSimilarAdded(null);
    setShowSuggestSimilar(false);
  }, [currentProblemIndex]);

  // Load cues when problem changes
  useEffect(() => {
    if (!currentProblem) return;
    resetCues();
    setRating(null);
    setFeedback(null);
    setTimerSeconds(0);
    loadCues(currentProblem);
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
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Header bar */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground font-medium">
              {t("problem")} {currentProblemIndex + 1} / {problems.length}
            </span>
            <Progress value={progressPercent} className="w-32 h-1.5" />
            {currentProblem.difficulty && (
              <Badge variant="outline" className="text-xs">
                {"★".repeat(currentProblem.difficulty)}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Sheet open={listOpen} onOpenChange={setListOpen}>
              <SheetTrigger
                render={
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" />
                }
              >
                <List className="h-3.5 w-3.5" />
                Question List
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-0">
                <SheetHeader className="p-4 border-b border-border sticky top-0 bg-background z-10">
                  <SheetTitle>Question List ({problems.length})</SheetTitle>
                </SheetHeader>
                <div>
                      {questionGroups.map((group, gi) => (
                        <div key={group.section}>
                          {/* Section header — hide if only one "General" group */}
                          {/* Sticky section header */}
                          {hasRealSections && (
                            <div className="px-4 py-2.5 bg-background border-y border-border/60 sticky top-0 z-10 shadow-sm">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-primary/70 tabular-nums shrink-0">
                                  §{gi + 1}
                                </span>
                                <p className="text-xs font-semibold text-foreground leading-snug">
                                  {group.section}
                                </p>
                                <span className="ml-auto text-xs text-muted-foreground shrink-0 pl-2">
                                  {group.items.length}q
                                </span>
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
                                : lastRating === "easy"  ? "text-green-600 bg-green-500/10"
                                : "text-green-600 bg-green-500/10";

                              return (
                              <div
                                key={p.id}
                                className={`flex items-stretch border-l-2 transition-colors ${
                                  i === currentProblemIndex ? "bg-primary/5 border-l-primary" :
                                  generatedIds.has(p.id) ? "bg-sky-500/5 border-l-sky-400" :
                                  needsRetry ? "bg-amber-500/5 border-l-amber-400" :
                                  "border-l-transparent"
                                }`}
                              >
                                {/* Clickable main area */}
                                <button
                                  onClick={() => { jumpToIndex(i); setListOpen(false); }}
                                  className="flex-1 text-left px-4 py-3 hover:bg-muted/40 transition-colors min-w-0"
                                >
                                  {/* Row 1: Q number + exam likelihood + tags */}
                                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                    <span className={`text-xs font-bold tabular-nums shrink-0 ${
                                      i === currentProblemIndex ? "text-primary" : "text-muted-foreground"
                                    }`}>
                                      Q{i + 1}
                                    </span>
                                    {p.exam_likelihood != null && (
                                      <span
                                        title={`Exam likelihood: ${p.exam_likelihood}/5`}
                                        className={`text-[10px] font-bold ${
                                          p.exam_likelihood >= 5 ? "text-red-500" :
                                          p.exam_likelihood >= 4 ? "text-orange-500" :
                                          p.exam_likelihood >= 3 ? "text-yellow-500" :
                                          "text-muted-foreground/40"
                                        }`}
                                      >
                                        {"●".repeat(Math.max(1, p.exam_likelihood))}
                                      </span>
                                    )}
                                    {p.difficulty && (
                                      <span className="text-xs text-amber-500">{"★".repeat(p.difficulty)}</span>
                                    )}
                                    {generatedIds.has(p.id) && (
                                      <span className="text-xs font-semibold text-sky-600 bg-sky-500/15 px-1.5 py-0.5 rounded-full">✦ AI Generated</span>
                                    )}
                                    {needsRetry && !generatedIds.has(p.id) && (
                                      <span className="text-xs font-semibold text-amber-600 bg-amber-500/15 px-1.5 py-0.5 rounded-full">⟳ Retry</span>
                                    )}
                                    {p.is_exam_overlap && (
                                      <span className="text-xs font-semibold text-red-600 bg-red-500/15 px-1.5 py-0.5 rounded-full">Past Exam</span>
                                    )}
                                  </div>

                                  {/* Concepts */}
                                  {p.concepts.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                      {p.concepts.slice(0, 3).map((c, ci) => (
                                        <span key={ci} className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{c}</span>
                                      ))}
                                    </div>
                                  )}
                                </button>

                                {/* Tried toggle — separate column, not nested in button */}
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => toggleTried(p.id)}
                                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleTried(p.id); }}
                                  title={triedIds.has(p.id) ? "Mark as not tried" : "Mark as tried"}
                                  className={`shrink-0 flex flex-col items-center justify-center gap-1 w-12 cursor-pointer transition-colors border-l border-border/30 ${checkboxColor}`}
                                >
                                  {triedIds.has(p.id)
                                    ? <CheckSquare className="h-4 w-4" />
                                    : <Square className="h-4 w-4" />
                                  }
                                  {(ratingHistory.get(p.id)?.length ?? 0) > 0 && (
                                    <div className="flex flex-col items-center gap-px">
                                      {(ratingHistory.get(p.id) ?? []).slice(0, 3).map((r, j) => (
                                        <Check key={j} className={`h-2.5 w-2.5 ${
                                          r === "again" ? "text-red-500" :
                                          r === "hard"  ? "text-orange-500" :
                                          r === "good"  ? "text-blue-500" :
                                                          "text-green-500"
                                        }`} />
                                      ))}
                                      {(ratingHistory.get(p.id)?.length ?? 0) > 3 && (
                                        <span className="text-[9px] text-muted-foreground">+{(ratingHistory.get(p.id)?.length ?? 0) - 3}</span>
                                      )}
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
                <SheetTrigger
                  render={<Button variant="outline" size="sm" className="gap-1.5 text-xs" />}
                >
                  <BookPlus className="h-3.5 w-3.5" />
                  Materials
                </SheetTrigger>
                <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-0">
                  <SheetHeader className="p-4 border-b border-border">
                    <SheetTitle>Supplementary Materials</SheetTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Add past exams, professor notes, or study guides. New Cues will reflect them.
                    </p>
                  </SheetHeader>
                  <div className="p-4">
                    <SupplementaryUpload documentId={documentId} />
                  </div>
                </SheetContent>
              </Sheet>
            )}
            <StudyTimer
              isRunning={!rating}
              onTick={setTimerSeconds}
            />
          </div>
        </div>

        {/* Main split layout */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Left: Problem */}
          <div className="space-y-4">
            <Card className="min-h-64">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-base">{t("problem")} {currentProblemIndex + 1}</CardTitle>
                    {generatedIds.has(currentProblem.id) && (
                      <Badge variant="outline" className="text-xs font-bold border-0 bg-sky-500/10 text-sky-600">
                        ✦ AI Generated
                      </Badge>
                    )}
                    {currentNeedsRetry && (
                      <Badge variant="outline" className="text-xs font-bold border-0 bg-amber-500/10 text-amber-600">
                        ⟳ Retry
                      </Badge>
                    )}
                    {currentProblem.exam_likelihood != null && currentProblem.exam_likelihood >= 4 && (
                      <Badge
                        variant="outline"
                        className={`text-xs font-bold border-0 ${
                          currentProblem.exam_likelihood >= 5
                            ? "bg-red-500/10 text-red-600"
                            : "bg-orange-500/10 text-orange-600"
                        }`}
                      >
                        🎯 Exam Focus
                      </Badge>
                    )}
                    {currentProblem.is_exam_overlap && (
                      <Badge variant="outline" className="text-xs font-bold border-0 bg-purple-500/10 text-purple-600">
                        📋 Past Exam
                      </Badge>
                    )}
                  </div>
                  {currentProblem.concepts.length > 0 && (
                    <div className="flex gap-1 flex-wrap justify-end">
                      {currentProblem.concepts.slice(0, 3).map((c, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{c}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <MathContent className="text-base leading-relaxed">
                  {currentProblem.content}
                </MathContent>

                {/* Source location */}
                {(documentTitle || currentProblem.section || currentProblem.page || currentProblem.problem_number) && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground/60">
                    {documentTitle && <span className="font-medium">{documentTitle}</span>}
                    {currentProblem.section && <><span>·</span><span>{currentProblem.section}</span></>}
                    {currentProblem.page && <><span>·</span><span>p.{currentProblem.page}</span></>}
                    {currentProblem.problem_number && <><span>·</span><span>#{currentProblem.problem_number}</span></>}
                  </div>
                )}

                {/* Tried checkbox */}
                <div className="mt-4 pt-3 border-t border-border/40 flex items-center gap-3">
                  <button
                    onClick={() => toggleTried(currentProblem.id)}
                    className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                      triedIds.has(currentProblem.id)
                        ? "text-green-600"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {triedIds.has(currentProblem.id)
                      ? <CheckSquare className="h-3.5 w-3.5" />
                      : <Square className="h-3.5 w-3.5" />
                    }
                    {triedIds.has(currentProblem.id) ? "Tried" : "Mark as tried"}
                  </button>
                  {(ratingHistory.get(currentProblem.id)?.length ?? 0) > 0 && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {(ratingHistory.get(currentProblem.id) ?? []).map((r, j) => (
                        <Check key={j} className={`h-3 w-3 ${
                          r === "again" ? "text-red-500" :
                          r === "hard"  ? "text-orange-500" :
                          r === "good"  ? "text-blue-500" :
                                          "text-green-500"
                        }`} />
                      ))}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Difficulty rating */}
            <div className="space-y-3">
              {!rating ? (
                <>
                  <p className="text-xs text-muted-foreground text-center font-medium uppercase tracking-wide">
                    How did it go?
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {(["again", "hard", "good", "easy"] as const).map((r) => (
                      <Button
                        key={r}
                        variant="outline"
                        size="sm"
                        className={`flex flex-col h-auto py-2 gap-0.5 ${RATING[r].className}`}
                        onClick={() => handleRate(r)}
                      >
                        <span className="font-bold text-sm">{RATING[r].label}</span>
                        <span className="text-[10px] opacity-70 font-normal">{RATING[r].desc}</span>
                      </Button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  {/* Rating result */}
                  <div className={`flex items-center justify-between p-3 rounded-lg text-sm font-medium border ${
                    rating === "again" ? "bg-red-500/10 text-red-600 border-red-500/20" :
                    rating === "hard"  ? "bg-orange-500/10 text-orange-600 border-orange-500/20" :
                    rating === "good"  ? "bg-blue-500/10 text-blue-600 border-blue-500/20" :
                                         "bg-green-500/10 text-green-600 border-green-500/20"
                  }`}>
                    <span>{RATING[rating].label} — {RATING[rating].desc}</span>
                    {!RATING[rating].isCorrect && (
                      <span className="text-xs opacity-70">Review again</span>
                    )}
                  </div>
                  {/* Feedback (only for Again/Hard) */}
                  {feedback && (
                    <div className="p-3 rounded-lg bg-muted/60 border border-border/40 text-sm space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wide">
                        <AlertTriangle className="h-3 w-3" />
                        {t("feedback")}
                      </div>
                      <p className="text-foreground leading-relaxed">{feedback}</p>
                    </div>
                  )}
                  {/* Auto-suggest similar after 2× Again */}
                  {showSuggestSimilar && similarAdded === null && (
                    <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20 space-y-2">
                      <p className="text-xs text-sky-700 font-medium">
                        You&apos;ve struggled with this twice — practice more like it?
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs"
                        onClick={handleGenerateSimilar}
                        disabled={generatingSimilar}
                      >
                        {generatingSimilar
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <CopyPlus className="h-3 w-3" />
                        }
                        {generatingSimilar ? "Generating..." : "Generate Similar Questions"}
                      </Button>
                    </div>
                  )}
                  {similarAdded !== null && (
                    <p className="text-xs text-green-600 font-medium">+{similarAdded} questions added to session</p>
                  )}
                </>
              )}

              {/* Always-visible Prev / Next navigation */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={prevProblem}
                  disabled={currentProblemIndex === 0}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1 justify-center"
                  onClick={handleNext}
                >
                  {currentProblemIndex === problems.length - 1 ? "Finish" : "Next"}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Generate Similar (manual, always available) */}
              {!showSuggestSimilar && (
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleGenerateSimilar}
                    disabled={generatingSimilar}
                    className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {generatingSimilar
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <CopyPlus className="h-3.5 w-3.5" />
                    }
                    {generatingSimilar ? "Generating..." : "Generate Similar Questions"}
                  </Button>
                  {similarAdded !== null && (
                    <span className="text-xs text-green-600 font-medium">+{similarAdded} added</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: Cue panel */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Cue Panel
              </h2>
              <div className="flex items-center gap-2">
                {loadingCues && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {!loadingCues && currentProblem && (
                  <button
                    onClick={async () => {
                      // Delete cached cues so they regenerate in English
                      const { createClient } = await import("@/lib/supabase/client");
                      const sb = createClient();
                      await sb.from("cues").delete().eq("problem_id", currentProblem.id);
                      await loadCues(currentProblem);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                    title="Delete cached cues and regenerate"
                  >
                    Regenerate
                  </button>
                )}
              </div>
            </div>
            <Separator />
            {!loadingCues && <CueReveal cues={cues} />}
          </div>
        </div>
      </main>
    </div>
  );
}

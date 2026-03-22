"use client";

import { useEffect, useState, use } from "react";
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
  CheckCircle2, XCircle, ChevronLeft, ChevronRight,
  Trophy, AlertTriangle, Loader2
} from "lucide-react";
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

  const { problems, currentProblemIndex, nextProblem, prevProblem, setProblems } = useStudyStore();
  const { cues, setCues, resetCues, revealedLevel } = useCueStore();

  const [loading, setLoading] = useState(true);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [answered, setAnswered] = useState<"correct" | "incorrect" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [score, setScore] = useState<ScoreData | null>(null);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [loadingCues, setLoadingCues] = useState(false);

  const currentProblem: Problem | undefined = problems[currentProblemIndex];

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
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Load cues when problem changes
  useEffect(() => {
    if (!currentProblem) return;
    resetCues();
    setAnswered(null);
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

  async function handleAnswer(isCorrect: boolean) {
    if (!currentProblem || answered) return;
    setAnswered(isCorrect ? "correct" : "incorrect");

    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        problemId: currentProblem.id,
        problemContent: currentProblem.content,
        isCorrect,
        timeSpent: timerSeconds,
        cuesUsed: revealedLevel,
        mistakeType: isCorrect ? null : "오답",
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setFeedback(data.feedback);
      setScore(data.score);
    }
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

  if (sessionComplete && score) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 py-12 text-center space-y-8">
          <div>
            <Trophy className="h-16 w-16 text-primary mx-auto mb-4" />
            <h1 className="text-3xl font-black">{t("sessionComplete")}</h1>
          </div>
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
          <Button size="lg" onClick={() => router.push(`/${locale}/dashboard`)}>
            대시보드로 돌아가기
          </Button>
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
          <StudyTimer
            isRunning={!answered}
            onTick={setTimerSeconds}
          />
        </div>

        {/* Main split layout */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Left: Problem */}
          <div className="space-y-4">
            <Card className="min-h-64">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{t("problem")} {currentProblemIndex + 1}</CardTitle>
                  {currentProblem.concepts.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {currentProblem.concepts.slice(0, 3).map((c, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{c}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-base leading-relaxed whitespace-pre-wrap">
                  {currentProblem.content}
                </p>
              </CardContent>
            </Card>

            {/* Answer buttons */}
            {!answered ? (
              <div className="grid grid-cols-2 gap-3">
                <Button
                  size="lg"
                  variant="outline"
                  className="gap-2 border-green-500/30 hover:bg-green-500/10 hover:text-green-600"
                  onClick={() => handleAnswer(true)}
                >
                  <CheckCircle2 className="h-5 w-5" />
                  {t("correct")}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="gap-2 border-red-500/30 hover:bg-red-500/10 hover:text-red-600"
                  onClick={() => handleAnswer(false)}
                >
                  <XCircle className="h-5 w-5" />
                  {t("incorrect")}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Result */}
                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm font-medium ${
                  answered === "correct"
                    ? "bg-green-500/10 text-green-600 border border-green-500/20"
                    : "bg-red-500/10 text-red-600 border border-red-500/20"
                }`}>
                  {answered === "correct" ? (
                    <><CheckCircle2 className="h-4 w-4" /> 정답입니다! 🎉</>
                  ) : (
                    <><XCircle className="h-4 w-4" /> 오답입니다</>
                  )}
                </div>

                {/* Score Loop Feedback */}
                {feedback && (
                  <div className="p-3 rounded-lg bg-muted/60 border border-border/40 text-sm space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wide">
                      <AlertTriangle className="h-3 w-3" />
                      {t("feedback")}
                    </div>
                    <p className="text-foreground leading-relaxed">{feedback}</p>
                  </div>
                )}

                {/* Navigation */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={prevProblem}
                    disabled={currentProblemIndex === 0}
                    className="gap-1"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button className="flex-1 gap-1" onClick={handleNext}>
                    {currentProblemIndex === problems.length - 1 ? "세션 완료" : "다음 문제"}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Right: Cue panel */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Cue Panel
              </h2>
              {loadingCues && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <Separator />
            {!loadingCues && <CueReveal cues={cues} />}
          </div>
        </div>
      </main>
    </div>
  );
}

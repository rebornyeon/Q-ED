import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { Navbar } from "@/components/navbar";
import { ScoreRadar } from "@/components/score-radar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Upload, BookOpen, Flame, Trophy,
  Target, Zap, Brain, Shield, TrendingUp
} from "lucide-react";
import type { ScoreData, Document as Doc } from "@/types";

const DEFAULT_SCORE: ScoreData = {
  accuracy: 0,
  speed: 0,
  pattern_recognition: 0,
  trap_avoidance: 0,
  thinking_depth: 0,
};

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("dashboard");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  // Fetch user profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // Fetch recent documents
  const { data: documents } = await supabase
    .from("documents")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);

  // Fetch attempt stats
  const { data: attempts } = await supabase
    .from("attempt_logs")
    .select("is_correct, time_spent, cues_used")
    .eq("user_id", user.id);

  // Fetch session count
  const { count: sessionCount } = await supabase
    .from("study_sessions")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  // Calculate score
  let score: ScoreData = DEFAULT_SCORE;
  if (attempts && attempts.length > 0) {
    const correct = attempts.filter((a) => a.is_correct).length;
    const avgTime = attempts.reduce((s, a) => s + a.time_spent, 0) / attempts.length;
    const avgCues = attempts.reduce((s, a) => s + a.cues_used, 0) / attempts.length;
    score = {
      accuracy: Math.round((correct / attempts.length) * 100),
      speed: Math.max(0, Math.round(100 - (avgTime / 300) * 100)),
      pattern_recognition: Math.round(Math.max(0, 100 - avgCues * 20)),
      trap_avoidance: Math.round((correct / attempts.length) * 90 + 10),
      thinking_depth: Math.round(Math.min(100, avgCues * 25)),
    };
  }

  const userName = profile?.display_name || user.email;
  const totalAttempts = attempts?.length ?? 0;
  const correctAttempts = attempts?.filter((a) => a.is_correct).length ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar userEmail={user.email} userName={profile?.display_name} />

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Welcome */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">
              {t("welcome")} {userName?.split("@")[0]} 👋
            </h1>
            <p className="text-muted-foreground mt-1">오늘도 핵심만 공부합시다</p>
          </div>
          <Link href={`/${locale}/upload`}>
            <Button className="gap-2">
              <Upload className="h-4 w-4" />
              PDF 업로드
            </Button>
          </Link>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: t("totalProblems"), value: totalAttempts, icon: <Target className="h-4 w-4" /> },
            { label: t("solvedProblems"), value: correctAttempts, icon: <Trophy className="h-4 w-4" /> },
            { label: t("studySessions"), value: sessionCount ?? 0, icon: <BookOpen className="h-4 w-4" /> },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  {stat.icon}
                  <span className="text-xs font-medium uppercase tracking-wide">{stat.label}</span>
                </div>
                <div className="text-3xl font-black">{stat.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Score Radar */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                Score & Thinking Radar
              </CardTitle>
              <CardDescription>
                {totalAttempts === 0 ? "학습을 시작하면 레이더가 채워집니다" : `${totalAttempts}개 문제 기반`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScoreRadar score={score} size={280} />
              {/* Score breakdown */}
              <div className="mt-4 space-y-2">
                {[
                  { label: t("accuracy"), value: score.accuracy, icon: <Target className="h-3 w-3" /> },
                  { label: t("speed"), value: score.speed, icon: <Zap className="h-3 w-3" /> },
                  { label: t("pattern"), value: score.pattern_recognition, icon: <TrendingUp className="h-3 w-3" /> },
                  { label: t("trapAvoid"), value: score.trap_avoidance, icon: <Shield className="h-3 w-3" /> },
                  { label: t("thinking"), value: score.thinking_depth, icon: <Brain className="h-3 w-3" /> },
                ].map((s) => (
                  <div key={s.label} className="flex items-center gap-2">
                    <span className="text-muted-foreground w-4">{s.icon}</span>
                    <span className="text-xs text-muted-foreground w-20 shrink-0">{s.label}</span>
                    <Progress value={s.value} className="flex-1 h-1.5" />
                    <span className="text-xs font-mono w-8 text-right">{s.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Recent documents */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                {t("recentDocs")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!documents || documents.length === 0 ? (
                <div className="text-center py-10">
                  <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-30" />
                  <p className="text-sm text-muted-foreground mb-4">{t("noDocuments")}</p>
                  <Link href={`/${locale}/upload`}>
                    <Button size="sm" variant="outline">{t("uploadFirst")}</Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-1">
                  {(documents as Doc[]).map((doc, i) => {
                    const analysis = doc.analysis;
                    const hotConcepts = analysis?.concepts?.filter((c) => c.is_hot).slice(0, 2) ?? [];

                    return (
                      <div key={doc.id}>
                        {i > 0 && <Separator className="my-2" />}
                        <div className="py-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{doc.title}</p>
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {hotConcepts.map((c, j) => (
                                  <Badge key={j} variant="secondary" className="text-xs gap-0.5">
                                    <Flame className="h-2.5 w-2.5" />
                                    {c.name}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <Link href={`/${locale}/study`}>
                              <Button size="sm" variant="outline" className="shrink-0 text-xs h-7">
                                {t("startStudy")}
                              </Button>
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Cue type legend */}
        <Card className="bg-muted/30">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap gap-6 justify-center text-sm">
              {[
                { emoji: "🎯", label: "Kill Shot Cue", desc: "풀이 종결" },
                { emoji: "⚠️", label: "Trap Cue", desc: "함정 방지" },
                { emoji: "🔁", label: "Pattern Cue", desc: "구조 도식화" },
                { emoji: "🚀", label: "Speed Cue", desc: "시간 단축" },
              ].map((c) => (
                <div key={c.label} className="flex items-center gap-2">
                  <span>{c.emoji}</span>
                  <span className="font-medium">{c.label}</span>
                  <span className="text-muted-foreground text-xs">— {c.desc}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

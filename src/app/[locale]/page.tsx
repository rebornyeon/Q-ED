import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, Target, BarChart3, ChevronRight, Brain } from "lucide-react";

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("landing");
  const tc = await getTranslations("common");
  const tn = await getTranslations("nav");

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl font-black tracking-tighter">Q:ED</span>
            <Badge variant="secondary" className="text-xs">Beta</Badge>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/${locale}/login`}>
              <Button variant="ghost" size="sm">{tn("login")}</Button>
            </Link>
            <Link href={`/${locale}/signup`}>
              <Button size="sm">{tn("signup")}</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 pt-24 pb-16 text-center">
        <Badge className="mb-6 text-xs px-3 py-1" variant="outline">
          🔥 High-Efficiency Math Learning Engine
        </Badge>
        <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-6 leading-tight">
          Q<span className="text-muted-foreground">:</span>ED
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-4 leading-relaxed">
          {t("hero")}
        </p>
        <p className="text-sm text-muted-foreground/70 mb-10 italic">
          &ldquo;{tc("appTagline")}&rdquo;
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link href={`/${locale}/signup`}>
            <Button size="lg" className="gap-2 text-base px-8">
              {t("cta")} <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href={`/${locale}/login`}>
            <Button size="lg" variant="outline" className="text-base px-8">
              {tn("login")}
            </Button>
          </Link>
        </div>
      </section>

      {/* Taglines */}
      <section className="border-y border-border/40 bg-muted/30 py-6">
        <div className="max-w-6xl mx-auto px-4 flex flex-wrap justify-center gap-8">
          {[t("tagline1"), t("tagline2"), t("tagline3")].map((tag, i) => (
            <div key={i} className="flex items-center gap-2 text-sm font-medium">
              <span className="text-base">{["📌", "🎯", "🔒"][i]}</span>
              {tag}
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              icon: <Target className="h-6 w-6" />,
              title: t("feature1Title"),
              desc: t("feature1Desc"),
              badge: "🔥 High Frequency · ⚠️ Trap Points · 💯 Key Concepts",
            },
            {
              icon: <Brain className="h-6 w-6" />,
              title: t("feature2Title"),
              desc: t("feature2Desc"),
              badge: "Thinking → Soft → Strategy → Kill Shot",
            },
            {
              icon: <BarChart3 className="h-6 w-6" />,
              title: t("feature3Title"),
              desc: t("feature3Desc"),
              badge: "Score & Thinking Radar",
            },
          ].map((f, i) => (
            <div
              key={i}
              className="p-6 rounded-xl border border-border/60 bg-card hover:border-border transition-colors"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4">
                {f.icon}
              </div>
              <h3 className="font-bold text-lg mb-2">{f.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed mb-4">{f.desc}</p>
              <code className="text-xs bg-muted px-2 py-1 rounded text-muted-foreground">
                {f.badge}
              </code>
            </div>
          ))}
        </div>
      </section>

      {/* Cue Types */}
      <section className="border-t border-border/40 bg-muted/20 py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-center text-2xl font-black tracking-tight mb-10">
            4 Cue Types
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { emoji: "🎯", name: "Kill Shot Cue", desc: "The decisive key that closes the solution" },
              { emoji: "⚠️", name: "Trap Cue", desc: "Prevent the traps that lead to wrong answers" },
              { emoji: "🔁", name: "Pattern Cue", desc: "Diagramming recurring problem structures" },
              { emoji: "🚀", name: "Speed Cue", desc: "Real-world tips to cut solve time" },
            ].map((cue, i) => (
              <div key={i} className="p-4 rounded-lg border border-border/60 bg-card text-center">
                <div className="text-3xl mb-2">{cue.emoji}</div>
                <div className="font-bold text-sm mb-1">{cue.name}</div>
                <div className="text-xs text-muted-foreground">{cue.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-4 py-20 text-center">
        <h2 className="text-3xl font-black tracking-tight mb-4">
          Start right now
        </h2>
        <p className="text-muted-foreground mb-8">Upload a PDF and your study session begins instantly</p>
        <Link href={`/${locale}/signup`}>
          <Button size="lg" className="gap-2 text-base px-10">
            <Zap className="h-4 w-4" />
            {t("cta")}
          </Button>
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 py-8">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between text-sm text-muted-foreground">
          <span className="font-black">Q:ED</span>
          <span>Start with scores. End with mastery.</span>
        </div>
      </footer>
    </div>
  );
}

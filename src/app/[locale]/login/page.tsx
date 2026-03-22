"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2 } from "lucide-react";

type View = "login" | "forgot";

export default function LoginPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const supabase = createClient();

  const [view, setView] = useState<View>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push(`/${locale}/dashboard`);
      router.refresh();
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/${locale}/reset-password`,
    });

    if (error) {
      setError(error.message);
    } else {
      setResetSent(true);
    }
    setLoading(false);
  }

  if (view === "forgot") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <Link href={`/${locale}`} className="text-2xl font-black tracking-tighter">Q:ED</Link>
          </div>
          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl font-bold">{t("forgotPassword")}</CardTitle>
              <CardDescription>이메일로 비밀번호 재설정 링크를 보내드립니다</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {resetSent ? (
                <div className="text-center py-4 space-y-3">
                  <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
                  <p className="text-sm font-medium">이메일을 확인하세요</p>
                  <p className="text-xs text-muted-foreground">{email}로 재설정 링크를 보냈습니다</p>
                  <Button variant="outline" className="w-full mt-2" onClick={() => { setView("login"); setResetSent(false); }}>
                    로그인으로 돌아가기
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-email">{t("email")}</Label>
                    <Input
                      id="reset-email"
                      type="email"
                      placeholder={t("emailPlaceholder")}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={loading}
                    />
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    재설정 링크 전송
                  </Button>
                  <Button type="button" variant="ghost" className="w-full" onClick={() => setView("login")}>
                    {tc("back")}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href={`/${locale}`} className="text-2xl font-black tracking-tighter">Q:ED</Link>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold">{t("loginTitle")}</CardTitle>
            <CardDescription>{tc("appTagline")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleLogin} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">{t("email")}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">{t("password")}</Label>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-primary underline-offset-2 hover:underline"
                    onClick={() => { setError(null); setView("forgot"); }}
                  >
                    {t("forgotPassword")}
                  </button>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder={t("passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("loginButton")}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              {t("noAccount")}{" "}
              <Link href={`/${locale}/signup`} className="text-primary hover:underline font-medium">
                {tn("signup")}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

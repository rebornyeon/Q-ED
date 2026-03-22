"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CheckCircle2 } from "lucide-react";

export default function ResetPasswordPage() {
  const locale = useLocale();
  const router = useRouter();
  const supabase = createClient();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("비밀번호가 일치하지 않습니다"); return; }
    if (password.length < 6) { setError("비밀번호는 최소 6자 이상이어야 합니다"); return; }

    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setError(error.message); setLoading(false); return; }

    setDone(true);
    setTimeout(() => router.push(`/${locale}/dashboard`), 2000);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href={`/${locale}`} className="text-2xl font-black tracking-tighter">Q:ED</Link>
        </div>
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold">새 비밀번호 설정</CardTitle>
            <CardDescription>새로운 비밀번호를 입력하세요</CardDescription>
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="text-center py-4 space-y-2">
                <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
                <p className="font-medium">비밀번호가 변경되었습니다</p>
                <p className="text-xs text-muted-foreground">잠시 후 대시보드로 이동합니다...</p>
              </div>
            ) : (
              <form onSubmit={handleReset} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">새 비밀번호</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="최소 6자 이상"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">비밀번호 확인</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="비밀번호를 다시 입력하세요"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  비밀번호 변경
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

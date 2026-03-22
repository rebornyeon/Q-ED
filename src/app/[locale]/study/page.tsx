import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Upload, Clock } from "lucide-react";
import type { StudySession } from "@/types";

export default async function StudyListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("study");
  const td = await getTranslations("dashboard");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const { data: sessions } = await supabase
    .from("study_sessions")
    .select("*, documents(title, created_at)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="min-h-screen bg-background">
      <Navbar userEmail={user.email} />

      <main className="max-w-4xl mx-auto px-4 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-black tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-1">진행 중인 학습 세션 목록</p>
          </div>
          <Link href={`/${locale}/upload`}>
            <Button className="gap-2">
              <Upload className="h-4 w-4" />
              새 PDF 업로드
            </Button>
          </Link>
        </div>

        {!sessions || sessions.length === 0 ? (
          <Card className="text-center py-16">
            <CardContent>
              <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-40" />
              <p className="font-medium text-lg mb-1">{td("noDocuments")}</p>
              <p className="text-sm text-muted-foreground mb-6">{td("uploadFirst")}</p>
              <Link href={`/${locale}/upload`}>
                <Button>{td("uploadFirst")}</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {(sessions as (StudySession & { documents: { title: string; created_at: string } })[]).map((session) => (
              <Card key={session.id} className="hover:border-border transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">{session.documents?.title}</CardTitle>
                      <CardDescription className="flex items-center gap-1.5 mt-1">
                        <Clock className="h-3 w-3" />
                        {new Date(session.created_at).toLocaleDateString(
                          locale === "ko" ? "ko-KR" : "en-US",
                          { year: "numeric", month: "short", day: "numeric" }
                        )}
                      </CardDescription>
                    </div>
                    <Badge variant={session.status === "completed" ? "secondary" : "default"}>
                      {session.status === "completed" ? "완료" : "진행 중"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <Link href={`/${locale}/study/${session.id}`}>
                    <Button size="sm" variant={session.status === "completed" ? "outline" : "default"}>
                      {session.status === "completed" ? "복습하기" : td("startStudy")}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

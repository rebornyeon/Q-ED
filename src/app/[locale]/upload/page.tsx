"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useDropzone } from "react-dropzone";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, FileText, CheckCircle2, AlertCircle, Flame, AlertTriangle, Trophy } from "lucide-react";
import type { DocumentAnalysis } from "@/types";

type UploadStep = "idle" | "uploading" | "analyzing" | "done" | "error";

export default function UploadPage() {
  const t = useTranslations("upload");
  const locale = useLocale();
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [step, setStep] = useState<UploadStep>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) {
      setFile(accepted[0]);
      setTitle(accepted[0].name.replace(".pdf", ""));
      setError(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    maxSize: 50 * 1024 * 1024,
    onDropRejected: () => setError("PDF 파일만 업로드 가능합니다 (최대 50MB)"),
  });

  async function handleUpload() {
    if (!file || !title.trim()) return;

    setStep("uploading");
    setProgress(20);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title.trim());

    setStep("analyzing");
    setProgress(50);

    const res = await fetch("/api/analyze", { method: "POST", body: formData });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || t("error" as never));
      setStep("error");
      return;
    }

    setProgress(90);
    const data = await res.json();
    setAnalysis(data.analysis);
    setDocumentId(data.document.id);
    setProgress(100);
    setStep("done");
  }

  async function handleStartStudy() {
    if (!documentId) return;

    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId }),
    });

    if (res.ok) {
      const data = await res.json();
      router.push(`/${locale}/study/${data.session.id}`);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-black tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>

        {step === "idle" || step === "error" ? (
          <div className="space-y-6">
            {/* Dropzone */}
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
                isDragActive
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/30"
              }`}
            >
              <input {...getInputProps()} />
              {file ? (
                <div className="flex flex-col items-center gap-3">
                  <FileText className="h-12 w-12 text-primary" />
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                  <Badge variant="secondary">PDF</Badge>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Upload className="h-12 w-12 text-muted-foreground" />
                  <p className="font-medium">
                    {isDragActive ? t("dropzoneActive") : t("dropzone")}
                  </p>
                  <p className="text-sm text-muted-foreground">{t("maxSize")}</p>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="title">{t("titleLabel")}</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("titlePlaceholder")}
              />
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={handleUpload}
              disabled={!file || !title.trim()}
            >
              {t("analyzeButton")}
            </Button>
          </div>
        ) : step === "uploading" || step === "analyzing" ? (
          <Card>
            <CardContent className="pt-8 pb-8 text-center space-y-6">
              <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
              <div>
                <p className="font-bold text-lg">{t("analyzing")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Gemini AI가 핵심 개념과 문제 유형을 분석하고 있습니다...
                </p>
              </div>
              <Progress value={progress} className="max-w-sm mx-auto" />
            </CardContent>
          </Card>
        ) : step === "done" && analysis ? (
          <div className="space-y-6">
            {/* Success Header */}
            <div className="flex items-center gap-3 text-green-600">
              <CheckCircle2 className="h-6 w-6" />
              <span className="font-bold text-lg">{t("uploadSuccess")}</span>
            </div>

            {/* Analysis Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">분석 결과</CardTitle>
                <CardDescription>
                  총 {analysis.total_problems}개 문제 · {analysis.concepts.length}개 핵심 개념 발견
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Concepts */}
                <div>
                  <p className="text-sm font-medium mb-3">핵심 개념</p>
                  <div className="flex flex-wrap gap-2">
                    {analysis.concepts.map((concept, i) => (
                      <Badge
                        key={i}
                        variant={concept.is_hot ? "default" : concept.is_trap ? "destructive" : "secondary"}
                        className="gap-1"
                      >
                        {concept.is_hot && <Flame className="h-3 w-3" />}
                        {concept.is_trap && <AlertTriangle className="h-3 w-3" />}
                        {concept.is_key && <Trophy className="h-3 w-3" />}
                        {concept.name}
                        <span className="opacity-60">×{concept.frequency}</span>
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Legend */}
                <div className="flex gap-4 text-xs text-muted-foreground pt-2 border-t border-border/40">
                  <span className="flex items-center gap-1"><Flame className="h-3 w-3" /> 자주 출제</span>
                  <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-destructive" /> 자주 틀림</span>
                  <span className="flex items-center gap-1"><Trophy className="h-3 w-3" /> 고득점 핵심</span>
                </div>
              </CardContent>
            </Card>

            <Button className="w-full" size="lg" onClick={handleStartStudy}>
              🚀 학습 시작하기
            </Button>
          </div>
        ) : null}
      </main>
    </div>
  );
}

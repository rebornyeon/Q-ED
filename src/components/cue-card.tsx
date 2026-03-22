"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Cue, CueType } from "@/types";

const CUE_META: Record<CueType, { emoji: string; color: string; labelKey: string }> = {
  kill_shot: { emoji: "🎯", color: "text-orange-500", labelKey: "killShot" },
  trap: { emoji: "⚠️", color: "text-red-500", labelKey: "trap" },
  pattern: { emoji: "🔁", color: "text-blue-500", labelKey: "pattern" },
  speed: { emoji: "🚀", color: "text-green-500", labelKey: "speed" },
};

const LEVEL_LABELS = ["", "cueLevel1", "cueLevel2", "cueLevel3", "cueLevel4"] as const;

interface CueCardProps {
  cue: Cue;
  showWhy: boolean;
  onToggleWhy: () => void;
}

export function CueCard({ cue, showWhy, onToggleWhy }: CueCardProps) {
  const t = useTranslations("study");
  const meta = CUE_META[cue.cue_type];

  return (
    <Card className="border-border/60 bg-card/80 backdrop-blur">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{meta.emoji}</span>
            <Badge variant="outline" className={`text-xs ${meta.color}`}>
              {t(meta.labelKey as "killShot" | "trap" | "pattern" | "speed")}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              Level {cue.cue_level} · {t(LEVEL_LABELS[cue.cue_level] as "cueLevel1" | "cueLevel2" | "cueLevel3" | "cueLevel4")}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed font-medium">{cue.content}</p>

        {cue.why_explanation && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
              onClick={onToggleWhy}
            >
              {showWhy ? "▼" : "▶"} {t("whyTitle")}
            </Button>
            {showWhy && (
              <>
                <Separator />
                <p className="text-xs text-muted-foreground leading-relaxed pl-2 border-l-2 border-primary/30">
                  {cue.why_explanation}
                </p>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

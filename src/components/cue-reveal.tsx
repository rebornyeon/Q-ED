"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CueCard } from "./cue-card";
import { useCueStore } from "@/stores/cue-store";
import { Lightbulb } from "lucide-react";
import type { Cue } from "@/types";

interface CueRevealProps {
  cues: Cue[];
}

export function CueReveal({ cues }: CueRevealProps) {
  const t = useTranslations("study");
  const { revealedLevel, revealNextLevel, showWhy, toggleWhy } = useCueStore();

  const visibleCues = cues.filter((c) => c.cue_level <= revealedLevel);
  const hasMore = revealedLevel < 4 && cues.some((c) => c.cue_level > revealedLevel);
  const progressPercent = (revealedLevel / 4) * 100;

  return (
    <div className="space-y-4">
      {/* Cue progress */}
      <div className="flex items-center gap-3">
        <Lightbulb className="h-4 w-4 text-primary shrink-0" />
        <Progress value={progressPercent} className="flex-1 h-1.5" />
        <span className="text-xs text-muted-foreground shrink-0">
          {revealedLevel}/4
        </span>
      </div>

      {/* Revealed cues */}
      {visibleCues.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Lightbulb className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Cue를 하나씩 공개하며 스스로 생각해보세요</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleCues.map((cue) => (
            <CueCard
              key={cue.id}
              cue={cue}
              showWhy={showWhy}
              onToggleWhy={toggleWhy}
            />
          ))}
        </div>
      )}

      {/* Reveal button */}
      {hasMore && (
        <Button
          variant="outline"
          className="w-full"
          onClick={revealNextLevel}
        >
          {revealedLevel === 0 ? t("showCue") : t("nextCue")}
          {revealedLevel === 3 && " 🎯 Kill Shot"}
        </Button>
      )}

      {!hasMore && cues.length > 0 && revealedLevel === 4 && (
        <div className="text-center text-xs text-muted-foreground pt-2">
          모든 Cue가 공개되었습니다
        </div>
      )}
    </div>
  );
}

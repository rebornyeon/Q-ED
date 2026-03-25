"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Cue, CueType } from "@/types";
import { MathContent } from "@/components/math-content";

const CUE_META: Record<CueType, { label: string; accent: string; bg: string }> = {
  understanding: { label: "Understanding", accent: "border-l-blue-500",   bg: "bg-blue-500/5" },
  kill_shot:     { label: "Kill Shot",     accent: "border-l-orange-500", bg: "bg-orange-500/5" },
  trap:          { label: "Trap",          accent: "border-l-red-500",    bg: "bg-red-500/5" },
  pattern:       { label: "Pattern",       accent: "border-l-blue-500",   bg: "bg-blue-500/5" },
  speed:         { label: "Speed",         accent: "border-l-green-500",  bg: "bg-green-500/5" },
};

const LEVEL_LABELS: Record<number, string> = {
  0: "Understanding",
  1: "Key Theorem",
  2: "Mapping",
  3: "First Step",
  4: "Solution Path",
};

interface CueCardProps {
  cue: Cue;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function CueCard({ cue, collapsed, onToggleCollapse }: CueCardProps) {
  const [showIntuition, setShowIntuition] = useState(false);
  const meta = CUE_META[cue.cue_type];
  const isTheoremLevel = cue.cue_level === 1;

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        className={`w-full border-l-3 ${meta.accent} bg-muted/30 rounded-r-lg px-4 py-2 flex items-center gap-2 text-left hover:bg-muted/50 transition-colors`}
      >
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Badge variant="outline" className="text-[10px] font-semibold px-1.5 py-0">L{cue.cue_level}</Badge>
        <span className="text-xs text-muted-foreground">{LEVEL_LABELS[cue.cue_level] ?? meta.label}</span>
        <span className="text-xs text-muted-foreground/50 truncate flex-1">&mdash; {cue.content.slice(0, 60)}...</span>
      </button>
    );
  }

  return (
    <div className={`border-l-3 ${meta.accent} ${meta.bg} rounded-r-lg px-4 py-3 space-y-2 select-text`}>
      {/* Header */}
      <div className="flex items-center gap-2 select-none">
        {onToggleCollapse && (
          <button onClick={onToggleCollapse} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        )}
        <Badge variant="outline" className="text-[10px] font-semibold px-1.5 py-0">L{cue.cue_level}</Badge>
        <span className="text-xs font-medium text-muted-foreground">{LEVEL_LABELS[cue.cue_level] ?? meta.label}</span>
        <div className="flex-1" />
        {cue.why_explanation && (
          <button
            onClick={() => setShowIntuition((v) => !v)}
            className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition-all ${
              showIntuition
                ? "bg-violet-500/10 border-violet-400/40 text-violet-600 dark:text-violet-400 font-medium"
                : "border-border/40 text-muted-foreground/60 hover:text-muted-foreground hover:border-border"
            }`}
          >
            {isTheoremLevel ? "직관" : "왜?"}
          </button>
        )}
      </div>

      <MathContent className="text-sm leading-relaxed select-text cursor-text">{cue.content}</MathContent>

      {cue.why_explanation && showIntuition && (
        <>
          <Separator className="opacity-30" />
          <div className="pl-3 border-l-2 border-violet-400/30">
            <p className="text-[10px] font-semibold text-violet-500 uppercase tracking-wide mb-1 select-none">
              {isTheoremLevel ? "이 정리가 성립하는 이유" : "왜 이 방법인가"}
            </p>
            <MathContent className="text-xs text-muted-foreground leading-relaxed select-text cursor-text">
              {cue.why_explanation}
            </MathContent>
          </div>
        </>
      )}
    </div>
  );
}

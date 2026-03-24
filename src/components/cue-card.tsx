"use client";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ChevronDown, ChevronUp, Info } from "lucide-react";
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
  1: "Approach",
  2: "Pattern",
  3: "Direction",
  4: "Kill Shot",
};

interface CueCardProps {
  cue: Cue;
  showWhy: boolean;
  onToggleWhy: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function CueCard({ cue, showWhy, onToggleWhy, collapsed, onToggleCollapse }: CueCardProps) {
  const meta = CUE_META[cue.cue_type];

  // Collapsed state — thin clickable header only
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
      {/* Header row: level badge + label + Why? (top-right) + collapse toggle */}
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
            onClick={onToggleWhy}
            className={`flex items-center gap-1 text-[11px] transition-colors ${showWhy ? "text-primary font-medium" : "text-muted-foreground/60 hover:text-muted-foreground"}`}
            title="Why does this work?"
          >
            <Info className="h-3 w-3" />
            Why?
          </button>
        )}
      </div>

      <MathContent className="text-sm leading-relaxed select-text cursor-text">{cue.content}</MathContent>

      {cue.why_explanation && showWhy && (
        <>
          <Separator className="opacity-30" />
          <MathContent className="text-xs text-muted-foreground leading-relaxed pl-3 border-l-2 border-primary/20 select-text cursor-text">
            {cue.why_explanation}
          </MathContent>
        </>
      )}
    </div>
  );
}

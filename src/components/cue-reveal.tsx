"use client";

import { useState } from "react";
import { CueCard } from "./cue-card";
import { useCueStore } from "@/stores/cue-store";
import { MathContent } from "@/components/math-content";
import { Lightbulb, ChevronDown } from "lucide-react";
import type { Cue } from "@/types";

const LEVEL_TITLES = [
  "",
  "Level 1 — Approach Strategy",
  "Level 2 — Pattern Guide",
  "Level 3 — Solution Direction",
  "Level 4 — Kill Shot",
];

interface CueRevealProps {
  cues: Cue[];
}

export function CueReveal({ cues }: CueRevealProps) {
  const { revealedLevel, revealNextLevel, showWhy, toggleWhy } = useCueStore();
  // Track which cue levels are manually expanded (latest is auto-expanded)
  const [manualExpanded, setManualExpanded] = useState<Set<number>>(new Set());

  const understandingCue = cues.find((c) => c.cue_level === 0);
  const hintCues = cues.filter((c) => c.cue_level > 0);

  const visibleCues = hintCues.filter((c) => c.cue_level <= revealedLevel);
  const nextLevel = revealedLevel + 1;
  const hasMore = nextLevel <= 4 && hintCues.some((c) => c.cue_level === nextLevel);

  function toggleCueCollapse(level: number) {
    setManualExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level); else next.add(level);
      return next;
    });
  }

  function isCueExpanded(cue: Cue): boolean {
    // Latest revealed cue is always expanded unless manually collapsed
    if (cue.cue_level === revealedLevel) return !manualExpanded.has(cue.cue_level);
    // Older cues are collapsed unless manually expanded
    return manualExpanded.has(cue.cue_level);
  }

  return (
    <div className="space-y-2">
      {understandingCue && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 px-4 py-3 mb-4 select-text">
          <div className="flex items-center gap-2 mb-1.5 select-none">
            <span className="text-xs font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400">Understanding the Question</span>
          </div>
          <MathContent className="text-sm leading-relaxed text-foreground select-text cursor-text">{understandingCue.content.replace(/^Understanding:\s*/i, "")}</MathContent>
        </div>
      )}

      {visibleCues.length === 0 && !hasMore ? (
        <div className="text-center py-6 text-muted-foreground">
          <Lightbulb className="h-8 w-8 mx-auto mb-2 opacity-15" />
          <p className="text-sm">No hints available</p>
        </div>
      ) : visibleCues.length === 0 ? (
        <button
          onClick={() => { setManualExpanded(new Set()); revealNextLevel(); }}
          className="w-full text-center py-6 text-muted-foreground hover:text-foreground group transition-colors cursor-pointer"
        >
          <Lightbulb className="h-8 w-8 mx-auto mb-2 opacity-30 group-hover:opacity-60 group-hover:text-primary transition-all" />
          <p className="text-sm font-medium mb-1">Need a nudge?</p>
          <p className="text-xs text-muted-foreground/70 group-hover:text-muted-foreground transition-colors">Click to reveal the first hint</p>
        </button>
      ) : (
        <div className="space-y-1.5">
          {visibleCues.map((cue) => (
            <CueCard
              key={cue.id}
              cue={cue}
              showWhy={showWhy}
              onToggleWhy={toggleWhy}
              collapsed={!isCueExpanded(cue)}
              onToggleCollapse={() => toggleCueCollapse(cue.cue_level)}
            />
          ))}
        </div>
      )}

      {/* Next hint teaser */}
      {hasMore && (
        <button
          onClick={() => {
            // Reset manual expansions so new cue auto-expands
            setManualExpanded(new Set());
            revealNextLevel();
          }}
          className="w-full group flex items-center gap-3 p-2.5 rounded-lg border border-dashed border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all text-left"
        >
          <div className="flex items-center justify-center h-6 w-6 rounded-full bg-muted/80 group-hover:bg-primary/10 transition-colors shrink-0">
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-muted-foreground group-hover:text-foreground transition-colors">
              {LEVEL_TITLES[nextLevel]}
            </p>
          </div>
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{revealedLevel}/4</span>
        </button>
      )}

      {!hasMore && cues.length > 0 && revealedLevel === 4 && (
        <p className="text-center text-[10px] text-muted-foreground/50 pt-1">All hints revealed</p>
      )}
    </div>
  );
}

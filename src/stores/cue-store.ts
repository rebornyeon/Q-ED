import { create } from "zustand";
import type { Cue, CueLevel } from "@/types";

interface CueState {
  cues: Cue[];
  revealedLevel: CueLevel | 0; // 0 = 아무것도 공개 안됨
  isRevealing: boolean;
  showWhy: boolean;

  setCues: (cues: Cue[]) => void;
  revealNextLevel: () => void;
  toggleWhy: () => void;
  resetCues: () => void;
}

export const useCueStore = create<CueState>((set) => ({
  cues: [],
  revealedLevel: 0,
  isRevealing: false,
  showWhy: false,

  setCues: (cues) => set({ cues, revealedLevel: 0, showWhy: false }),

  revealNextLevel: () =>
    set((state) => {
      const nextLevel = (state.revealedLevel + 1) as CueLevel;
      if (nextLevel > 4) return state;
      return { revealedLevel: nextLevel, isRevealing: false };
    }),

  toggleWhy: () => set((state) => ({ showWhy: !state.showWhy })),

  resetCues: () =>
    set({ cues: [], revealedLevel: 0, isRevealing: false, showWhy: false }),
}));

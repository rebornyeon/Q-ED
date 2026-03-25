import { create } from "zustand";
import type { Cue, CueLevel } from "@/types";

interface CueState {
  cues: Cue[];
  revealedLevel: CueLevel | 0;
  isRevealing: boolean;

  setCues: (cues: Cue[]) => void;
  revealNextLevel: () => void;
  resetCues: () => void;
}

export const useCueStore = create<CueState>((set) => ({
  cues: [],
  revealedLevel: 0,
  isRevealing: false,

  setCues: (cues) => set({ cues, revealedLevel: 0 }),

  revealNextLevel: () =>
    set((state) => {
      const nextLevel = (state.revealedLevel + 1) as CueLevel;
      if (nextLevel > 4) return state;
      return { revealedLevel: nextLevel, isRevealing: false };
    }),

  resetCues: () =>
    set({ cues: [], revealedLevel: 0, isRevealing: false }),
}));

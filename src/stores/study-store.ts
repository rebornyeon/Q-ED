import { create } from "zustand";
import type { StudySession, Problem, AttemptLog, ScoreData } from "@/types";

interface StudyState {
  currentSession: StudySession | null;
  problems: Problem[];
  currentProblemIndex: number;
  attempts: AttemptLog[];
  isLoading: boolean;
  error: string | null;

  setSession: (session: StudySession) => void;
  setProblems: (problems: Problem[]) => void;
  nextProblem: () => void;
  prevProblem: () => void;
  addAttempt: (attempt: AttemptLog) => void;
  updateScore: (score: ScoreData) => void;
  reset: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useStudyStore = create<StudyState>((set) => ({
  currentSession: null,
  problems: [],
  currentProblemIndex: 0,
  attempts: [],
  isLoading: false,
  error: null,

  setSession: (session) => set({ currentSession: session }),
  setProblems: (problems) => set({ problems, currentProblemIndex: 0 }),
  nextProblem: () =>
    set((state) => ({
      currentProblemIndex: Math.min(
        state.currentProblemIndex + 1,
        state.problems.length - 1
      ),
    })),
  prevProblem: () =>
    set((state) => ({
      currentProblemIndex: Math.max(state.currentProblemIndex - 1, 0),
    })),
  addAttempt: (attempt) =>
    set((state) => ({ attempts: [...state.attempts, attempt] })),
  updateScore: (score) =>
    set((state) => ({
      currentSession: state.currentSession
        ? { ...state.currentSession, score_data: score }
        : null,
    })),
  reset: () =>
    set({
      currentSession: null,
      problems: [],
      currentProblemIndex: 0,
      attempts: [],
      error: null,
    }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));

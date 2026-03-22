import { create } from "zustand";
import type { StudySession, Problem, AttemptLog, ScoreData } from "@/types";

interface StudyState {
  currentSession: StudySession | null;
  problems: Problem[];
  currentProblemIndex: number;
  attempts: AttemptLog[];
  isLoading: boolean;
  error: string | null;
  requeuedIds: Set<string>;

  setSession: (session: StudySession) => void;
  setProblems: (problems: Problem[]) => void;
  appendProblems: (problems: Problem[]) => void;
  reinsertProblem: (fromIndex: number, afterOffset: number) => void;
  nextProblem: () => void;
  prevProblem: () => void;
  jumpToIndex: (index: number) => void;
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
  requeuedIds: new Set(),

  setSession: (session) => set({ currentSession: session }),
  setProblems: (problems) => set({ problems, currentProblemIndex: 0 }),
  appendProblems: (newProblems) =>
    set((state) => ({
      problems: [...state.problems, ...newProblems],
    })),
  reinsertProblem: (fromIndex, afterOffset) =>
    set((state) => {
      const problem = state.problems[fromIndex];
      if (!problem) return state;
      const insertAt = Math.min(fromIndex + afterOffset + 1, state.problems.length);
      const newProblems = [...state.problems];
      newProblems.splice(insertAt, 0, problem);
      return {
        problems: newProblems,
        requeuedIds: new Set([...state.requeuedIds, problem.id]),
      };
    }),
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
  jumpToIndex: (index) =>
    set((state) => ({
      currentProblemIndex: Math.max(0, Math.min(index, state.problems.length - 1)),
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
      requeuedIds: new Set(),
    }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { BookMarked, Loader2, Plus, X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MathContent } from "@/components/math-content";
import type { StudyNote } from "@/types";

interface Props {
  sessionId: string;
  generatingNoteFor: string | null;
  onNoteGenerated: () => void;
}

export function StudyNotesPanel({ sessionId, generatingNoteFor, onNoteGenerated }: Props) {
  const [notes, setNotes] = useState<StudyNote[]>([]);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [userNoteDrafts, setUserNoteDrafts] = useState<Record<string, string>>({});
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const prevGenerating = useRef<string | null>(null);

  const fetchNotes = useCallback(async () => {
    const res = await fetch(`/api/notes?sessionId=${sessionId}`);
    if (res.ok) {
      const data = await res.json();
      setNotes(data.notes ?? []);
    }
  }, [sessionId]);

  // Initial fetch
  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Re-fetch when generation finishes (generatingNoteFor goes from truthy to null)
  useEffect(() => {
    if (prevGenerating.current !== null && generatingNoteFor === null) {
      fetchNotes();
      onNoteGenerated();
    }
    prevGenerating.current = generatingNoteFor;
  }, [generatingNoteFor, fetchNotes, onNoteGenerated]);

  async function handleAddNote() {
    if (!newTitle.trim() || !newContent.trim()) return;
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, title: newTitle.trim(), content: newContent.trim() }),
    });
    if (res.ok) {
      setNewTitle("");
      setNewContent("");
      setAdding(false);
      fetchNotes();
    }
  }

  async function handleDelete(noteId: string) {
    await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  }

  function handleUserNoteChange(noteId: string, value: string) {
    setUserNoteDrafts((prev) => ({ ...prev, [noteId]: value }));

    // Cancel any pending debounce for this note
    if (debounceRefs.current[noteId]) {
      clearTimeout(debounceRefs.current[noteId]);
    }

    // Schedule save after 800ms
    debounceRefs.current[noteId] = setTimeout(async () => {
      await fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_note: value }),
      });
    }, 800);
  }

  function handleExport() {
    const lines: string[] = [];
    for (const note of [...notes].reverse()) {
      lines.push("═══════════════════════════════════");
      lines.push(note.title);
      if (note.reference) lines.push(`Reference: ${note.reference}`);
      lines.push("───────────────────────────────────");
      // Strip LaTeX delimiters for plain text
      const plainContent = note.content
        .replace(/\$\$([^$]+)\$\$/g, "$1")
        .replace(/\$([^$]+)\$/g, "$1");
      lines.push(plainContent);
      lines.push("");
      const userNote = userNoteDrafts[note.id] ?? note.user_note;
      lines.push(`My Notes: ${userNote}`);
      lines.push("");
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "study-notes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const reversedNotes = [...notes].reverse();

  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="sm" className="gap-1.5 text-xs h-8" />}>
        <BookMarked className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Notes</span>
        {notes.length > 0 && (
          <span className="inline-flex items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-semibold min-w-[16px] h-4 px-1 leading-none">
            {notes.length}
          </span>
        )}
        {generatingNoteFor && (
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
        )}
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto p-0">
        <SheetHeader className="p-4 border-b border-border sticky top-0 bg-background z-10">
          <div className="flex items-center justify-between">
            <SheetTitle>Study Notes</SheetTitle>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs h-7 mr-8"
              onClick={handleExport}
              disabled={notes.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>
        </SheetHeader>

        <div className="p-4 space-y-3">
          {/* Generating indicator */}
          {generatingNoteFor && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              Generating note...
            </div>
          )}

          {/* Add Note button / form */}
          {!adding ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 text-xs h-8"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Note
            </Button>
          ) : (
            <div className="rounded-xl border border-border/60 bg-card p-4 space-y-2">
              <input
                className="w-full text-sm font-semibold bg-transparent border-b border-border/60 pb-1 focus:outline-none focus:border-primary placeholder:text-muted-foreground/50"
                placeholder="Note title..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                autoFocus
              />
              <textarea
                className="w-full text-sm bg-transparent border border-border/60 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary resize-none placeholder:text-muted-foreground/50"
                placeholder="Note content... (supports LaTeX: $...$)"
                rows={4}
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
              />
              <div className="flex gap-2 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => { setAdding(false); setNewTitle(""); setNewContent(""); }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="text-xs h-7"
                  onClick={handleAddNote}
                  disabled={!newTitle.trim() || !newContent.trim()}
                >
                  Save
                </Button>
              </div>
            </div>
          )}

          {/* Notes list — newest first */}
          {reversedNotes.length === 0 && !generatingNoteFor && (
            <p className="text-xs text-muted-foreground text-center py-8">
              No notes yet. Rate a problem to auto-generate a note, or add one manually.
            </p>
          )}

          {reversedNotes.map((note) => {
            const draftValue = userNoteDrafts[note.id] ?? note.user_note;
            return (
              <div
                key={note.id}
                className="rounded-xl border border-border/60 bg-card p-4 space-y-2 mb-3"
              >
                {/* Top row: title + reference + delete */}
                <div className="flex items-start justify-between gap-2">
                  <span className="font-bold text-sm leading-snug">
                    {note.title}
                    {(note.reference_count ?? 1) > 1 && (
                      <span className="ml-1.5 text-green-600 text-xs tracking-tight" title={`Referenced by ${note.reference_count} problems`}>
                        {"✓".repeat(Math.min(note.reference_count, 5))}
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {note.reference && (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-mono">
                        {note.reference}
                      </span>
                    )}
                    <button
                      onClick={() => handleDelete(note.id)}
                      className="text-muted-foreground/40 hover:text-destructive transition-colors"
                      title="Delete note"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Summary */}
                {note.summary && (
                  <p className="text-xs text-muted-foreground italic">{note.summary}</p>
                )}

                {/* Content */}
                <MathContent className="text-sm leading-relaxed">
                  {note.content}
                </MathContent>

                <div className="border-t border-border/40" />

                {/* Personal note area */}
                <div>
                  <p className="text-blue-600 text-xs font-semibold mb-1">My Notes</p>
                  <textarea
                    className="w-full text-sm text-blue-700 dark:text-blue-400 placeholder:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2 bg-blue-50 dark:bg-blue-950/30 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                    rows={3}
                    placeholder="Add your own notes here..."
                    value={draftValue}
                    onChange={(e) => handleUserNoteChange(note.id, e.target.value)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

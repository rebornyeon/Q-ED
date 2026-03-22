"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Pencil, Check, X, Loader2, AlertCircle } from "lucide-react";

interface Props {
  sessionId: string;
  initialName: string;
}

export function SessionNameEditor({ sessionId, initialName }: Props) {
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();
  const router = useRouter();

  function startEdit() {
    setDraft(name);
    setSaveError(false);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed) { cancel(); return; }
    setSaving(true);
    setSaveError(false);

    const { error } = await supabase
      .from("study_sessions")
      .update({ name: trimmed })
      .eq("id", sessionId);

    setSaving(false);

    if (error) {
      setSaveError(true);
      return; // keep editing so user can retry
    }

    setName(trimmed);
    setEditing(false);
    router.refresh(); // re-fetch server component data
  }

  function cancel() {
    setEditing(false);
    setDraft(name);
    setSaveError(false);
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
            disabled={saving}
            className="text-base font-semibold bg-background border border-border rounded px-2 py-0.5 outline-none focus:border-primary w-56 disabled:opacity-50"
          />
          <button onClick={save} disabled={saving} className="text-green-600 hover:text-green-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </button>
          <button onClick={cancel} disabled={saving} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>
        {saveError && (
          <div className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            Save failed — run the SQL migration first
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={startEdit}
      className="group flex items-center gap-1.5 text-base font-semibold text-left hover:text-primary transition-colors"
    >
      <span>{name}</span>
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
    </button>
  );
}

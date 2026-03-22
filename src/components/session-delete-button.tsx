"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle } from "lucide-react";

export function SessionDeleteButton({ sessionId }: { sessionId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    setLoading(true);
    const res = await fetch(`/api/session/${sessionId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error("Delete session error:", data.error);
      setLoading(false);
      setConfirming(false);
      return;
    }
    router.refresh();
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
        <span className="text-xs text-destructive font-medium">Delete?</span>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="text-xs font-semibold text-destructive hover:underline disabled:opacity-50"
        >
          {loading ? "..." : "Yes"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-muted-foreground hover:text-destructive transition-colors"
      title="Delete session"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

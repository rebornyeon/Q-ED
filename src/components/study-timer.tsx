"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";

interface StudyTimerProps {
  isRunning: boolean;
  onTick?: (seconds: number) => void;
}

export function StudyTimer({ isRunning, onTick }: StudyTimerProps) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  useEffect(() => {
    if (seconds > 0) onTick?.(seconds);
  }, [seconds, onTick]);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return (
    <Badge variant="outline" className="gap-1.5 font-mono text-sm px-3 py-1">
      <Clock className="h-3.5 w-3.5" />
      {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
    </Badge>
  );
}

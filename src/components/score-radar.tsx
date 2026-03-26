"use client";

import { useTranslations } from "next-intl";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { ScoreData } from "@/types";

interface ScoreRadarProps {
  score: ScoreData;
  size?: number;
}

export function ScoreRadar({ score, size = 300 }: ScoreRadarProps) {
  const t = useTranslations("dashboard");

  const data = [
    { subject: t("accuracy"), value: score.accuracy, fullMark: 100 },
    { subject: t("speed"), value: score.speed, fullMark: 100 },
    { subject: t("pattern"), value: score.pattern_recognition, fullMark: 100 },
    { subject: t("trapAvoid"), value: score.trap_avoidance, fullMark: 100 },
    { subject: t("thinking"), value: score.thinking_depth, fullMark: 100 },
  ];

  return (
    <ResponsiveContainer width="100%" height={size}>
      <RadarChart cx="50%" cy="50%" outerRadius="75%" data={data}>
        <PolarGrid stroke="hsl(var(--border))" />
        <PolarAngleAxis
          dataKey="subject"
          tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
        />
        <Radar
          name="Score"
          dataKey="value"
          stroke="hsl(var(--primary))"
          fill="hsl(var(--primary))"
          fillOpacity={0.2}
          strokeWidth={2}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          formatter={(value) => [`${value}pts`, ""]}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

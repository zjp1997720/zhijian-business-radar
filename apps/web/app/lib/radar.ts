import { beijingDate } from "@aihot/contracts/time";

export interface RadarRecommendation {
  id: string;
  title: string;
  audience: string;
  whyNow: string;
  angle: string;
  goal: string;
  evidenceGaps: string[];
  sources: Array<{ title: string; url: string; publishedAt: string | null }>;
}

export interface RadarOpportunity {
  id: string;
  title: string;
  kind: "procurement" | "demand" | "channel" | "case";
  summary: string;
  organization: string | null;
  region: string | null;
  deadline: string | null;
  status: "open" | "closed" | "unknown" | "historical";
  recommendedAction: string;
  sourceUrl: string;
  publishedAt: string | null;
}

export interface RadarResponse {
  generatedAt: string | null;
  recommendations: RadarRecommendation[];
  opportunities: RadarOpportunity[];
  status: { lastRunAt: string | null; lastError: string | null };
}

export function opportunityState(item: RadarOpportunity, now: number): RadarOpportunity["status"] {
  if (item.kind === "case" || item.status === "historical") return "historical";
  if (item.status === "closed") return "closed";
  if (item.deadline) {
    const expired = /^\d{4}-\d{2}-\d{2}$/.test(item.deadline)
      ? item.deadline < beijingDate(now)
      : Number.isFinite(Date.parse(item.deadline)) && Date.parse(item.deadline) < now;
    if (expired) return "closed";
  }
  return item.status;
}

export function sourceHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function radarTime(value: string | null, withTime = true): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(new Date(value));
}

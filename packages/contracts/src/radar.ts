export interface RadarSource {
  title: string;
  url: string;
  publishedAt: string | null;
}
export interface RadarRecommendation {
  id: string;
  title: string;
  audience: string;
  whyNow: string;
  angle: string;
  goal: string;
  evidenceGaps: string[];
  sources: RadarSource[];
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

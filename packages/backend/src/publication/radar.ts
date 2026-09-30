import type { RadarResponse } from "@aihot/contracts/radar";
import { sql } from "../db.ts";
import { emptyRadar, opportunityStatus } from "../radar/evidence.ts";

interface RadarAttempt { started_at: Date; status: string; error: string | null }
interface RadarEdition { completed_at: Date; content: Pick<RadarResponse, "recommendations" | "opportunities"> }

/** Reads persisted results only. A failed attempt never hides the last successful edition. */
export async function loadRadar(now = new Date()): Promise<RadarResponse> {
  const [latest, success] = await Promise.all([
    sql<RadarAttempt[]>`SELECT started_at, status, error FROM business_radar_runs ORDER BY id DESC LIMIT 1`,
    sql<RadarEdition[]>`
      SELECT completed_at, content FROM business_radar_runs WHERE status = 'ok' ORDER BY id DESC LIMIT 1`,
  ]);
  return radarEditionResponse(latest[0], success[0], now);
}

export function radarEditionResponse(last: RadarAttempt | undefined, edition: RadarEdition | undefined, now: Date): RadarResponse {
  const response = emptyRadar();
  if (last) response.status = { lastRunAt: last.started_at.toISOString(), lastError: last.error ??
    (last.status === "running" && now.getTime() - last.started_at.getTime() > 10 * 60_000 ? "上次生成未完成，继续展示最后成功结果" : null) };
  if (!edition) return response;
  response.generatedAt = edition.completed_at.toISOString();
  response.recommendations = edition.content.recommendations;
  response.opportunities = edition.content.opportunities.map((o) => {
    const status = opportunityStatus(o.kind, o.deadline, o.status === "historical", now);
    return { ...o, status, recommendedAction: status === "closed" ? "截止日期已过，先核验是否有延期或后续采购公告。" : o.recommendedAction };
  });
  return response;
}

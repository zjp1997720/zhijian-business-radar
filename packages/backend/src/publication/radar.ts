import type { RadarOpportunity, RadarResponse } from "@aihot/contracts/radar";
import { beijingDate } from "@aihot/contracts/time";
import { sql } from "../db.ts";
import { emptyRadar, opportunityStatus } from "../radar/evidence.ts";
import { canonicalLeadUrl, type LeadEvidence } from "../radar/leads.ts";

interface RadarAttempt { started_at: Date; status: string; error: string | null }
interface RadarEdition { completed_at: Date; content: Pick<RadarResponse, "recommendations" | "opportunities">; evidence?: { entries?: LeadEvidence[] } | null }
interface PoolRow { content: RadarOpportunity; first_seen_at: Date; updated_at: Date; total: number; pool_updated_at?: Date }

/** Reads persisted results only. A failed attempt never hides the last successful edition. */
export async function loadRadar(now = new Date()): Promise<RadarResponse> {
  const [latest, success] = await Promise.all([
    sql<RadarAttempt[]>`SELECT started_at, status, error FROM business_radar_runs ORDER BY id DESC LIMIT 1`,
    sql<RadarEdition[]>`
      SELECT completed_at, content, evidence FROM business_radar_runs WHERE status = 'ok' ORDER BY id DESC LIMIT 1`,
  ]);
  const edition = success[0];
  const response = radarEditionResponse(latest[0], edition, now);
  const articleIds = edition?.evidence?.entries?.flatMap((entry) => entry.citations.map((c) => c.articleId)) ?? [];
  const urls = [...response.recommendations.flatMap((r) => r.sources.map((s) => s.url)), ...response.opportunities.map((o) => o.sourceUrl)];
  const [allowed, pool] = await Promise.all([
    sql<{ id: string; url: string }[]>`
      SELECT a.id, a.url FROM articles a JOIN sources s ON s.id = a.source_id
      LEFT JOIN publications p ON p.article_id = a.id
      LEFT JOIN editorial_overrides o ON o.article_id = a.id
      WHERE (a.id = ANY(${articleIds}) OR a.url = ANY(${urls})) AND s.participation_mode = 'editorial'
        AND coalesce(p.visibility, 'public') <> 'withdrawn' AND coalesce(o.visibility, 'public') <> 'withdrawn'`,
    sql<PoolRow[]>`
      SELECT l.content, l.first_seen_at, l.updated_at, count(*) OVER () AS total, max(l.updated_at) OVER () AS pool_updated_at FROM business_leads l
      WHERE cardinality(l.article_ids) > 0 AND NOT EXISTS (
        SELECT 1 FROM unnest(l.article_ids) cited(article_id)
        LEFT JOIN articles a ON a.id = cited.article_id LEFT JOIN sources s ON s.id = a.source_id
        LEFT JOIN publications p ON p.article_id = a.id
        LEFT JOIN editorial_overrides o ON o.article_id = a.id
        WHERE a.id IS NULL OR s.participation_mode <> 'editorial'
          OR p.visibility = 'withdrawn' OR o.visibility = 'withdrawn')
      ORDER BY CASE WHEN l.content->>'status' = 'historical' OR l.content->>'kind' = 'case' THEN 2
        WHEN l.content->>'deadline' IS NOT NULL AND l.content->>'deadline' < ${beijingDate(now)} THEN 3
        WHEN l.content->>'deadline' IS NOT NULL THEN 0 ELSE 1 END, l.updated_at DESC, l.id
      LIMIT 500`,
  ]);
  const visible = visibleEditionContent(response, edition?.evidence?.entries ?? [], allowed);
  response.recommendations = visible.recommendations;
  // Legacy editions remain readable until the worker has revalidated and backfilled them.
  response.opportunities = pool.length ? poolOpportunities(pool, now) : visible.opportunities;
  response.poolUpdatedAt = pool.length ? (pool[0]?.pool_updated_at ?? new Date(Math.max(...pool.map((r) => r.updated_at.getTime())))).toISOString() : null;
  response.opportunityCount = pool[0]?.total ?? response.opportunities.length;
  return response;
}

/** Any unavailable citation hides the entire item, including synthesized title/summary. */
export function visibleEditionContent(response: RadarResponse, evidence: LeadEvidence[], allowed: Array<{ id: string; url: string }>) {
  const ids = new Set(allowed.map((a) => a.id));
  const urls = new Set(allowed.map((a) => canonicalLeadUrl(a.url)));
  const visible = (id: string, links: string[]) => {
    const entry = evidence.find((e) => e.id === id);
    return entry ? entry.citations.length > 0 && entry.citations.every((c) => ids.has(c.articleId)) :
      links.length > 0 && links.every((url) => urls.has(canonicalLeadUrl(url)));
  };
  return {
    recommendations: response.recommendations.filter((r) => visible(r.id, r.sources.map((s) => s.url))),
    opportunities: response.opportunities.filter((o) => visible(o.id, [o.sourceUrl])),
  };
}

export function poolOpportunities(rows: Array<Omit<PoolRow, 'total'>>, now: Date): RadarOpportunity[] {
  const rank = { open: 0, unknown: 1, historical: 2, closed: 3 };
  return rows.map((row) => {
    const o = row.content;
    const status = opportunityStatus(o.kind, o.deadline, o.status === "historical", now);
    return { ...o, status, firstSeenAt: row.first_seen_at.toISOString(), updatedAt: row.updated_at.toISOString(),
      recommendedAction: status === "closed" ? "截止日期已过，先核验是否有延期或后续采购公告。" : o.recommendedAction };
  }).sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
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

import { createHash } from "node:crypto";
import type { RadarOpportunity } from "@aihot/contracts/radar";
import type { Db } from "../db.ts";
import { normalizeUrl } from "../lib/url.ts";
import { validateRadar, type RadarInput } from "./evidence.ts";

export interface LeadCitation { articleId: string; sourceId: string; key: string; quote: string }
export interface LeadEvidence { id: string; citations: LeadCitation[] }

export function canonicalLeadUrl(url: string): string {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Invalid business lead URL");
  const normalized = normalizeUrl(url);
  if (!normalized) throw new Error("Invalid business lead URL");
  return normalized;
}

export function leadId(url: string): string {
  return `lead-${createHash("sha256").update(canonicalLeadUrl(url)).digest("hex").slice(0, 24)}`;
}

/** Call only after evidence validation, inside the successful publication transaction. */
export async function upsertBusinessLeads(db: Db, opportunities: RadarOpportunity[], entries: LeadEvidence[], runId: number, observedAt: Date): Promise<void> {
  for (const opportunity of opportunities) {
    const entry = entries.find((e) => e.id === opportunity.id);
    if (!entry?.citations.length) throw new Error("Business lead requires verified evidence");
    const canonical = canonicalLeadUrl(opportunity.sourceUrl);
    const id = leadId(canonical);
    const articleIds = [...new Set(entry.citations.map((c) => c.articleId))];
    const content = { ...opportunity, id };
    await db`
      INSERT INTO business_leads (id, canonical_url, first_seen_at, updated_at, first_article_id, first_run_id, latest_run_id, article_ids, content, evidence)
      VALUES (${id}, ${canonical}, ${observedAt}, ${observedAt}, ${articleIds[0]!}, ${runId}, ${runId}, ${articleIds}, ${db.json(content as never)}, ${db.json(entry as never)})
      ON CONFLICT (canonical_url) DO UPDATE SET
        first_seen_at = least(business_leads.first_seen_at, EXCLUDED.first_seen_at),
        first_article_id = CASE WHEN EXCLUDED.first_seen_at < business_leads.first_seen_at THEN EXCLUDED.first_article_id ELSE business_leads.first_article_id END,
        first_run_id = CASE WHEN EXCLUDED.first_seen_at < business_leads.first_seen_at THEN EXCLUDED.first_run_id ELSE business_leads.first_run_id END,
        updated_at = greatest(business_leads.updated_at, EXCLUDED.updated_at),
        latest_run_id = CASE WHEN (EXCLUDED.updated_at, EXCLUDED.latest_run_id) >= (business_leads.updated_at, business_leads.latest_run_id) THEN EXCLUDED.latest_run_id ELSE business_leads.latest_run_id END,
        article_ids = CASE WHEN (EXCLUDED.updated_at, EXCLUDED.latest_run_id) >= (business_leads.updated_at, business_leads.latest_run_id) THEN EXCLUDED.article_ids ELSE business_leads.article_ids END,
        content = CASE WHEN (EXCLUDED.updated_at, EXCLUDED.latest_run_id) >= (business_leads.updated_at, business_leads.latest_run_id) THEN EXCLUDED.content ELSE business_leads.content END,
        evidence = CASE WHEN (EXCLUDED.updated_at, EXCLUDED.latest_run_id) >= (business_leads.updated_at, business_leads.latest_run_id) THEN EXCLUDED.evidence ELSE business_leads.evidence END`;
    await db`INSERT INTO business_lead_evidence (lead_id, run_id, article_ids, observed_at, content, evidence)
      VALUES (${id}, ${runId}, ${articleIds}, ${observedAt}, ${db.json(content as never)}, ${db.json(entry as never)})
      ON CONFLICT (lead_id, run_id) DO NOTHING`;
  }
}

/** Recheck snapshots through the same citation/date/attribute rules as a fresh extraction.
 * Editions lacking original inputs or per-item citations are not eligible for backfill. */
export function verifiedHistoricalLeads(content: unknown, evidence: unknown, inputs: RadarInput[], now: Date) {
  const opportunities: RadarOpportunity[] = [];
  const entries: LeadEvidence[] = [];
  let rejected = 0;
  const saved = content as { opportunities?: RadarOpportunity[] } | null;
  const audit = evidence as { entries?: LeadEvidence[] } | null;
  if (!Array.isArray(saved?.opportunities)) return { opportunities, entries, rejected };
  for (const opp of saved.opportunities) {
    try {
      const citations = audit?.entries?.find((entry) => entry.id === opp.id)?.citations;
      if (!citations?.length) throw new Error("Missing original evidence");
      const quoteCitations = citations.map(({ articleId, quote }) => ({ articleId, quote }));
      const deadlineCitation = opp.deadline ? quoteCitations.find((c) => {
        const [year, month, day] = opp.deadline!.split("-").map(Number);
        return new RegExp(`${year}[-/.年]0?${month}[-/.月]0?${day}(?:日|(?=\\D|$))`).test(c.quote.replace(/\s/g, "")) &&
          /截止|递交|提交|投标|报名|deadline|closing|close date|due date/i.test(c.quote);
      }) ?? null : null;
      const result = validateRadar({ recommendations: [], opportunities: [{
        title: opp.title, kind: opp.kind, summary: opp.summary, organization: opp.organization, region: opp.region,
        deadline: opp.deadline, deadlineCitation, recommendedAction: opp.recommendedAction, citations: quoteCitations.slice(0, 5),
      }] }, inputs, new Set(), now);
      if (!result.content.opportunities.length || canonicalLeadUrl(result.content.opportunities[0]!.sourceUrl) !== canonicalLeadUrl(opp.sourceUrl)) throw new Error("Source URL mismatch");
      // Never turn a previously historical entry into a present open invitation.
      if (opp.status === "historical") result.content.opportunities[0]!.status = "historical";
      opportunities.push(...result.content.opportunities);
      entries.push(...result.evidence);
    } catch { rejected++; }
  }
  return { opportunities, entries, rejected };
}

export async function backfillBusinessLeads(db: Db, now: Date): Promise<{ runs: number; accepted: number; rejected: number }> {
  const runs = await db<{ id: number; completed_at: Date; content: unknown; evidence: { inputs?: RadarInput[] } | null }[]>`
    SELECT r.id, r.completed_at, r.content, r.evidence FROM business_radar_runs r
    WHERE r.status = 'ok' AND r.completed_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM business_lead_backfills b WHERE b.run_id = r.id)
    ORDER BY r.id LIMIT 100`;
  let accepted = 0;
  let rejected = 0;
  for (const run of runs) {
    const savedInputs = Array.isArray(run.evidence?.inputs) ? run.evidence!.inputs!.filter((s) => s && typeof s.articleId === "string" && typeof s.sourceId === "string" && typeof s.url === "string") : [];
    const articleIds = savedInputs.filter((s) => typeof s?.articleId === "string").map((s) => s.articleId);
    const allowed = articleIds.length ? await db<{ id: string; source_id: string; url: string }[]>`
      SELECT a.id, a.source_id, a.url FROM articles a JOIN sources s ON s.id = a.source_id
      LEFT JOIN publications p ON p.article_id = a.id
      LEFT JOIN editorial_overrides o ON o.article_id = a.id
      WHERE a.id = ANY(${articleIds}) AND s.participation_mode = 'editorial'
        AND coalesce(p.visibility, 'public') <> 'withdrawn' AND coalesce(o.visibility, 'public') <> 'withdrawn'` : [];
    const inputs = savedInputs.filter((s) => {
      const article = allowed.find((a) => a.id === s.articleId && a.source_id === s.sourceId);
      if (!article || typeof s.title !== "string" || typeof s.text !== "string" || typeof s.key !== "string") return false;
      try { return canonicalLeadUrl(article.url) === canonicalLeadUrl(s.url); } catch { return false; }
    });
    const verified = verifiedHistoricalLeads(run.content, run.evidence, inputs, now);
    await upsertBusinessLeads(db, verified.opportunities, verified.entries, run.id, run.completed_at);
    await db`INSERT INTO business_lead_backfills (run_id, accepted_count, rejected_count)
      VALUES (${run.id}, ${verified.opportunities.length}, ${verified.rejected}) ON CONFLICT (run_id) DO NOTHING`;
    accepted += verified.opportunities.length;
    rejected += verified.rejected;
  }
  return { runs: runs.length, accepted, rejected };
}

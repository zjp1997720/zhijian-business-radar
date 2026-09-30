import { createHash } from "node:crypto";
import { z } from "zod";
import { beijingDate } from "@aihot/contracts/time";
import type { RadarOpportunity, RadarResponse } from "@aihot/contracts/radar";

export interface RadarInput {
  articleId: string;
  sourceId: string;
  key: string;
  title: string;
  url: string;
  publishedAt: string | null;
  text: string;
  tags?: string[];
}
const text = z.string().trim().min(1).max(1200);
// An English paragraph can exceed 600 characters. It must still match the entire
// collected excerpt verbatim; the cap bounds payload size, not evidential strength.
const citation = z.object({ articleId: text, quote: z.string().trim().min(8).max(3000) }).strict();
export const RadarSchema = z.object({
  recommendations: z.array(z.object({
    title: text, audience: text, whyNow: text, angle: text, goal: text,
    evidenceGaps: z.array(text).max(8), citations: z.array(citation).min(1).max(5),
  }).strict()).max(5),
  opportunities: z.array(z.object({
    title: text, kind: z.enum(["procurement", "demand", "channel", "case", "peer"]), summary: text,
    organization: text.nullable(), region: text.nullable(),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    deadlineCitation: citation.nullable(), recommendedAction: text,
    citations: z.array(citation).min(1).max(5),
  }).strict()).max(20).default([]),
}).strict();

/** A verified government award title is itself a useful historical demand signal.
 * Preserve it even when the model elects to return only editorial topics. No
 * amount, customer identity or open deadline is inferred from the title. */
export function historicalProcurementCandidates(inputs: RadarInput[]): z.infer<typeof RadarSchema>["opportunities"] {
  return inputs.filter((s) => (s.sourceId.startsWith("web-ccgp-") || s.sourceId === "external-public-government") &&
    /^https:\/\/(?:www\.ccgp\.gov\.cn\/cggg\/|www\.gsei\.com\.cn\/html\/1337\/)/.test(s.url) && historicalNotice(s.title) &&
    /人工智能|AI|智能体|大模型/i.test(s.title)).slice(0, 4).map((s) => ({
      title: s.title, kind: "case", summary: "官方公告已发布此项目的中标或成交结果，可用于研究已发生的采购需求与服务范围；这不是仍开放的招标。",
      organization: null, region: null, deadline: null, deadlineCitation: null,
      recommendedAction: "阅读原始公告的服务要求和供应商信息，提炼培训或落地服务需求；如需跟进新采购，另查后续公告。",
      citations: [{ articleId: s.articleId, quote: s.title }],
    }));
}

const id = (prefix: string, keys: string[]) => `${prefix}-${createHash("sha256").update([...new Set(keys)].sort().join("|")).digest("hex").slice(0, 20)}`;
export const historicalNotice = (value: string) => /中标(?:公告|结果|通知)|成交(?:公告|结果)|采购结果|结果公告|已中标|contract awarded|award notice|awarded to/i.test(value);

/** A date-only deadline remains open through the entire stated Beijing calendar day. */
export function opportunityStatus(kind: RadarOpportunity["kind"], deadline: string | null, historical: boolean, now: Date): RadarOpportunity["status"] {
  if (historical || kind === "case") return "historical";
  if (deadline && deadline < beijingDate(now)) return "closed";
  if (deadline) return "open";
  return "unknown";
}

/** A dated old plan proves a plan existed, not a present purchase or completed delivery. */
export function historicalPlan(source: RadarInput, now: Date): boolean {
  const date = source.publishedAt ? new Date(source.publishedAt).getTime() : NaN;
  return Number.isFinite(date) && date < now.getTime() - 90 * 86400000 &&
    /计划|拟开展|拟举办|将开展|将举办|planned|plans to/i.test(`${source.title}\n${source.text}`);
}

export function emptyRadar(): RadarResponse {
  return { generatedAt: null, recommendations: [], opportunities: [], status: { lastRunAt: null, lastError: null } };
}

export function validateRadar(raw: unknown, inputs: RadarInput[], recentKeys: Set<string>, now: Date) {
  const parsed = RadarSchema.parse(raw);
  const byId = new Map(inputs.map((s) => [s.articleId, s]));
  const resolve = (c: z.infer<typeof citation>) => {
    const source = byId.get(c.articleId);
    if (!source || !`${source.title}\n${source.text}`.includes(c.quote)) throw new Error(`Radar citation does not match collected evidence: ${c.articleId}`);
    const url = new URL(source.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Radar source URL must be an HTTP(S) article link");
    return source;
  };
  const evidence: Array<{ id: string; citations: Array<{ articleId: string; sourceId: string; key: string; quote: string }> }> = [];
  const recommendedKeys = new Set<string>();
  const recommendations: RadarResponse["recommendations"] = [];
  for (const rec of parsed.recommendations) {
    const sources = rec.citations.map(resolve);
    // An event/source already recommended cannot reappear with a different title or angle.
    if (sources.some((s) => recentKeys.has(s.key) || recentKeys.has(`article:${s.articleId}`) || recommendedKeys.has(s.key) || recommendedKeys.has(`article:${s.articleId}`))) continue;
    const itemId = id("topic", sources.map((s) => s.key));
    sources.forEach((s) => { recommendedKeys.add(s.key); recommendedKeys.add(`article:${s.articleId}`); });
    const { citations, ...fields } = rec;
    recommendations.push({ ...fields, id: itemId, sources: [...new Map(sources.map((s) => [s.url, { title: s.title, url: s.url, publishedAt: s.publishedAt }])).values()] });
    evidence.push({ id: itemId, citations: citations.map((c) => ({ ...c, sourceId: byId.get(c.articleId)!.sourceId, key: byId.get(c.articleId)!.key })) });
  }
  const opportunities: RadarResponse["opportunities"] = [];
  const opportunityIds = new Set<string>();
  for (const opp of parsed.opportunities) {
    // Dates on a case/market signal describe delivery, launches or migrations, not
    // an application deadline. Drop that unsupported interpretation, retain facts.
    if (opp.kind === "demand" || opp.kind === "case" || opp.kind === "peer") {
      opp.deadline = null;
      opp.deadlineCitation = null;
    }
    const sources = opp.citations.map(resolve);
    const source = sources[0]!;
    // Attributes are facts, not inferred identities/locations.
    for (const value of [opp.organization, opp.region]) {
      if (value && !sources.some((s) => `${s.title}\n${s.text}`.includes(value))) throw new Error("Radar opportunity attribute is not in collected evidence");
    }
    if (opp.kind === "channel" && !opp.citations.some((c) =>
      /代理招募|合作招募|伙伴招募|渠道招募/i.test(c.quote) ||
      (/合作伙伴|伙伴计划|渠道伙伴|partner(?:ship)? program|channel partner|reseller|distributor/i.test(c.quote) &&
       /招募|申请|加入|报名|入口|成为|apply|join|register|sign up|recruit/i.test(c.quote)))) {
      throw new Error("Radar channel requires an explicit partner or reseller opportunity");
    }
    if (opp.kind === "peer" && !opp.citations.some((c) => /培训|陪跑|咨询|服务|方案|套餐|交付|部署|落地|training|consulting|implementation|service|deployment/i.test(c.quote))) {
      throw new Error("Radar peer reference requires explicit service or delivery evidence");
    }
    if (opp.deadline) {
      const date = new Date(`${opp.deadline}T00:00:00Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== opp.deadline || !opp.deadlineCitation) throw new Error("Radar deadline is not a valid sourced date");
      const deadlineSource = resolve(opp.deadlineCitation);
      if (!sources.some((s) => s.articleId === deadlineSource.articleId)) throw new Error("Radar deadline evidence must belong to this opportunity");
      const [y, m, d] = opp.deadline.split("-").map(Number);
      const normalized = opp.deadlineCitation.quote.replace(/\s/g, "");
      const datePattern = new RegExp(`${y}[-/.年]0?${m}[-/.月]0?${d}(?:日|(?=\\D|$))`);
      if (!datePattern.test(normalized) || !/截止|递交|提交|投标|报名|deadline|closing|close date|due date/i.test(normalized)) throw new Error("Radar deadline quote does not identify a submission deadline");
    } else if (opp.deadlineCitation) throw new Error("Radar deadline citation requires a deadline");
    const oldPlan = sources.some((s) => historicalPlan(s, now));
    const historical = sources.some((s) => historicalNotice(`${s.title}\n${s.text}`)) || oldPlan;
    const status = opportunityStatus(opp.kind, opp.deadline, historical, now);
    const itemId = id(opp.kind, sources.map((s) => s.key));
    if (opportunityIds.has(itemId)) continue;
    opportunityIds.add(itemId);
    opportunities.push({ id: itemId, title: opp.title, kind: opp.kind, summary: opp.summary,
      organization: opp.organization, region: opp.region, deadline: opp.deadline, status,
      recommendedAction: status === "historical" && oldPlan ? "作为当时的计划研究需求；不能推定计划已经实施，也不能据此参与当前采购。" : status === "historical" && opp.kind === "procurement" ? "作为历史采购与中标案例研究需求和供应商；本条结果公告不能用于投标。" : status === "closed" ? "截止日期已过，先核验是否有延期或后续采购公告。" : opp.recommendedAction,
      sourceUrl: source.url, publishedAt: source.publishedAt,
      ...((opp.kind === "peer" || sources.some((s) => s.sourceId === "external-public-companies" || s.tags?.includes("nature:peer-self-report"))) ? { sourceAttribution: "来源自述；服务能力、客户与效果需独立核验。" } : {}) });
    evidence.push({ id: itemId, citations: [...opp.citations, ...(opp.deadlineCitation ? [opp.deadlineCitation] : [])].map((c) => ({ ...c, sourceId: byId.get(c.articleId)!.sourceId, key: byId.get(c.articleId)!.key })) });
  }
  return { content: { recommendations, opportunities }, evidence, recommendedKeys: [...recommendedKeys] };
}

/** Keep independently verified entries; one unsupported candidate must not suppress
 * every good candidate. Rejected entries remain in the private run audit, never the API.
 * When everything was rejected, fail the run and preserve the previous edition. */
export function validateRadarBatch(raw: unknown, inputs: RadarInput[], recentKeys: Set<string>, now: Date) {
  const parsed = RadarSchema.parse(raw);
  const accepted: z.infer<typeof RadarSchema> = { recommendations: [], opportunities: [] };
  const rejected: Array<{ kind: string; title: string; reason: string }> = [];
  for (const kind of ["recommendations", "opportunities"] as const) {
    for (const entry of parsed[kind]) {
      try {
        validateRadar({ recommendations: [], opportunities: [], [kind]: [entry] }, inputs, recentKeys, now);
        if (kind === "recommendations") accepted.recommendations.push(entry as z.infer<typeof RadarSchema>["recommendations"][number]);
        else accepted.opportunities.push(entry as z.infer<typeof RadarSchema>["opportunities"][number]);
      } catch (error) {
        rejected.push({ kind, title: entry.title, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  if (rejected.length && !accepted.recommendations.length && !accepted.opportunities.length) throw new Error(`All radar candidates failed evidence validation (${rejected.length})`);
  return { ...validateRadar(accepted, inputs, recentKeys, now), rejected };
}

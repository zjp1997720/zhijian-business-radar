import assert from "node:assert/strict";
import type { z } from "zod";
import { test } from "node:test";
import { emptyRadar, opportunityStatus, validateRadar, validateRadarBatch, historicalProcurementCandidates, RadarSchema, type RadarInput } from "@aihot/backend/radar/evidence";
import { radarEditionResponse } from "@aihot/backend/publication/radar";

const now = new Date("2026-10-01T00:00:00Z");
const source: RadarInput = { articleId: "radar-test-a", sourceId: "source-1", key: "fact:1",
  title: "企业AI培训采购公告", url: "https://example.com/notice", publishedAt: null,
  text: "上海某公司计划采购企业AI培训服务。报名截止日期为2026年10月2日。预算尚未披露，须核验采购范围。" };
const quote = { articleId: source.articleId, quote: "上海某公司计划采购企业AI培训服务。" };
const rec = { title: "企业AI培训的采购需求", audience: "企业培训负责人", whyNow: "出现明确培训采购公告",
  angle: "用真实采购范围检验培训设计", goal: "企业培训与专业影响力", evidenceGaps: ["需核验采购范围"], citations: [quote] };
const opp = { title: "企业培训采购", kind: "procurement" as const, summary: "企业计划采购AI培训服务",
  organization: "上海某公司", region: "上海", deadline: "2026-10-02", deadlineCitation: { articleId: source.articleId, quote: "报名截止日期为2026年10月2日。" },
  recommendedAction: "核验原始公告与报名条件", citations: [quote] };
const make = (r: z.infer<typeof RadarSchema>["recommendations"][number] = rec, o: z.infer<typeof RadarSchema>["opportunities"][number] = opp) => ({ recommendations: [r], opportunities: [o] });

test("verified procurement awards remain historical evidence when model omits opportunities", () => {
  const award = { ...source, sourceId: "web-ccgp-dfgg", title: "人工智能培训中标（成交）结果公告", url: "https://www.ccgp.gov.cn/cggg/dfgg/zbgg/202610/example.htm" };
  assert.deepEqual(RadarSchema.parse({ recommendations: [rec] }).opportunities, []);
  const candidates = historicalProcurementCandidates([award, source, { ...award, sourceId: "untrusted" }, { ...award, url: "https://example.com" }]);
  assert.equal(candidates.length, 1);
  const validated = validateRadar({ recommendations: [], opportunities: candidates }, [award], new Set(), now);
  assert.equal(validated.content.opportunities[0]!.status, "historical");
  assert.equal(validated.content.opportunities[0]!.deadline, null);
});

test("batch publishes only independently sourced candidates and retains rejection audit", () => {
  const bad = { ...rec, title: "unsupported", citations: [{ ...quote, quote: "该公司已经采购成功并支付全部费用。" }] };
  const result = validateRadarBatch({ recommendations: [rec, bad], opportunities: [{ ...opp, deadline: "2026-10-03" }] }, [source], new Set(), now);
  assert.equal(result.content.recommendations.length, 1);
  assert.equal(result.content.opportunities.length, 0);
  assert.equal(result.rejected.length, 2);
  assert.throws(() => validateRadarBatch({ recommendations: [bad], opportunities: [] }, [source], new Set(), now), /All radar candidates/);
});

test("long English quotations remain valid only when the entire quote is present verbatim", () => {
  const paragraph = "Enterprise deployment requires a verified operational plan. ".repeat(15);
  const long = { ...rec, citations: [{ ...quote, quote: paragraph.trim() }] };
  assert.equal(validateRadar({ recommendations: [long], opportunities: [] }, [{ ...source, text: paragraph }], new Set(), now).content.recommendations.length, 1);
  assert.throws(() => validateRadar({ recommendations: [long], opportunities: [] }, [source], new Set(), now), /citation/);
});

test("case/demand dates are not submission deadlines and products are not channel programs", () => {
  const result = validateRadar(make(rec, { ...opp, kind: "case", deadline: "2026-11-20", deadlineCitation: quote }), [source], new Set(), now);
  assert.equal(result.content.opportunities[0]!.deadline, null);
  assert.equal(result.content.opportunities[0]!.status, "historical");
  assert.throws(() => validateRadar(make(rec, { ...opp, kind: "channel" }), [source], new Set(), now), /explicit partner/);
});

test("radar derives links and publication dates from collected evidence and keeps source IDs/quotes", () => {
  const result = validateRadar(make(), [source], new Set(), now);
  assert.equal(result.content.recommendations[0]!.sources[0]!.url, source.url);
  assert.equal(result.content.recommendations[0]!.sources[0]!.publishedAt, null);
  assert.equal(result.content.opportunities[0]!.status, "open");
  assert.equal(result.evidence[0]!.citations[0]!.sourceId, source.sourceId);
  assert.equal(result.evidence[0]!.citations[0]!.quote, quote.quote);
  assert.throws(() => validateRadar({ ...make(), url: "https://invented.example" }, [source], new Set(), now));
});

test("radar rejects uncollected source IDs, invented citations and non-HTTP links", () => {
  assert.throws(() => validateRadar(make({ ...rec, citations: [{ ...quote, articleId: "made-up" }] }), [source], new Set(), now), /citation/);
  assert.throws(() => validateRadar(make({ ...rec, citations: [{ ...quote, quote: "该公司已经采购成功并支付全部费用。" }] }), [source], new Set(), now), /citation/);
  assert.throws(() => validateRadar(make(), [{ ...source, url: "javascript:alert(1)" }], new Set(), now), /HTTP/);
  assert.throws(() => validateRadar(make(), [{ ...source, url: "https://secret@example.com" }], new Set(), now), /HTTP/);
});

test("deadline must be a valid complete submission date with a matching evidence quote", () => {
  assert.throws(() => validateRadar(make(rec, { ...opp, deadline: "2026-10-03" }), [source], new Set(), now), /deadline/);
  assert.throws(() => validateRadar(make(rec, { ...opp, deadline: "2026-02-30" }), [source], new Set(), now), /deadline/);
  const published = { ...source, text: "公告发布日期为2026年10月2日。上海某公司计划采购企业AI培训服务。" };
  assert.throws(() => validateRadar(make(rec, { ...opp, deadlineCitation: { articleId: source.articleId, quote: "公告发布日期为2026年10月2日。" } }), [published], new Set(), now), /deadline/);
  assert.throws(() => validateRadar(make(rec, { ...opp, organization: "虚构集团" }), [source], new Set(), now), /attribute/);
});

test("expired procurement is closed; unknown deadline stays unknown; awards are historical", () => {
  assert.equal(opportunityStatus("procurement", "2026-09-30", false, now), "closed");
  assert.equal(opportunityStatus("procurement", "2026-10-01", false, new Date("2026-10-01T15:59:00Z")), "open");
  assert.equal(opportunityStatus("procurement", "2026-10-01", false, new Date("2026-10-01T16:00:00Z")), "closed");
  const unknown = validateRadar(make(rec, { ...opp, deadline: null, deadlineCitation: null }), [source], new Set(), now);
  assert.equal(unknown.content.opportunities[0]!.status, "unknown");
  const historical = validateRadar(make(), [{ ...source, title: "企业AI培训采购中标结果公告" }], new Set(), now);
  assert.equal(historical.content.opportunities[0]!.status, "historical");
  assert.match(historical.content.opportunities[0]!.recommendedAction, /不能用于投标/);
});

test("retitled recommendations cannot repeat recent events or duplicate the same event in a run", () => {
  const repeated = validateRadar(make({ ...rec, title: "换了标题仍是同一事件" }), [source], new Set([source.key]), now);
  assert.equal(repeated.content.recommendations.length, 0);
  assert.equal(repeated.content.opportunities.length, 1);
  const duplicate = validateRadar({ recommendations: [rec, { ...rec, title: "第二个标题" }], opportunities: [] }, [source], new Set(), now);
  assert.equal(duplicate.content.recommendations.length, 1);
  assert.deepEqual(duplicate.recommendedKeys, [source.key, `article:${source.articleId}`]);
  assert.equal(validateRadar(make(), [source], new Set([`article:${source.articleId}`]), now).content.recommendations.length, 0);
});

test("real empty input stays empty and does not fabricate a minimum number of topics", () => {
  assert.deepEqual(validateRadar({ recommendations: [], opportunities: [] }, [], new Set(), now).content, { recommendations: [], opportunities: [] });
  assert.deepEqual(emptyRadar(), { generatedAt: null, recommendations: [], opportunities: [], status: { lastRunAt: null, lastError: null } });
});

test("a failed/model-unconfigured run preserves the last successful edition and reports its actual timestamp/error", () => {
  const content = validateRadar(make(), [source], new Set(), now).content;
  const edition = { completed_at: now, content };
  const failedAt = new Date("2026-10-03T00:00:00Z");
  const response = radarEditionResponse({ started_at: failedAt, status: "failed", error: "模型尚未配置" }, edition, failedAt);
  assert.equal(response.generatedAt, now.toISOString());
  assert.equal(response.recommendations[0]!.id, content.recommendations[0]!.id);
  assert.equal(response.status.lastRunAt, failedAt.toISOString());
  assert.equal(response.status.lastError, "模型尚未配置");
  assert.equal(response.opportunities[0]!.status, "closed", "deadlines age even while a failed model retains the old edition");
  assert.match(response.opportunities[0]!.recommendedAction, /截止日期已过/);
  const firstFailure = radarEditionResponse({ started_at: failedAt, status: "failed", error: "调用失败" }, undefined, failedAt);
  assert.equal(firstFailure.generatedAt, null);
  assert.deepEqual(firstFailure.recommendations, []);
});

const testDatabase = /_(test|ci)$/.test(new URL(process.env.DATABASE_URL ?? "postgres://unset/unset").pathname.slice(1));
test("persisted generator publishes real empty results, keeps the last success on model failure, and serializes manual/worker runs", { skip: !testDatabase }, async () => {
  const { sql, closeDb } = await import("@aihot/backend/db");
  const { generateRadar } = await import("@aihot/backend/radar/generate");
  const { loadRadar } = await import("@aihot/backend/publication/radar");
  const previousModel = process.env.RADAR_MODEL;
  try {
    const empty = await generateRadar(new Date("2000-01-01T00:00:00Z"));
    assert.equal(empty.status, "ok");
    const first = await loadRadar();
    assert.ok(first.generatedAt);
    assert.deepEqual(first.recommendations, []);
    assert.deepEqual(first.opportunities, []);

    const tag = Date.now().toString(36);
    const sourceId = `radar-db-${tag}`;
    const articleId = `radar-article-${tag}`;
    const runAt = new Date("2030-01-01T00:00:00Z");
    await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${sourceId}, 'Radar fixture', 'rss', 'T1', 'editorial', '2100-01-01')`;
    await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at, excerpt, body_status)
      VALUES (${articleId}, ${sourceId}, ${articleId}, ${source.url}, ${source.title}, ${runAt}, ${runAt}, ${source.text}, 'ok')`;
    const content = validateRadar(make(), [source], new Set(), now).content;
    await sql`INSERT INTO business_radar_runs (started_at, completed_at, status, content)
      VALUES (${runAt}, ${now}, 'ok', ${sql.json(content as never)})`;
    process.env.RADAR_MODEL = 'unconfigured-radar-model';
    const result = await generateRadar(runAt);
    assert.equal(result.status, "failed");
    const retained = await loadRadar(now);
    assert.equal(retained.generatedAt, now.toISOString());
    assert.deepEqual(retained.recommendations, content.recommendations);
    assert.ok(retained.status.lastError);
    assert.equal(retained.status.lastRunAt, runAt.toISOString());
    const [failed] = await sql`SELECT status, receipt_id, content FROM business_radar_runs WHERE id = ${result.runId!}`;
    assert.equal(failed!.status, "failed");
    assert.equal(failed!.receipt_id, null);
    assert.equal(failed!.content, null);

    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('business_radar_generate'))`;
      assert.equal((await generateRadar(runAt)).status, "busy");
    });
  } finally {
    if (previousModel === undefined) delete process.env.RADAR_MODEL;
    else process.env.RADAR_MODEL = previousModel;
    await closeDb();
  }
});

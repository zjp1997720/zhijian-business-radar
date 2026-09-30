import assert from "node:assert/strict";
import { test } from "node:test";
import { businessInputBatches } from "@aihot/backend/radar/business-inputs";
import { canonicalLeadUrl, leadId, verifiedHistoricalLeads, backfillBusinessLeads, upsertBusinessLeads } from "@aihot/backend/radar/leads";
import { validateRadar, type RadarInput } from "@aihot/backend/radar/evidence";
import { poolOpportunities, visibleEditionContent, loadRadar } from "@aihot/backend/publication/radar";

const now = new Date("2026-10-01T00:00:00Z");
const source: RadarInput = { articleId: "lead-test-a", sourceId: "source-a", key: "article:lead-test-a",
  title: "企业AI培训采购公告", url: "https://example.com/notice?utm_source=feed", publishedAt: now.toISOString(),
  text: "某公司采购企业AI培训服务。报名截止日期为2026年10月2日。" };
const citation = { articleId: source.articleId, quote: "某公司采购企业AI培训服务。" };
const procurement = { title: "企业AI培训采购", kind: "procurement" as const, summary: "来源公告提出培训采购",
  organization: "某公司", region: null, deadline: "2026-10-02", deadlineCitation: { articleId: source.articleId, quote: "报名截止日期为2026年10月2日。" },
  recommendedAction: "人工核验采购条件", citations: [citation] };
const peerSource: RadarInput = { ...source, articleId: "lead-test-b", sourceId: "external-public-companies", key: "article:lead-test-b",
  title: "同行服务介绍", url: "https://example.com/services", text: "我们提供企业AI培训和落地陪跑服务。已有客户采用我们的培训套餐。" };
const peer = { ...procurement, title: "同行培训套餐参考", kind: "peer" as const, summary: "来源介绍企业培训与落地陪跑服务",
  organization: null, deadline: null, deadlineCitation: null, recommendedAction: "核验原文服务范围作为同行参考",
  citations: [{ articleId: peerSource.articleId, quote: "我们提供企业AI培训和落地陪跑服务。" }] };
const recommendation = { title: "企业培训采购与服务设计", audience: "企业培训负责人", whyNow: "来源出现采购与服务资料",
  angle: "从真实任务讨论交付", goal: "企业培训", evidenceGaps: ["需核验原文范围"], citations: [citation, peer.citations[0]!] };

test("canonical URL yields one stable lead while preserving meaningful query parameters", () => {
  assert.equal(canonicalLeadUrl(source.url), "https://example.com/notice");
  assert.equal(leadId(source.url), leadId("http://www.example.com/notice/#share"));
  assert.notEqual(leadId("https://example.com/notice?id=1"), leadId("https://example.com/notice?id=2"));
  assert.throws(() => canonicalLeadUrl("https://secret@example.com/notice"));
  assert.throws(() => canonicalLeadUrl("file:///tmp/example"));
});

test("commercial inputs are independent of news, deduplicated and bounded to two 30-source rounds", () => {
  const news = { ...source, sourceId: "model-news", title: "模型性能更新", text: "推理速度提高", tags: [] };
  assert.deepEqual(businessInputBatches([news]), []);
  assert.equal(businessInputBatches([{ ...news, tags: ["企业落地"] }])[0]!.length, 1);
  assert.equal(businessInputBatches([{ ...news, sourceId: "business-discovery-peer" }])[0]!.length, 1);
  const many = Array.from({ length: 81 }, (_, i) => ({ ...source, articleId: `input-${i}` }));
  const batches = businessInputBatches([news, many[0]!, ...many]);
  assert.deepEqual(batches.map((b) => b.length), [30, 30]);
  assert.equal(new Set(batches.flat().map((s) => s.articleId)).size, 60);
});

test("peer references require real service evidence, retain attribution and never acquire an application deadline", () => {
  const result = validateRadar({ recommendations: [], opportunities: [{ ...peer, deadline: "2026-10-02", deadlineCitation: citation }] }, [peerSource], new Set(), now);
  const item = result.content.opportunities[0]!;
  assert.equal(item.kind, "peer");
  assert.equal(item.status, "unknown");
  assert.equal(item.deadline, null);
  assert.match(item.sourceAttribution!, /来源自述/);
  const taggedSource = { ...peerSource, sourceId: "business-discovery-vendor", tags: ["nature:peer-self-report"] };
  const tagged = validateRadar({ recommendations: [], opportunities: [{ ...peer, kind: "demand" }] }, [taggedSource], new Set(), now);
  assert.match(tagged.content.opportunities[0]!.sourceAttribution!, /来源自述/);
  assert.throws(() => validateRadar({ recommendations: [], opportunities: [{ ...peer, citations: [{ articleId: source.articleId, quote: "报名截止日期为2026年10月2日。" }] }] }, [source], new Set(), now), /service or delivery/);
  const partner = { ...peerSource, text: "我们已有一百家合作伙伴共同服务客户。" };
  assert.throws(() => validateRadar({ recommendations: [], opportunities: [{ ...peer, kind: "channel", citations: [{ articleId: partner.articleId, quote: partner.text }] }] }, [partner], new Set(), now), /explicit partner/);
  const recruitment = { ...peerSource, text: "合作伙伴计划开放申请，欢迎加入渠道伙伴。" };
  assert.equal(validateRadar({ recommendations: [], opportunities: [{ ...peer, kind: "channel", citations: [{ articleId: recruitment.articleId, quote: recruitment.text }] }] }, [recruitment], new Set(), now).content.opportunities[0]!.status, "unknown");
});

test("old dated plans are historical and historical snapshots require original exact evidence", () => {
  const planned = { ...source, publishedAt: "2025-01-01T00:00:00Z", text: `某公司计划采购企业AI培训服务。报名截止日期为2026年10月2日。` };
  const result = validateRadar({ recommendations: [], opportunities: [{ ...procurement, citations: [{ articleId: source.articleId, quote: "某公司计划采购企业AI培训服务。" }] }] }, [planned], new Set(), now);
  assert.equal(result.content.opportunities[0]!.status, "historical");
  assert.match(result.content.opportunities[0]!.recommendedAction, /不能推定计划已经实施/);
  const verified = verifiedHistoricalLeads(result.content, { entries: result.evidence }, [planned], now);
  assert.equal(verified.opportunities.length, 1);
  assert.equal(verified.opportunities[0]!.status, "historical");
  assert.equal(verifiedHistoricalLeads(result.content, {}, [planned], now).rejected, 1);
  assert.equal(verifiedHistoricalLeads(result.content, { entries: result.evidence }, [], now).rejected, 1);
  const invented = result.evidence.map((e) => ({ ...e, citations: e.citations.map((c) => ({ ...c, quote: "完全虚构的客户和商业采购需求。" })) }));
  assert.equal(verifiedHistoricalLeads(result.content, { entries: invented }, [planned], now).opportunities.length, 0);
});

test("edition filtering suppresses the whole item when any citation is withdrawn or isolated", () => {
  const result = validateRadar({ recommendations: [recommendation], opportunities: [procurement, peer] }, [source, peerSource], new Set(), now);
  const response = { ...result.content, generatedAt: now.toISOString(), status: { lastRunAt: null, lastError: null } };
  const visible = visibleEditionContent(response, result.evidence, [{ id: peerSource.articleId, url: peerSource.url }]);
  assert.deepEqual(visible.recommendations, []);
  assert.deepEqual(visible.opportunities.map((o) => o.kind), ["peer"]);
  assert.equal(visibleEditionContent(response, [], []).opportunities.length, 0);
});

test("pool ordering uses current deadline status before latest update while retaining first discovery", () => {
  const validated = validateRadar({ recommendations: [], opportunities: [procurement, peer] }, [source, peerSource], new Set(), now);
  const open = validated.content.opportunities[0]!;
  const unknown = validated.content.opportunities[1]!;
  const rows = [
    { content: { ...open, id: "closed", deadline: "2026-09-30" }, first_seen_at: now, updated_at: new Date("2026-10-04") },
    { content: unknown, first_seen_at: new Date("2026-09-01"), updated_at: new Date("2026-10-03") },
    { content: open, first_seen_at: now, updated_at: now },
    { content: { ...unknown, id: "historical", kind: "case" as const }, first_seen_at: now, updated_at: now },
  ];
  const pool = poolOpportunities(rows, now);
  assert.deepEqual(pool.map((o) => o.status), ["open", "unknown", "historical", "closed"]);
  assert.equal(pool[1]!.firstSeenAt, "2026-09-01T00:00:00.000Z");
  assert.match(pool[3]!.recommendedAction, /截止日期已过/);
});

const databaseIsolated = /_(test|ci)$/.test(new URL(process.env.DATABASE_URL ?? "postgres://unset/unset").pathname.slice(1)) &&
  new URL(process.env.DATABASE_URL ?? "postgres://unset/unset").pathname !== "/radar_test";

test("DB pool accumulates, backfills idempotently, survives model failure and hides unavailable sources", { skip: !databaseIsolated }, async () => {
  const { sql, closeDb } = await import("@aihot/backend/db");
  const { generateRadar } = await import("@aihot/backend/radar/generate");
  const tag = Date.now().toString(36);
  const sourceIds = [`lead-source-${tag}-a`, `lead-source-${tag}-b`];
  const articleIds = [`lead-article-${tag}-a`, `lead-article-${tag}-b`, `lead-article-${tag}-a2`];
  const a = { ...source, articleId: articleIds[0]!, sourceId: sourceIds[0]!, key: `article:${articleIds[0]}`, url: `https://example.com/${tag}/notice?utm_source=feed` };
  const b = { ...peerSource, articleId: articleIds[1]!, sourceId: sourceIds[1]!, key: `article:${articleIds[1]}`, url: `https://example.com/${tag}/services` };
  const a2 = { ...a, articleId: articleIds[2]!, sourceId: sourceIds[1]!, key: `article:${articleIds[2]}`, url: `http://www.example.com/${tag}/notice/#share` };
  const runIds: number[] = [];
  const oldModel = process.env.RADAR_MODEL;
  const makeProcurement = (input: RadarInput) => ({ ...procurement, citations: [{ ...citation, articleId: input.articleId }], deadlineCitation: { ...procurement.deadlineCitation, articleId: input.articleId } });
  const makePeer = () => ({ ...peer, citations: [{ ...peer.citations[0]!, articleId: b.articleId }] });
  const makeRecommendation = () => ({ ...recommendation, citations: [{ ...citation, articleId: a.articleId }, { ...peer.citations[0]!, articleId: b.articleId }] });
  const insertRun = async (result: ReturnType<typeof validateRadar>, inputs: RadarInput[], at = now) => {
    const [run] = await sql<{ id: number }[]>`INSERT INTO business_radar_runs (started_at, completed_at, status, content, evidence)
      VALUES (${at}, ${at}, 'ok', ${sql.json(result.content as never)}, ${sql.json({ inputs, entries: result.evidence } as never)}) RETURNING id`;
    runIds.push(run!.id);
    return run!.id;
  };
  try {
    for (const id of sourceIds) await sql`INSERT INTO sources (id, name, kind, tier, participation_mode) VALUES (${id}, 'Lead fixture', 'rss', 'T1', 'editorial')`;
    for (const input of [a, b, a2]) await sql`INSERT INTO articles (id, source_id, identity_key, url, title, published_at, discovered_at, timeline_at, excerpt, body_status)
      VALUES (${input.articleId}, ${input.sourceId}, ${input.articleId}, ${input.url}, ${input.title}, ${now}, ${now}, ${now}, ${input.text}, 'ok')`;
    const first = validateRadar({ recommendations: [makeRecommendation()], opportunities: [makeProcurement(a), makePeer()] }, [a, b], new Set(), now);
    await insertRun(first, [a, b]);
    const later = validateRadar({ recommendations: [makeRecommendation()], opportunities: [{ ...makePeer(), title: "同行服务与交付参考" }] }, [a, b], new Set(), now);
    const laterId = await insertRun(later, [a, b], new Date(now.getTime() + 60000));
    await sql.begin((tx) => backfillBusinessLeads(tx, now));
    const [counts] = await sql<{ count: number }[]>`SELECT count(*) AS count FROM business_lead_evidence WHERE run_id = ANY(${runIds})`;
    assert.equal(counts!.count, 3);
    await sql.begin((tx) => backfillBusinessLeads(tx, now));
    const [again] = await sql<{ count: number }[]>`SELECT count(*) AS count FROM business_lead_evidence WHERE run_id = ANY(${runIds})`;
    assert.equal(again!.count, 3);
    let response = await loadRadar(now);
    const ours = () => response.opportunities.filter((o) => [leadId(a.url), leadId(b.url)].includes(o.id));
    assert.equal(ours().length, 2, "later peer-only edition retains older procurement");
    assert.equal(ours().find((o) => o.kind === "peer")!.title, "同行服务与交付参考");
    const generatedAt = response.generatedAt;
    process.env.RADAR_MODEL = "unconfigured-lead-fixture-model";
    const failed = await generateRadar(now);
    assert.equal(failed.status, "failed");
    runIds.push(failed.runId!);
    response = await loadRadar(now);
    assert.equal(response.generatedAt, generatedAt);
    assert.equal(ours().length, 2);
    assert.ok(response.status.lastError);

    await sql`UPDATE sources SET participation_mode = 'isolated' WHERE id = ${sourceIds[0]!}`;
    response = await loadRadar(now);
    assert.deepEqual(ours().map((o) => o.kind), ["peer"]);
    assert.deepEqual(response.recommendations, []);
    await sql`UPDATE sources SET participation_mode = 'editorial' WHERE id = ${sourceIds[0]!}`;
    await sql`INSERT INTO editorial_overrides (article_id, visibility) VALUES (${b.articleId}, 'withdrawn')`;
    response = await loadRadar(now);
    assert.deepEqual(ours().map((o) => o.kind), ["procurement"]);
    assert.deepEqual(response.recommendations, []);
    await sql`UPDATE editorial_overrides SET visibility = 'public' WHERE article_id = ${b.articleId}`;

    // Directly persist a later validated sighting of the same canonical URL.
    const refreshed = validateRadar({ recommendations: [], opportunities: [{ ...makeProcurement(a2), title: "采购来源再发现" }] }, [a2], new Set(), now);
    const updateAt = new Date(now.getTime() + 120000);
    const refreshId = await insertRun(refreshed, [a2], updateAt);
    await sql.begin((tx) => upsertBusinessLeads(tx, refreshed.content.opportunities, refreshed.evidence, refreshId, updateAt));
    const [stored] = await sql<{ first_article_id: string; latest_run_id: number; first_seen_at: Date; content: { title: string } }[]>`
      SELECT first_article_id, latest_run_id, first_seen_at, content FROM business_leads WHERE canonical_url = ${canonicalLeadUrl(a.url)}`;
    assert.equal(stored!.first_article_id, a.articleId);
    assert.equal(stored!.latest_run_id, refreshId);
    assert.equal(stored!.first_seen_at.toISOString(), now.toISOString());
    assert.equal(stored!.content.title, "采购来源再发现");
    // An older duplicate cannot overwrite the refreshed lead.
    await sql.begin((tx) => upsertBusinessLeads(tx, first.content.opportunities, first.evidence, runIds[0]!, now));
    const [stillLatest] = await sql<{ latest_run_id: number }[]>`SELECT latest_run_id FROM business_leads WHERE canonical_url = ${canonicalLeadUrl(a.url)}`;
    assert.equal(stillLatest!.latest_run_id, refreshId);
    const empty = validateRadar({ recommendations: [], opportunities: [] }, [], new Set(), now);
    await insertRun(empty, [], new Date(now.getTime() + 180000));
    response = await loadRadar(now);
    assert.equal(ours().length, 2, "an empty successful edition never clears the pool");
    assert.equal(response.recommendations.length, 0);
    assert.ok(response.poolUpdatedAt);
    assert.ok(response.opportunityCount! >= 2);
    assert.ok(laterId);
  } finally {
    if (oldModel === undefined) delete process.env.RADAR_MODEL; else process.env.RADAR_MODEL = oldModel;
    await sql`DELETE FROM business_lead_backfills WHERE run_id = ANY(${runIds})`;
    await sql`DELETE FROM business_lead_evidence WHERE run_id = ANY(${runIds})`;
    await sql`DELETE FROM business_leads WHERE id = ANY(${[leadId(a.url), leadId(b.url)]})`;
    await sql`DELETE FROM business_radar_runs WHERE id = ANY(${runIds})`;
    await sql`DELETE FROM editorial_overrides WHERE article_id = ANY(${articleIds})`;
    await sql`DELETE FROM articles WHERE id = ANY(${articleIds})`;
    await sql`DELETE FROM sources WHERE id = ANY(${sourceIds})`;
    await closeDb();
  }
});

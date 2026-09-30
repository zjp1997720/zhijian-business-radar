// Pure/stub tests: no database, public network, paid API or production state.
import test from "node:test";
import assert from "node:assert/strict";
import { discoveryConfigSchema, loadDiscoveryConfig, type DiscoveryConfig, type CuratedSource } from "../packages/backend/src/business-discovery/config.ts";
import { businessRelevance, challengePage, originalDate, parseCuratedList, parsePublicationDate, parseSearchRss, verifyOriginal } from "../packages/backend/src/business-discovery/parse.ts";
import { runBusinessDiscovery, type DiscoveryStore } from "../packages/backend/src/business-discovery/run.ts";
import type { GuardedResponse } from "../packages/backend/src/lib/http-fetch.ts";
import type { MaterialInput } from "../packages/backend/src/content/materials.ts";

const now = new Date("2026-10-01T06:00:00Z");
const rules = { aiTerms: ["人工智能", "AI", "WorkBuddy"], businessTerms: ["培训", "采购", "代理", "企业"], maxTermDistance: 240, minBodyChars: 200 };
const source: CuratedSource = { id: "business-discovery-test", name: "测试工会", enabled: true, sourceNature: "union", participationMode: "editorial", intervalMinutes: 360,
  url: "https://union.example/list", linkSelector: "a[href]", linkPattern: "^/article/", bodySelector: "article", dateSelector: ".published" };
const config = (extra?: Partial<DiscoveryConfig>): DiscoveryConfig => discoveryConfigSchema.parse({ version: 1, relevance: rules, sources: [source], ...extra });
const article = (body = "人工智能企业培训课程帮助职工掌握办公工具。".repeat(20), metadata = '<meta name="PubDate" content="2026-09-30 12:00">') => `<html><head><title>人工智能培训</title>${metadata}</head><body><h1>人工智能培训</h1><article><p>${body}</p></article></body></html>`;
const response = (body: string, url: string, status = 200, type = "text/html"): GuardedResponse => ({ status, url, headers: new Headers({ "content-type": type }), body: Buffer.from(body), text: () => body });
const listing = (count: number) => `<html><title>列表</title><body>${Array.from({ length: count }, (_x, i) => `<a href="/article/${i}">人工智能培训项目${i}</a>`).join("")}</body></html>`;
function memoryStore(seen = false) {
  const saved: MaterialInput[] = [];
  const records: unknown[] = [];
  const store: DiscoveryStore = { prepare: async () => true, seen: async () => seen,
    save: async (material) => { saved.push(material); return { articleId: "test", created: true, revised: false, backfill: false }; },
    record: async (_source, evidence) => { records.push(evidence); } };
  return { store, saved, records };
}

test("production configuration is bounded, separates source nature, and contains verified lists plus explicit historical seeds", async () => {
  const got = await loadDiscoveryConfig();
  assert.ok(got.sources.filter((entry) => !entry.seedUrls).length >= 5);
  assert.ok(got.sources.some((entry) => entry.seedUrls));
  assert.ok(got.sources.some((entry) => entry.sourceNature === "peer-self-report"));
  assert.ok(got.queries.every((query) => !query.enabled));
  assert.throws(() => config({ limits: { ...got.limits, detailConcurrency: 3 } }));
  assert.throws(() => config({ sources: [source, source] }));
});
test("listing normalization deduplicates URLs and refuses off-host authority inheritance", () => {
  const got = parseCuratedList('<a href="/article/1?utm_source=x">人工智能培训</a><a href="/article/1">人工智能培训</a><a href="https://other.example/article/2">人工智能培训</a>', source.url, source, 20);
  assert.equal(got.length, 1);
  assert.equal(got[0].indexDateClaim, null);
});
test("listing fallback, empty lists and challenges remain explicit failures", () => {
  assert.throws(() => parseCuratedList(listing(1), source.url, { ...source, expectedListTitle: "工会新闻" }, 20), /title mismatch/);
  assert.throws(() => parseCuratedList("<html>empty</html>", source.url, source, 20), /no matching/);
  assert.throws(() => parseCuratedList("<title>安全验证</title>", source.url, source, 20), /anti-bot/);
  assert.equal(challengePage("<body>您访问过于频繁</body>"), true);
});
test("RSS timestamps are untrusted index claims and non-XML search responses fail", () => {
  const got = parseSearchRss('<rss><channel><item><title>人工智能培训</title><link>https://union.example/article/1</link><pubDate>2026-10-01</pubDate></item></channel></rss>', "https://search.example/rss", 10);
  assert.equal(got[0].indexDateClaim, "2026-10-01");
  assert.throws(() => parseSearchRss("<html>Search results</html>", "https://search.example/rss", 10), /RSS XML/);
});
test("business gate rejects dictionary noise, unrelated AI news, token substrings and distant accidental mentions", () => {
  assert.equal(businessRelevance("人工意思解释和培训", rules), null);
  assert.equal(businessRelevance("人工智能芯片新产品", rules), null);
  assert.equal(businessRelevance("training 企业", rules), null);
  assert.equal(businessRelevance(`AI${"新闻".repeat(200)}培训`, rules), null);
  assert.deepEqual(businessRelevance("WorkBuddy 代理招募", rules), { ai: "WorkBuddy", business: "代理" });
});
test("body gate requires original relevant body and strips page navigation", () => {
  assert.equal(verifyOriginal(article("体育赛事精彩回顾。".repeat(50)), "https://union.example/article/1", rules, now, source), null);
  assert.equal(verifyOriginal(article("人工智能培训"), "https://union.example/article/1", rules, now, source), null);
  const got = verifyOriginal(article(), "https://union.example/article/1", rules, now, source);
  assert.ok(got && got.bodyText.length >= 200);
  assert.equal(got.date?.via, "meta:PubDate");
});
test("original publication metadata handles UTC/China dates and rejects impossible/future dates", () => {
  assert.equal(parsePublicationDate("2026年09月30日 12:00", now)?.toISOString(), "2026-09-30T04:00:00.000Z");
  assert.equal(parsePublicationDate("2026-09-30T12:00:00Z", now)?.toISOString(), "2026-09-30T12:00:00.000Z");
  assert.equal(parsePublicationDate("2026-02-30", now), null);
  assert.equal(parsePublicationDate("2026-10-02", now), null);
  assert.equal(originalDate('<meta name="dateModified" content="2026-09-30"><body>会议时间：2026-09-30</body>', now), null);
  assert.equal(originalDate('<div class="published">时间：2026-09-30 来源：工会</div>', now, source)?.via, "selector:.published");
  assert.equal(originalDate('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-09-30"}</script>', now)?.via, "jsonld:datePublished");
});
test("dry-run is the default and never calls the store", async () => {
  const mem = memoryStore();
  mem.store.prepare = async () => { throw new Error("must not touch DB"); };
  const got = await runBusinessDiscovery(config(), {}, { store: mem.store, now: () => now,
    sleep: async () => {}, fetch: async (url) => response(url.endsWith("/list") ? listing(1) : article(), url) });
  assert.equal(got.dryRun, true);
  assert.equal(got.accepted.length, 1);
  assert.equal(mem.saved.length, 0);
  assert.equal(mem.records.length, 0);
});
test("write mode skips previously seen URLs before original requests", async () => {
  const mem = memoryStore(true);
  let requests = 0;
  const got = await runBusinessDiscovery(config(), { dryRun: false }, { store: mem.store, now: () => now,
    fetch: async (url) => { requests++; return response(listing(2), url); } });
  assert.equal(requests, 1);
  assert.equal(got.sources[0].seen, 2);
  assert.equal(got.detailAttempts, 0);
});
test("write mode stores verified original text, unknown publication date and discovery provenance", async () => {
  const mem = memoryStore();
  const got = await runBusinessDiscovery(config(), { dryRun: false }, { store: mem.store, now: () => now, sleep: async () => {},
    fetch: async (url) => response(url.endsWith("/list") ? listing(1) : article(undefined, ""), url) });
  assert.equal(got.sources[0].created, 1);
  assert.equal(mem.saved[0].publishedAt, null);
  assert.equal(mem.saved[0].bodyStatus, "ok");
  assert.ok(mem.saved[0].bodyText!.length >= 200);
  assert.equal((mem.saved[0].raw as { businessDiscovery: { publicationDateUnknown: boolean } }).businessDiscovery.publicationDateUnknown, true);
});
test("failed or challenged original fetch is run evidence, never a successful material", async () => {
  for (const kind of ["http", "challenge"]) {
    const mem = memoryStore();
    const got = await runBusinessDiscovery(config(), { dryRun: false }, { store: mem.store, now: () => now, sleep: async () => {},
      fetch: async (url) => response(url.endsWith("/list") ? listing(1) : "<title>安全验证</title>", url, !url.endsWith("/list") && kind === "http" ? 403 : 200) });
    assert.equal(got.status, "failed");
    assert.equal(mem.saved.length, 0);
    assert.equal(got.sources[0].errors[0].stage, "original");
  }
});
test("global detail budget bounds concurrency and leaves budget exhaustion visible", async () => {
  let inFlight = 0; let peak = 0;
  const limits = config().limits;
  const got = await runBusinessDiscovery(config({ limits: { ...limits, maxDetails: 2 } }), {}, { now: () => now, sleep: async () => {},
    fetch: async (url) => { if (url.endsWith("/list")) return response(listing(5), url);
      inFlight++; peak = Math.max(peak, inFlight); await new Promise((resolve) => setImmediate(resolve)); inFlight--;
      return response(article(), url); } });
  assert.equal(got.detailAttempts, 2);
  assert.equal(got.requests, 3);
  assert.equal(peak, 2);
  assert.equal(got.budgetExhausted, true);
  assert.equal(got.status, "partial");
});
test("request budget stops originals and a paused source causes no network requests", async () => {
  const got = await runBusinessDiscovery(config({ limits: { ...config().limits, maxRequests: 1 } }), {}, { now: () => now, sleep: async () => {}, fetch: async (url) => response(listing(2), url) });
  assert.equal(got.requests, 1);
  assert.equal(got.accepted.length, 0);
  assert.equal(got.budgetExhausted, true);
  const mem = memoryStore(); mem.store.prepare = async () => false;
  const paused = await runBusinessDiscovery(config(), { dryRun: false }, { store: mem.store, fetch: async () => { throw new Error("must not fetch"); } });
  assert.equal(paused.sources[0].status, "skipped");
});
test("seed cases undergo original/body/date gates and carry explicit historical provenance", async () => {
  const mem = memoryStore();
  await runBusinessDiscovery(config({ sources: [{ ...source, seedUrls: ["https://union.example/article/1"] }] }), { dryRun: false },
    { store: mem.store, now: () => now, fetch: async (url) => response(article(), url) });
  assert.equal((mem.saved[0].raw as { businessDiscovery: { historicalSeed: boolean } }).businessDiscovery.historicalSeed, true);
  assert.equal(mem.saved[0].publishedAt?.toISOString(), "2026-09-30T04:00:00.000Z");
});
test("curated redirect cannot silently inherit original publisher authority", async () => {
  const got = await runBusinessDiscovery(config(), {}, { now: () => now, sleep: async () => {}, fetch: async (url) =>
    response(url.endsWith("/list") ? listing(1) : article(), url.endsWith("/list") ? url : "https://other.example/article/1") });
  assert.equal(got.accepted.length, 0);
  assert.match(got.sources[0].errors[0].error, /different publisher/);
});
test("per-source cap leaves detail budget for later sources and advances past seen URLs", async () => {
  const mem = memoryStore();
  mem.store.seen = async (url) => url.endsWith("/article/0");
  const second = { ...source, id: "business-discovery-second", url: "https://second.example/list" };
  const got = await runBusinessDiscovery(config({ sources: [source, second], limits: { ...config().limits, maxDetailsPerSource: 2 } }), { dryRun: false },
    { store: mem.store, now: () => now, sleep: async () => {}, fetch: async (url) => response(url.endsWith("/list") ? listing(6) : article(), url) });
  assert.equal(got.sources[0].seen, 1);
  assert.equal(got.sources[0].detailAttempts, 2);
  assert.equal(got.sources[0].detailCapped, true);
  assert.equal(got.sources[1].detailAttempts, 2);
  assert.equal(got.accepted.length, 4);
  assert.equal(got.budgetExhausted, false);
});

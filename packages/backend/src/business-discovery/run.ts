import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { guardedFetch, type GuardedFetchOptions, type GuardedResponse } from "../lib/http-fetch.ts";
import { normalizeUrl } from "../lib/url.ts";
import type { MaterialInput, MaterialResult } from "../content/materials.ts";
import type { CuratedSource, DiscoveryConfig, DiscoverySource } from "./config.ts";
import { parseCuratedList, parseSearchRss, titleRelevant, verifyOriginal, type DiscoveryHit } from "./parse.ts";

export interface SourceRun {
  sourceId: string; status: "ok" | "failed" | "skipped"; found: number; relevantTitles: number;
  seen: number; detailAttempts: number; verified: number; created: number; rejected: number;
  errors: Array<{ url: string; stage: "listing" | "original" | "storage" | "budget"; error: string }>;
  skipReason?: string; startedAt: string; finishedAt?: string;
  detailCapped?: boolean;
}
export interface DiscoveryRun {
  id: string; dryRun: boolean; status: "ok" | "partial" | "failed"; startedAt: string; finishedAt: string;
  requests: number; detailAttempts: number; budgetExhausted: boolean; sources: SourceRun[];
  accepted: Array<{ sourceId: string; url: string; title: string; publishedAt: string | null; sourceNature: string; bodyChars: number }>;
}
export interface DiscoveryStore {
  /** Returns false for paused/not-due sources. Registers configured sources only in write mode. */
  prepare(source: DiscoverySource, now: Date): Promise<boolean>;
  seen(url: string): Promise<boolean>;
  save(material: MaterialInput): Promise<MaterialResult>;
  record(source: DiscoverySource, evidence: SourceRun): Promise<void>;
}
export interface DiscoveryDependencies {
  fetch?: (url: string, options: GuardedFetchOptions) => Promise<GuardedResponse>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  store?: DiscoveryStore;
}

class BudgetStop extends Error {}
const briefError = (error: unknown) => String(error instanceof Error ? error.message : error).slice(0, 500);

/** Runs only bounded free HTTP reads. Database writes/queueing live behind the injected store. */
export async function runBusinessDiscovery(config: DiscoveryConfig, options: { dryRun?: boolean; sourceIds?: string[] } = {}, dependencies: DiscoveryDependencies = {}): Promise<DiscoveryRun> {
  const dryRun = options.dryRun !== false;
  if (!dryRun && !dependencies.store) throw new Error("Write mode requires a discovery store");
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? (async (ms: number) => { await wait(ms); });
  const fetch = dependencies.fetch ?? guardedFetch;
  const started = now();
  const deadline = started.getTime() + config.limits.runBudgetMs;
  const report: DiscoveryRun = { id: randomUUID(), dryRun, status: "ok", startedAt: started.toISOString(), finishedAt: "",
    requests: 0, detailAttempts: 0, budgetExhausted: false, sources: [], accepted: [] };
  const visited = new Set<string>();
  // Reserve starts synchronously before yielding; two workers never start together on one host.
  const hostNext = new Map<string, number>();
  const request = async (url: string): Promise<GuardedResponse> => {
    if (report.requests >= config.limits.maxRequests || now().getTime() >= deadline) throw new BudgetStop("request/time budget exhausted");
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const start = Math.max(now().getTime(), hostNext.get(host) ?? 0);
    if (start >= deadline) throw new BudgetStop("host wait exceeds run budget");
    hostNext.set(host, start + config.limits.hostIntervalMs);
    report.requests += 1;
    const delay = start - now().getTime();
    if (delay > 0) await sleep(delay);
    const remaining = deadline - now().getTime();
    if (remaining <= 0) throw new BudgetStop("time budget exhausted");
    const response = await fetch(url, { timeoutMs: Math.min(config.limits.timeoutMs, remaining), maxBytes: config.limits.maxResponseBytes, maxRedirects: 3 });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    return response;
  };
  const entries: Array<{ source: DiscoverySource; curated?: CuratedSource; query?: DiscoveryConfig["queries"][number] }> = [
    ...config.sources.filter((source) => source.enabled).slice(0, config.limits.maxSources).map((curated) => ({ source: curated, curated })),
    ...config.queries.filter((query) => query.enabled).slice(0, config.limits.maxQueries).map((query) => ({ source: { ...query, sourceNature: "search-index" as const, participationMode: "isolated" as const }, query })),
  ].filter((entry) => !options.sourceIds?.length || options.sourceIds.includes(entry.source.id));
  for (const entry of entries) {
    const { source, curated, query } = entry;
    const evidence: SourceRun = { sourceId: source.id, status: "ok", found: 0, relevantTitles: 0, seen: 0, detailAttempts: 0,
      verified: 0, created: 0, rejected: 0, errors: [], startedAt: now().toISOString() };
    report.sources.push(evidence);
    try {
      if (report.budgetExhausted || now().getTime() >= deadline || report.detailAttempts >= config.limits.maxDetails) {
        report.budgetExhausted = true; evidence.status = "skipped"; evidence.skipReason = "run budget exhausted"; continue;
      }
      if (!dryRun && !await dependencies.store!.prepare(source, now())) { evidence.status = "skipped"; evidence.skipReason = "paused or not due"; continue; }
      let hits: DiscoveryHit[];
      if (curated?.seedUrls) {
        hits = curated.seedUrls.slice(0, config.limits.maxListItems).map((url) => ({ url, title: "", discoveredVia: "curated-seed", indexDateClaim: null }));
      } else {
        const listingUrl = curated?.url ?? query!.rssUrlTemplate.replace("{query}", encodeURIComponent(query!.query));
        try {
          const response = await request(listingUrl);
          hits = curated ? parseCuratedList(response.text(), response.url, curated, config.limits.maxListItems)
            : parseSearchRss(response.text(), listingUrl, config.limits.maxHitsPerQuery);
        } catch (error) {
          if (error instanceof BudgetStop) report.budgetExhausted = true;
          evidence.errors.push({ url: listingUrl, stage: error instanceof BudgetStop ? "budget" : "listing", error: briefError(error) });
          evidence.status = "failed"; continue;
        }
      }
      evidence.found = hits.length;
      const candidates = hits.filter((hit) => curated?.seedUrls || titleRelevant(hit.title, config.relevance));
      evidence.relevantTitles = candidates.length;
      let cursor = 0;
      const worker = async () => {
        while (cursor < candidates.length) {
          const hit = candidates[cursor++];
          const key = normalizeUrl(hit.url);
          if (!key || visited.has(key)) { evidence.seen += 1; continue; }
          // In write mode, known URLs are checked before spending the detail request.
          if (!dryRun && await dependencies.store!.seen(hit.url)) { visited.add(key); evidence.seen += 1; continue; }
          if (evidence.detailAttempts >= config.limits.maxDetailsPerSource) { evidence.detailCapped = true; break; }
          if (report.detailAttempts >= config.limits.maxDetails || report.budgetExhausted) { report.budgetExhausted = true; break; }
          visited.add(key);
          report.detailAttempts += 1; evidence.detailAttempts += 1;
          let stage: "original" | "storage" = "original";
          try {
            const response = await request(hit.url);
            const contentType = response.headers.get("content-type") ?? "";
            if (!/html|xhtml/i.test(contentType)) throw new Error(`original is not HTML (${contentType || "unknown content type"})`);
            // List identities apply only to the original host; a redirect cannot inherit authority.
            const sameHost = new URL(response.url).hostname.replace(/^www\./, "") === new URL(hit.url).hostname.replace(/^www\./, "");
            if (curated && !sameHost) throw new Error("original redirected to a different publisher");
            const finalKey = normalizeUrl(response.url);
            if (finalKey !== key) {
              if (!finalKey || visited.has(finalKey) || (!dryRun && await dependencies.store!.seen(response.url))) { evidence.seen += 1; continue; }
              visited.add(finalKey);
            }
            const discoveredAt = now();
            const article = verifyOriginal(response.text(), response.url, config.relevance, discoveredAt, curated);
            if (!article) { evidence.rejected += 1; continue; }
            evidence.verified += 1;
            report.accepted.push({ sourceId: source.id, url: response.url, title: article.title, publishedAt: article.date?.publishedAt?.toISOString() ?? null,
              sourceNature: source.sourceNature, bodyChars: article.bodyText.length });
            if (!dryRun) {
              stage = "storage";
              const saved = await dependencies.store!.save({ sourceId: source.id, url: response.url, title: article.title,
                publishedAt: article.date?.publishedAt ?? null, bodyText: article.bodyText, bodyHtml: article.bodyHtml,
                bodyStatus: "ok", language: "zh", via: "fetch", discoveredAt,
                backfill: curated?.seedUrls ? "curated-historical-seed" : null,
                raw: { businessDiscovery: { version: 1, runId: report.id, sourceNature: source.sourceNature,
                  publisherUrl: response.url, requestedUrl: hit.url, discoveredVia: hit.discoveredVia, query: query?.query ?? null,
                  indexDateClaim: hit.indexDateClaim, indexDateTrusted: false, publishedDateEvidence: article.date ? { value: article.date.value, via: article.date.via } : null,
                  publicationDateUnknown: !article.date?.publishedAt, relevance: article.relevance,
                  historicalSeed: Boolean(curated?.seedUrls), authority: source.sourceNature === "peer-self-report" ? "publisher-self-report" : "publisher-original-page" } },
              });
              if (saved.created) evidence.created += 1;
            }
          } catch (error) {
            if (error instanceof BudgetStop) report.budgetExhausted = true;
            evidence.errors.push({ url: hit.url, stage: error instanceof BudgetStop ? "budget" : stage, error: briefError(error) });
          }
        }
      };
      // Await every in-flight worker even if a DB adapter fails: no writes outlive a finished run.
      const outcomes = await Promise.allSettled(Array.from({ length: config.limits.detailConcurrency }, () => worker()));
      for (const outcome of outcomes) if (outcome.status === "rejected") evidence.errors.push({ url: "", stage: "storage", error: briefError(outcome.reason) });
      if (evidence.errors.length) evidence.status = "failed";
    } catch (error) {
      evidence.status = "failed";
      evidence.errors.push({ url: curated?.url ?? "", stage: "storage", error: briefError(error) });
    } finally {
      evidence.finishedAt = now().toISOString();
      if (!dryRun && evidence.status !== "skipped") {
        try { await dependencies.store!.record(source, evidence); }
        catch (error) { evidence.status = "failed"; evidence.errors.push({ url: "", stage: "storage", error: `run evidence persistence failed: ${briefError(error)}` }); }
      }
    }
  }
  report.finishedAt = now().toISOString();
  const failed = report.sources.filter((source) => source.status === "failed").length;
  report.status = failed ? (failed === report.sources.length ? "failed" : "partial") : report.budgetExhausted ? "partial" : "ok";
  return report;
}

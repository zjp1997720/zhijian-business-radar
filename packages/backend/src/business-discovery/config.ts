import { readFile } from "node:fs/promises";
import { z } from "zod";

const httpUrl = z.url().refine((value) => /^https?:\/\//.test(value), "HTTP(S) URL required");
const source = z.object({
  id: z.string().regex(/^business-discovery-[a-z0-9-]+$/).max(120),
  name: z.string().min(1).max(200),
  enabled: z.boolean().default(true),
  sourceNature: z.enum(["government", "union", "association", "education", "public-institution", "enterprise", "procurement-platform", "peer-self-report", "search-index"]),
  participationMode: z.enum(["editorial", "isolated"]).default("isolated"),
  intervalMinutes: z.number().int().min(60).max(1440).default(360),
  url: httpUrl,
  seedUrls: z.array(httpUrl).min(1).max(20).optional(),
  linkSelector: z.string().min(1).default("a[href]"),
  linkPattern: z.string().min(1).default("^/"),
  titleSelector: z.string().optional(),
  expectedListTitle: z.string().optional(),
  bodySelector: z.string().optional(),
  dateSelector: z.string().optional(),
  verifiedAt: z.string().optional(),
  note: z.string().optional(),
});
const query = z.object({
  id: z.string().regex(/^business-discovery-[a-z0-9-]+$/).max(120),
  name: z.string().min(1).max(200),
  enabled: z.boolean().default(false),
  query: z.string().min(1).max(300),
  // Only an operator-approved public RSS search endpoint. No paid provider fallback.
  rssUrlTemplate: z.string().refine((value) => value.includes("{query}") && /^https?:\/\//.test(value)),
  intervalMinutes: z.number().int().min(60).max(1440).default(720),
});

export const discoveryConfigSchema = z.object({
  version: z.literal(1),
  limits: z.object({
    maxQueries: z.number().int().min(0).max(6).default(6),
    maxHitsPerQuery: z.number().int().min(1).max(10).default(10),
    maxSources: z.number().int().min(1).max(24).default(24),
    maxListItems: z.number().int().min(1).max(20).default(20),
    maxDetails: z.number().int().min(1).max(20).default(20),
    maxDetailsPerSource: z.number().int().min(1).max(10).default(4),
    detailConcurrency: z.number().int().min(1).max(2).default(2),
    hostIntervalMs: z.number().int().min(1000).max(10000).default(1000),
    timeoutMs: z.number().int().min(1000).max(20000).default(12000),
    maxResponseBytes: z.number().int().min(10000).max(3000000).default(1500000),
    maxRequests: z.number().int().min(1).max(60).default(40),
    runBudgetMs: z.number().int().min(1000).max(300000).default(180000),
  }).default({ maxQueries: 6, maxHitsPerQuery: 10, maxSources: 24, maxListItems: 20, maxDetails: 20, maxDetailsPerSource: 4,
    detailConcurrency: 2, hostIntervalMs: 1000, timeoutMs: 12000, maxResponseBytes: 1500000, maxRequests: 40, runBudgetMs: 180000 }),
  relevance: z.object({
    aiTerms: z.array(z.string().min(1)).min(1),
    businessTerms: z.array(z.string().min(1)).min(1),
    maxTermDistance: z.number().int().min(20).max(500).default(240),
    minBodyChars: z.number().int().min(200).max(2000).default(200),
  }),
  sources: z.array(source).max(40),
  queries: z.array(query).max(30).default([]),
}).superRefine((value, ctx) => {
  const ids = new Set<string>();
  for (const entry of [...value.sources, ...value.queries]) {
    if (ids.has(entry.id)) ctx.addIssue({ code: "custom", message: `Duplicate source id: ${entry.id}` });
    ids.add(entry.id);
  }
  for (const item of value.sources) {
    try { new RegExp(item.linkPattern); if (item.expectedListTitle) new RegExp(item.expectedListTitle); }
    catch { ctx.addIssue({ code: "custom", message: `Invalid regex for ${item.id}` }); }
  }
});

export type DiscoveryConfig = z.infer<typeof discoveryConfigSchema>;
export type CuratedSource = DiscoveryConfig["sources"][number];
export interface DiscoverySource {
  id: string; name: string; sourceNature: CuratedSource["sourceNature"];
  participationMode: "editorial" | "isolated"; intervalMinutes: number;
}
export async function loadDiscoveryConfig(path = new URL("../../../../industry/business-discovery.json", import.meta.url)): Promise<DiscoveryConfig> {
  return discoveryConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

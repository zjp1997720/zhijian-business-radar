import * as cheerio from "cheerio";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { normalizeUrl } from "../lib/url.ts";
import { sanitizeBody, trimTrailingChrome } from "../content/sanitize.ts";
import { stripTags, collapseWhitespace } from "../lib/text.ts";
import type { CuratedSource, DiscoveryConfig } from "./config.ts";

export interface DiscoveryHit { url: string; title: string; discoveredVia: string; indexDateClaim: string | null }
export interface DateEvidence { value: string; via: string; publishedAt: Date | null }
export interface VerifiedArticle { title: string; bodyText: string; bodyHtml: string; date: DateEvidence | null; relevance: { ai: string; business: string } }

export function challengePage(html: string): boolean {
  const $ = cheerio.load(html);
  const title = $("title").text();
  $("script,style").remove();
  const text = $("body").text();
  return /验证码|访问验证|安全验证|access denied|just a moment|robot check|attention required/i.test(title)
    || (text.length < 8000 && /您访问过于频繁|访问过于频繁|请完成.{0,8}验证|检测到异常访问|verify you are human|checking your browser/i.test(text));
}

export function parseCuratedList(html: string, baseUrl: string, source: CuratedSource, maxItems: number): DiscoveryHit[] {
  if (challengePage(html)) throw new Error("anti-bot challenge on listing");
  const $ = cheerio.load(html);
  if (source.expectedListTitle && !new RegExp(source.expectedListTitle).test($("title").text())) throw new Error("listing title mismatch (possibly homepage fallback)");
  const pattern = new RegExp(source.linkPattern);
  const host = new URL(baseUrl).hostname.replace(/^www\./, "");
  const seen = new Set<string>();
  const hits: DiscoveryHit[] = [];
  for (const element of $(source.linkSelector).toArray()) {
    const link = $(element);
    let url: URL;
    try { url = new URL(link.attr("href") ?? "", baseUrl); } catch { continue; }
    // An institution listing cannot confer its identity on a linked third party.
    if (!/^https?:$/.test(url.protocol) || url.hostname.replace(/^www\./, "") !== host || !pattern.test(url.pathname)) continue;
    const identity = normalizeUrl(url.href);
    if (!identity || seen.has(identity)) continue;
    const title = collapseWhitespace(source.titleSelector ? link.find(source.titleSelector).first().text() : link.attr("title") || link.text()).slice(0, 1000);
    if (title.length < 5) continue;
    seen.add(identity);
    hits.push({ url: url.href, title, discoveredVia: baseUrl, indexDateClaim: null });
    if (hits.length >= maxItems) break;
  }
  if (!hits.length) throw new Error("listing returned no matching article links");
  return hits;
}

export function parseSearchRss(xml: string, queryUrl: string, maxHits: number): DiscoveryHit[] {
  if (XMLValidator.validate(xml) !== true || !/^\s*(?:<\?xml[^>]*>\s*)?<rss\b/i.test(xml)) throw new Error("search endpoint did not return RSS XML");
  const parsed = new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(xml);
  const items = parsed?.rss?.channel?.item;
  if (!items) return [];
  const seen = new Set<string>();
  return (Array.isArray(items) ? items : [items]).flatMap((item): DiscoveryHit[] => {
    if (typeof item.link !== "string" || typeof item.title !== "string") return [];
    const key = normalizeUrl(item.link);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{ url: item.link, title: item.title.slice(0, 1000), discoveredVia: queryUrl,
      indexDateClaim: typeof item.pubDate === "string" ? item.pubDate : null }];
  }).slice(0, maxHits);
}

// ASCII tokens have word boundaries: "AI" must not match the middle of "training".
function positions(text: string, term: string): number[] {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = /^[a-z0-9]+$/i.test(term) ? `(?<![a-z0-9])${escaped}(?![a-z0-9])` : escaped;
  return [...text.matchAll(new RegExp(pattern, "gi"))].map((match) => match.index!);
}
export function businessRelevance(text: string, rules: DiscoveryConfig["relevance"]): VerifiedArticle["relevance"] | null {
  for (const ai of rules.aiTerms) {
    const a = positions(text, ai);
    if (!a.length) continue;
    for (const business of rules.businessTerms) {
      const b = positions(text, business);
      if (a.some((x) => b.some((y) => Math.abs(x - y) <= rules.maxTermDistance))) return { ai, business };
    }
  }
  return null;
}
export function titleRelevant(title: string, rules: DiscoveryConfig["relevance"]): boolean {
  return rules.aiTerms.some((term) => positions(title, term).length > 0);
}

/** Parse a labelled original-page date. Never use a URL path, RSS date, footer year or event date. */
export function parsePublicationDate(value: string, now: Date): Date | null {
  const text = value.trim().replace(/^.*?(?=(?:发布时间|发布日期|发布于|发表时间)\s*[:：])/, "");
  const m = /^(?:发布时间|发布日期|发布于|发表时间|时间)?\s*[:：]?\s*(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})(?:日)?(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?/.exec(text);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (year < 2000 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  const zone = m[8] ? m[8].replace(/([+-]\d{2})(\d{2})$/, "$1:$2") : "+08:00";
  const pad = (number: number) => String(number).padStart(2, "0");
  const date = new Date(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${zone}`);
  return Number.isFinite(date.getTime()) && date.getTime() <= now.getTime() + 3600000 ? date : null;
}

export function originalDate(html: string, now: Date, source?: CuratedSource): DateEvidence | null {
  const $ = cheerio.load(html);
  const claims: { value: string; via: string }[] = [];
  $("meta").each((_i, el) => {
    const node = $(el);
    const key = node.attr("name") ?? node.attr("property") ?? node.attr("itemprop") ?? "";
    if (/^(article:published_time|pubdate|publishdate|datepublished|publication_date)$/i.test(key)) claims.push({ value: node.attr("content") ?? "", via: `meta:${key}` });
  });
  // The configured selector is scoped to publisher metadata, never a generic body date.
  if (source?.dateSelector) $(source.dateSelector).each((_i, el) => {
    const node = $(el);
    claims.push({ value: collapseWhitespace(node.attr("datetime") ?? node.text()), via: `selector:${source.dateSelector}` });
  });
  $("script[type='application/ld+json']").each((_i, el) => {
    try {
      const walk = (value: unknown, depth: number): void => {
        if (depth > 6 || !value || typeof value !== "object") return;
        if (Array.isArray(value)) { value.slice(0, 30).forEach((child) => walk(child, depth + 1)); return; }
        const obj = value as Record<string, unknown>;
        const type = Array.isArray(obj["@type"]) ? obj["@type"].join(" ") : String(obj["@type"] ?? "");
        if (/Article|BlogPosting/i.test(type) && typeof obj.datePublished === "string") claims.push({ value: obj.datePublished, via: "jsonld:datePublished" });
        if (obj["@graph"]) walk(obj["@graph"], depth + 1);
      };
      walk(JSON.parse($(el).text()), 0);
    } catch { /* malformed page metadata stays untrusted */ }
  });
  $("article time[datetime],main time[datetime]").slice(0, 3).each((_i, el) => { claims.push({ value: $(el).attr("datetime") ?? "", via: "time:datetime" }); });
  for (const claim of claims) {
    const publishedAt = parsePublicationDate(claim.value, now);
    if (publishedAt) return { ...claim, publishedAt };
  }
  return claims[0] ? { ...claims[0], publishedAt: null } : null;
}

export function verifyOriginal(html: string, url: string, rules: DiscoveryConfig["relevance"], now: Date, source?: CuratedSource): VerifiedArticle | null {
  if (challengePage(html)) throw new Error("anti-bot challenge on original page");
  const $ = cheerio.load(html);
  const configuredTitle = source?.titleSelector ? $(source.titleSelector).first() : null;
  const title = collapseWhitespace(configuredTitle?.attr("content") || configuredTitle?.text() || $("meta[name='ArticleTitle']").attr("content") || $("h1").first().text() || $("meta[property='og:title']").attr("content") || $("title").text()).slice(0, 1000);
  if (!title) return null;
  let bodyHtml = "";
  if (source?.bodySelector) {
    const body = $(source.bodySelector).first().clone();
    body.find("script,style,nav,footer,header,aside,form").remove();
    bodyHtml = body.html() ?? "";
  } else {
    $("script,style,nav,footer,header,aside,form").remove();
    const { document } = parseHTML($.html());
    const base = document.createElement("base"); base.setAttribute("href", url); document.head?.appendChild(base);
    bodyHtml = new Readability(document as never, { charThreshold: rules.minBodyChars }).parse()?.content ?? "";
  }
  bodyHtml = trimTrailingChrome(sanitizeBody(bodyHtml, url));
  const bodyText = stripTags(bodyHtml);
  if (bodyText.length < rules.minBodyChars) return null;
  // Title relevance never substitutes for a relevant, actually fetched body.
  const relevance = businessRelevance(bodyText, rules);
  if (!relevance) return null;
  return { title, bodyText, bodyHtml, relevance, date: originalDate(html, now, source) };
}

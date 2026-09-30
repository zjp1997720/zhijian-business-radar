import type { RadarInput } from "./evidence.ts";

const business = /培训|采购|招标|投标|中标|成交|陪跑|咨询|服务商|合作伙伴|伙伴计划|渠道|代理招募|企业.{0,20}(落地|部署|实施)|training|procurement|reseller|consulting|implementation|partner program/i;

/** At most two paid rounds, each with 30 business sources and at most 20 outputs.
 * Tags/discovery sources retain relevant short excerpts without filling the batch with general news. */
export function businessInputBatches(inputs: RadarInput[]): RadarInput[][] {
  const chosen = [...new Map(inputs.filter((s) => s.sourceId.startsWith("business-discovery-") ||
    s.sourceId.startsWith("web-ccgp-") || business.test([s.sourceId, ...(s.tags ?? []), s.title, s.text].join(" ")))
    .map((s) => [s.articleId, s])).values()].slice(0, 60);
  return chosen.length ? [chosen.slice(0, 30), chosen.slice(30)].filter((batch) => batch.length) : [];
}

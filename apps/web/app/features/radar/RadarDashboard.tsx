import { useState } from "react";
import { Link, useNavigation, useRevalidator } from "react-router";
import { Wordmark } from "../../components/Logo";
import { IconArrowRight, IconChevronDown, IconExternal, IconSearch } from "../../components/icons";
import { EmptyState } from "../../components/ui/Page";
import { buttonClass } from "../../components/ui/Controls";
import { beijingDate } from "../../lib/format";
import { opportunityState, radarTime, sourceHref, type RadarOpportunity, type RadarRecommendation, type RadarResponse } from "../../lib/radar";

type View = "overview" | "recommendations" | "opportunities";
type State = RadarOpportunity["status"];
const KINDS = { procurement: "采购招标", demand: "需求信号", channel: "渠道合作", peer: "同行观察", case: "落地案例" };
const STATES = { open: "进行中", unknown: "待确认", historical: "历史参考", closed: "已结束 / 已截止" };
const STATE_ORDER = { open: 0, unknown: 1, historical: 2, closed: 3 };

function SourceLink({ url, title, date }: { url: string; title: string; date?: string | null }) {
  const href = sourceHref(url);
  return (
    <div className="radar-source">
      {href ? <a href={href} target="_blank" rel="noopener noreferrer"><span>{title || "查看原始来源"}</span><IconExternal size={13} /></a> : <span>{title || "原始来源"} · 来源链接待确认</span>}
      {date && <span className="radar-source-date num">{radarTime(date, false)}</span>}
    </div>
  );
}

function Recommendation({ item, index, compact = false }: { item: RadarRecommendation; index: number; compact?: boolean }) {
  const detail = <>
    {compact && item.goal && <p className="radar-detail-goal">{item.goal}</p>}
    <dl className="radar-detail-list">
      <div><dt>受众</dt><dd>{item.audience || "待明确"}</dd></div>
      <div><dt>角度</dt><dd>{item.angle || "待明确"}</dd></div>
    </dl>
    {item.evidenceGaps.length > 0 && <div className="radar-evidence"><p>写作前需补证</p><ul>{item.evidenceGaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></div>}
    <div className="radar-sources">
      {item.sources.length ? item.sources.map((source, i) => <SourceLink key={`${source.url}-${i}`} url={source.url} title={source.title} date={source.publishedAt} />) : <p className="radar-no-source">暂无可核验的公开来源，需补证后使用。</p>}
    </div>
  </>;
  return (
    <article className={`radar-recommendation${index === 0 ? " radar-recommendation-lead" : ""}`}>
      <div className="radar-recommendation-index font-editorial num" aria-label={`推荐顺序 ${index + 1}`}>{String(index + 1).padStart(2, "0")}</div>
      <div className="radar-recommendation-body">
        {!compact && <div className="radar-item-meta">{item.goal && <span>{item.goal}</span>}</div>}
        <h3 className="radar-recommendation-title font-editorial">{item.title}</h3>
        <p className="radar-summary font-editorial">{item.whyNow || "推荐理由待补充。"}</p>
        {compact ? <details className="radar-disclosure"><summary><span>选题角度与来源{item.sources.length > 0 && <span className="radar-source-count"> · {item.sources.length}</span>}</span><IconChevronDown size={15} /></summary>{detail}</details> : detail}
      </div>
    </article>
  );
}

function Opportunity({ item, now }: { item: RadarOpportunity; now: number }) {
  const state = opportunityState(item, now);
  return (
    <article className="radar-opportunity">
      <div className="radar-opportunity-main">
        <div className="radar-item-meta"><span className={`radar-state radar-state-${state}`}>{STATES[state]}</span><span>{KINDS[item.kind]}</span></div>
        <h3 className="radar-opportunity-title font-editorial">{item.title}</h3>
        {(item.organization || item.region) && <p className="radar-organization">{[item.organization, item.region].filter(Boolean).join(" · ")}</p>}
        <p className="radar-summary font-editorial">{item.summary}</p>
        {item.sourceAttribution && <p className="radar-organization">{item.sourceAttribution}</p>}
        {item.deadline && <p className="radar-deadline">截止：<span className="num">{radarTime(item.deadline, !/^\d{4}-\d{2}-\d{2}$/.test(item.deadline))}</span>（北京时间）</p>}
      </div>
      <div className="radar-opportunity-followup"><p className="radar-action-label">建议动作</p><p className="radar-action">{item.recommendedAction || "先核对原始来源、需求与有效期，再决定是否跟进。"}</p><SourceLink url={item.sourceUrl} title="核对原始来源" date={item.publishedAt} /></div>
    </article>
  );
}

function SectionTitle({ title, count, to, children }: { title: string; count: number; to?: string; children: React.ReactNode }) {
  return <div className="radar-section-heading"><div className="radar-section-title-row"><h2 className="font-editorial">{title}<span className="num">{count} 条</span></h2>{to && <Link to={to} className="radar-text-link">查看全部<IconArrowRight size={14} /></Link>}</div><p>{children}</p></div>;
}

export function RadarDashboard({ radar, unavailable, now, view = "overview" }: { radar: RadarResponse | null; unavailable: boolean; now: number; view?: View }) {
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [filter, setFilter] = useState<State | "all">("all");
  const [kindFilter, setKindFilter] = useState<RadarOpportunity["kind"] | "all">("all");
  const busy = navigation.state === "loading" || revalidator.state === "loading";
  const recommendations = radar?.recommendations ?? [];
  const opportunities = [...(radar?.opportunities ?? [])].sort((a, b) => STATE_ORDER[opportunityState(a, now)] - STATE_ORDER[opportunityState(b, now)]);
  const openCount = opportunities.filter((item) => opportunityState(item, now) === "open").length;
  const unknownCount = opportunities.filter((item) => opportunityState(item, now) === "unknown").length;
  const stale = !!radar?.generatedAt && beijingDate(radar.generatedAt) !== beijingDate(now);
  const visibleOpportunities = view === "overview" ? opportunities.slice(0, 4) : opportunities.filter((item) => (filter === "all" || opportunityState(item, now) === filter) && (kindFilter === "all" || item.kind === kindFilter));
  const leadOpportunity = opportunities.find((item) => opportunityState(item, now) === "open") ?? opportunities[0];
  const title = view === "recommendations" ? "推荐选题" : view === "opportunities" ? "商业机会" : "今日业务雷达";
  const description = view === "recommendations" ? "从有据可查的消息出发，找到值得写的受众、角度与业务切入点。" : view === "opportunities" ? "持续积累采购、培训需求、渠道、同行与落地案例，核对有效期后再决定跟进。" : "为培训、账号销售与企业陪跑发现消息、机会和内容切入点。";
  return (
    <div className={`radar-dashboard radar-view-${view}`} aria-busy={busy}>
      <div className="radar-mobile-brand lg:hidden"><Wordmark size={20} /><Link to="/all?search=1" aria-label="搜索行业动态" className="radar-search"><IconSearch size={18} /></Link></div>
      <header className="radar-page-header">
        <div className="radar-page-intro"><h1 className="font-editorial">{title}</h1><p className="font-editorial">{description}</p></div>
        <div className="radar-update"><span>{view === "opportunities" ? "线索更新" : "选题更新"} · <span className="num">{radarTime(view === "opportunities" ? radar?.poolUpdatedAt ?? radar?.generatedAt ?? null : radar?.generatedAt ?? null)}</span></span><button type="button" disabled={busy} onClick={() => revalidator.revalidate()}>{busy ? "正在加载…" : "刷新数据"}<IconArrowRight size={14} /></button></div>
      </header>
      <nav aria-label="雷达视图" className="radar-tabs">{([{ key: "overview", to: "/", label: "今日概览" }, { key: "recommendations", to: "/recommendations", label: "推荐选题" }, { key: "opportunities", to: "/opportunities", label: "商业机会" }] as const).map((tab) => <Link key={tab.key} to={tab.to} aria-current={view === tab.key ? "page" : undefined}>{tab.label}</Link>)}</nav>
      {unavailable ? <div className="radar-empty"><EmptyState title="业务雷达暂时无法加载" action={<button type="button" disabled={busy} className={buttonClass("secondary")} onClick={() => revalidator.revalidate()}>{busy ? "正在重试…" : "重新加载"}</button>}>数据服务暂时不可用。可稍后重试，或继续浏览行业动态。</EmptyState></div> : <>
        {(stale || radar?.status.lastError) && <div role="status" className="radar-status">{radar?.status.lastError ? "最近一次更新未完成，以下保留上次可用结果。" : "以下为最近一期结果，今日推荐尚未更新。"}{radar?.status.lastRunAt && <span> 最近检查：{radarTime(radar.status.lastRunAt)}。</span>}</div>}
        {view === "overview" && leadOpportunity && <a href="#commercial-opportunities" className="radar-opportunity-shortcut"><div><span>商业机会</span><span className="num">{openCount} 条进行中 · {unknownCount} 条待确认</span><IconArrowRight size={15} /></div><p>{STATES[opportunityState(leadOpportunity, now)]} · {leadOpportunity.title}</p></a>}
        <div className="radar-content">
          {view !== "opportunities" && <section className="radar-recommendations-section"><SectionTitle title={stale ? "最近一期选题" : "今日推荐选题"} count={recommendations.length} to={view === "overview" ? "/recommendations" : undefined}>按推荐顺序查看受众、角度与来源，选定后进入写作流程。</SectionTitle><div className="radar-recommendations">{recommendations.length ? recommendations.slice(0, view === "overview" ? 5 : undefined).map((item, index) => <Recommendation key={item.id} item={item} index={index} compact={view === "overview"} />) : <div className="radar-empty"><EmptyState title="暂时没有推荐选题">有足够来源依据后，推荐选题会显示在这里。</EmptyState></div>}</div></section>}
          {view !== "recommendations" && <section id="commercial-opportunities" className="radar-opportunities-section"><SectionTitle title="商业机会" count={opportunities.length} to={view === "overview" ? "/opportunities" : undefined}>{openCount} 条进行中 · {unknownCount} 条待确认。跟进前核对需求、资质与截止时间。</SectionTitle>
            {view === "opportunities" && <div role="group" aria-label="按机会状态筛选" className="radar-filters">{(["all", "open", "unknown", "historical", "closed"] as const).map((state) => <button type="button" key={state} aria-pressed={filter === state} onClick={() => setFilter(state)}>{state === "all" ? "全部" : STATES[state]}</button>)}</div>}
            {view === "opportunities" && <div role="group" aria-label="按机会类型筛选" className="radar-filters">{(["all", ...Object.keys(KINDS)] as const).map((kind) => <button type="button" key={kind} aria-pressed={kindFilter === kind} onClick={() => setKindFilter(kind as RadarOpportunity["kind"] | "all")}>{kind === "all" ? "全部类型" : KINDS[kind as RadarOpportunity["kind"]]}</button>)}</div>}
            <div className="radar-opportunities">{visibleOpportunities.length ? visibleOpportunities.map((item) => <Opportunity key={item.id} item={item} now={now} />) : <div className="radar-empty"><EmptyState title={filter === "all" ? "暂时没有商业机会" : "这个状态下暂无机会"}>公开线索经整理后显示在这里，未知状态的线索会标为待确认。</EmptyState></div>}</div>
          </section>}
        </div>
      </>}
      <footer className="radar-footer"><p>时间均为北京时间。继续查看行业动态、原始来源和历史日报。</p><div><Link to="/all">行业动态</Link><Link to="/selected">精选资讯</Link><Link to="/daily">行业日报</Link></div></footer>
    </div>
  );
}

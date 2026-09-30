import { useState } from "react";
import { Link, useNavigation, useRevalidator } from "react-router";
import { Wordmark } from "../../components/Logo";
import { IconArrowRight, IconExternal, IconSearch } from "../../components/icons";
import { EmptyState } from "../../components/ui/Page";
import { buttonClass } from "../../components/ui/Controls";
import { beijingDate } from "../../lib/format";
import { opportunityState, radarTime, sourceHref, type RadarOpportunity, type RadarRecommendation, type RadarResponse } from "../../lib/radar";

type View = "overview" | "recommendations" | "opportunities";
type State = RadarOpportunity["status"];
const KINDS = { procurement: "采购招标", demand: "需求信号", channel: "渠道合作", case: "落地案例" };
const STATES = { open: "进行中", unknown: "待确认", historical: "历史参考", closed: "已结束 / 已截止" };
const STATE_ORDER = { open: 0, unknown: 1, historical: 2, closed: 3 };

function SourceLink({ url, title, date }: { url: string; title: string; date?: string | null }) {
  const href = sourceHref(url);
  return (
    <div className="min-w-0">
      {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-start gap-1.5 text-[12px] leading-relaxed text-accent hover:underline"><span className="break-words">{title || "查看原始来源"}</span><IconExternal size={12} className="mt-1 shrink-0" /></a> : <span className="text-[12px] text-ink-4">{title || "原始来源"} · 来源链接待确认</span>}
      {date && <span className="ml-2 inline-block text-[11px] text-ink-4">{radarTime(date, false)}</span>}
    </div>
  );
}

function Recommendation({ item, index }: { item: RadarRecommendation; index: number }) {
  return (
    <article className="card overflow-hidden">
      <div className="p-5 sm:p-6">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-4"><span className="font-semibold text-accent">优先 {index + 1}</span>{item.goal && <span>{item.goal}</span>}</div>
        <h3 className="text-[18px] font-semibold leading-[1.5] text-ink sm:text-[20px]">{item.title}</h3>
        <p className="mt-3 text-[13.5px] leading-[1.8] text-ink-2">{item.whyNow || "推荐理由待补充。"}</p>
        <dl className="mt-4 space-y-2.5 text-[13px] leading-[1.75]">
          <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-3"><dt className="text-ink-4">受众</dt><dd className="text-ink-2">{item.audience || "待明确"}</dd></div>
          <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-3"><dt className="text-ink-4">角度</dt><dd className="text-ink-2">{item.angle || "待明确"}</dd></div>
        </dl>
        {item.evidenceGaps.length > 0 && <div className="mt-4 rounded-control bg-bg-sunk px-3.5 py-3 text-[12.5px] leading-[1.75]"><p className="font-medium text-ink-2">写作前需补证</p><ul className="mt-1 list-disc space-y-1 pl-4 text-ink-3">{item.evidenceGaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></div>}
      </div>
      <div className="space-y-1.5 border-t border-line-soft px-5 py-3.5 sm:px-6">
        {item.sources.length ? item.sources.map((source, i) => <SourceLink key={`${source.url}-${i}`} url={source.url} title={source.title} date={source.publishedAt} />) : <p className="text-[12px] text-ink-4">暂无可核验的公开来源，需补证后使用。</p>}
      </div>
    </article>
  );
}

function Opportunity({ item, now }: { item: RadarOpportunity; now: number }) {
  const state = opportunityState(item, now);
  const stateClass = state === "open" ? "bg-accent-soft text-accent-ink" : "bg-bg-sunk text-ink-3";
  return (
    <article className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2 text-[11px]"><span className={`rounded px-2 py-1 font-medium ${stateClass}`}>{STATES[state]}</span><span className="text-ink-4">{KINDS[item.kind]}</span></div>
      <h3 className="mt-3 text-[16px] font-semibold leading-[1.65] text-ink sm:text-[17px]">{item.title}</h3>
      {(item.organization || item.region) && <p className="mt-1.5 text-[12px] leading-relaxed text-ink-4">{[item.organization, item.region].filter(Boolean).join(" · ")}</p>}
      <p className="mt-3 text-[13px] leading-[1.8] text-ink-2">{item.summary}</p>
      {item.deadline && <p className="mt-3 text-[12px] text-ink-3">截止：<span className="num">{radarTime(item.deadline, !/^\d{4}-\d{2}-\d{2}$/.test(item.deadline))}</span>（北京时间）</p>}
      <div className="mt-4 border-t border-line-soft pt-3.5"><p className="text-[11.5px] font-medium text-ink-4">建议动作</p><p className="mt-1 text-[13px] leading-[1.75] text-ink-2">{item.recommendedAction || "先核对原始来源、需求与有效期，再决定是否跟进。"}</p></div>
      <div className="mt-3"><SourceLink url={item.sourceUrl} title="核对原始来源" date={item.publishedAt} /></div>
    </article>
  );
}

function SectionTitle({ title, count, to, children }: { title: string; count: number; to?: string; children: React.ReactNode }) {
  return <div className="mb-4"><div className="flex items-center justify-between gap-3"><h2 className="text-[19px] font-semibold text-ink">{title}<span className="ml-2 text-[12px] font-normal text-ink-4">{count} 条</span></h2>{to && <Link to={to} className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent">查看全部<IconArrowRight size={13} /></Link>}</div><p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-4">{children}</p></div>;
}

export function RadarDashboard({ radar, unavailable, now, view = "overview" }: { radar: RadarResponse | null; unavailable: boolean; now: number; view?: View }) {
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [filter, setFilter] = useState<State | "all">("all");
  const busy = navigation.state === "loading" || revalidator.state === "loading";
  const recommendations = radar?.recommendations ?? [];
  const opportunities = [...(radar?.opportunities ?? [])].sort((a, b) => STATE_ORDER[opportunityState(a, now)] - STATE_ORDER[opportunityState(b, now)]);
  const openCount = opportunities.filter((item) => opportunityState(item, now) === "open").length;
  const unknownCount = opportunities.filter((item) => opportunityState(item, now) === "unknown").length;
  const stale = !!radar?.generatedAt && beijingDate(radar.generatedAt) !== beijingDate(now);
  const visibleOpportunities = view === "overview" ? opportunities.slice(0, 4) : opportunities.filter((item) => filter === "all" || opportunityState(item, now) === filter);
  const leadOpportunity = opportunities.find((item) => opportunityState(item, now) === "open") ?? opportunities[0];
  const title = view === "recommendations" ? "推荐选题" : view === "opportunities" ? "商业机会" : "今日业务雷达";
  return (
    <div className="pb-8 pt-5 lg:pt-0" aria-busy={busy}>
      <div className="mb-6 flex items-center justify-between lg:hidden"><Wordmark size={20} /><Link to="/all?search=1" aria-label="搜索行业动态" className="grid size-10 place-items-center rounded-control border border-line text-ink-3"><IconSearch size={18} /></Link></div>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div><div className="mb-2 text-[11.5px] font-medium text-accent">WorkBuddy · AI 培训 · 企业落地</div><h1 className="text-[26px] font-semibold leading-[1.3] tracking-tight text-ink sm:text-[30px]">{title}</h1><p className="mt-2 max-w-[620px] text-[13px] leading-[1.8] text-ink-3">为培训、账号销售与企业陪跑发现消息、机会和内容切入点。</p></div>
        <div className="flex w-full flex-wrap items-center gap-3 text-[11.5px] text-ink-4 sm:w-auto sm:flex-col sm:items-end sm:gap-2"><span>北京时间 · {radarTime(radar?.generatedAt ?? null)}</span><button type="button" disabled={busy} onClick={() => revalidator.revalidate()} className="min-h-9 rounded-control border border-line px-3 text-[12px] font-medium text-ink-3 hover:bg-bg-sunk disabled:opacity-50">{busy ? "正在加载…" : "刷新数据"}</button></div>
      </header>
      <nav aria-label="雷达视图" className="mb-6 mt-4 flex flex-wrap gap-2">{([{ key: "overview", to: "/", label: "今日概览" }, { key: "recommendations", to: "/recommendations", label: "推荐选题" }, { key: "opportunities", to: "/opportunities", label: "商业机会" }] as const).map((tab) => <Link key={tab.key} to={tab.to} aria-current={view === tab.key ? "page" : undefined} className={`rounded-control px-3.5 py-2 text-[13px] font-medium ${view === tab.key ? "bg-accent-soft text-accent-ink" : "text-ink-3 hover:bg-bg-sunk"}`}>{tab.label}</Link>)}</nav>
      {unavailable ? <div className="card"><EmptyState title="业务雷达暂时无法加载" action={<button type="button" disabled={busy} className={buttonClass("secondary")} onClick={() => revalidator.revalidate()}>{busy ? "正在重试…" : "重新加载"}</button>}>数据服务暂时不可用。可稍后重试，或继续浏览行业动态。</EmptyState></div> : <>
        {(stale || radar?.status.lastError) && <div role="status" className="mb-5 rounded-control border border-line bg-bg-sunk px-4 py-3 text-[12.5px] leading-[1.75] text-ink-3">{radar?.status.lastError ? "最近一次更新未完成，以下保留上次可用结果。" : "以下为最近一期结果，今日推荐尚未更新。"}{radar?.status.lastRunAt && <span className="ml-1">最近检查：{radarTime(radar.status.lastRunAt)}。</span>}</div>}
        {view === "overview" && leadOpportunity && <a href="#commercial-opportunities" className="mb-6 block rounded-control border border-line bg-surface px-4 py-3 xl:hidden"><div className="flex items-center justify-between gap-2 text-[12px]"><span className="font-semibold text-ink">商业机会</span><span className="text-ink-4">{openCount} 条进行中 · {unknownCount} 条待确认</span></div><p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{STATES[opportunityState(leadOpportunity, now)]} · {leadOpportunity.title}</p></a>}
        <div className={view === "overview" ? "grid items-start gap-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]" : "max-w-[940px]"}>
          {view !== "opportunities" && <section><SectionTitle title={stale ? "最近一期选题" : "今日推荐选题"} count={recommendations.length} to={view === "overview" ? "/recommendations" : undefined}>按推荐顺序查看受众、角度与来源，选定后进入写作流程。</SectionTitle><div className="space-y-4">{recommendations.length ? recommendations.slice(0, view === "overview" ? 5 : undefined).map((item, index) => <Recommendation key={item.id} item={item} index={index} />) : <div className="card"><EmptyState title="暂时没有推荐选题">有足够来源依据后，推荐选题会显示在这里。</EmptyState></div>}</div></section>}
          {view !== "recommendations" && <section id="commercial-opportunities" className="scroll-mt-6"><SectionTitle title="商业机会" count={opportunities.length} to={view === "overview" ? "/opportunities" : undefined}>{openCount} 条进行中 · {unknownCount} 条待确认。跟进前核对需求、资质与截止时间。</SectionTitle>
            {view === "opportunities" && <div role="group" aria-label="按机会状态筛选" className="mb-4 flex flex-wrap gap-2">{(["all", "open", "unknown", "historical", "closed"] as const).map((state) => <button type="button" key={state} aria-pressed={filter === state} onClick={() => setFilter(state)} className={`min-h-9 rounded-control border px-3 text-[12px] ${filter === state ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-ink-3 hover:bg-bg-sunk"}`}>{state === "all" ? "全部" : STATES[state]}</button>)}</div>}
            <div className="space-y-4">{visibleOpportunities.length ? visibleOpportunities.map((item) => <Opportunity key={item.id} item={item} now={now} />) : <div className="card"><EmptyState title={filter === "all" ? "暂时没有商业机会" : "这个状态下暂无机会"}>公开线索经整理后显示在这里，未知状态的线索会标为待确认。</EmptyState></div>}</div>
          </section>}
        </div>
      </>}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5"><p className="text-[12px] leading-relaxed text-ink-4">继续查看行业动态、原始来源和历史日报。</p><div className="flex gap-4 text-[12.5px] font-medium text-accent"><Link to="/all">行业动态</Link><Link to="/selected">精选资讯</Link><Link to="/daily">行业日报</Link></div></div>
    </div>
  );
}

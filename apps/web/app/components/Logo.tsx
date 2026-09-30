// The site's wordmark (its name from industry/site.ts, set in type) and a small ring mark used as the
// loader. A site with its own logo can replace Wordmark here.
import { SITE } from "@aihot/industry/site";

export function Wordmark({ size = 22, className = "" }: { size?: number; className?: string }) {
  const splitName = SITE.name === "WorkBuddy做大做强";
  return (
    <span className={`inline-flex shrink-0 items-center gap-[0.55em] whitespace-nowrap ${className}`} style={{ fontSize: size }} aria-label={SITE.name} role="img">
      <span aria-hidden="true" className="inline-block h-[1.7em] w-[2px] shrink-0 bg-accent" />
      <span aria-hidden="true" className="inline-flex flex-col items-start gap-[0.28em] leading-none">
        <span className="font-semibold tracking-[-0.035em]">{splitName ? "WorkBuddy" : SITE.name}</span>
        {splitName && <span className="font-editorial text-[0.64em] font-medium tracking-[0.18em] text-ink-3">做大做强</span>}
      </span>
    </span>
  );
}

/** A ring with a dot; spinning, it is the loader. */
export function RingMark({ className = "", spinning = false }: { className?: string; spinning?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g style={spinning ? { transformOrigin: "12px 12px", animation: "spin-slow 1.1s linear infinite" } : undefined}>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="42 15" />
      </g>
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    </svg>
  );
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { opportunityState, radarTime, sourceHref, type RadarOpportunity } from "../app/lib/radar.ts";

const now = Date.parse("2026-10-01T12:00:00+08:00");
const item: RadarOpportunity = { id: "test", title: "测试", kind: "procurement", summary: "", organization: null, region: null, deadline: null, status: "unknown", recommendedAction: "", sourceUrl: "https://example.com", publishedAt: null };

test("unknown stays unconfirmed and case stays historical even if marked open", () => {
  assert.equal(opportunityState(item, now), "unknown");
  assert.equal(opportunityState({ ...item, kind: "case", status: "open" }, now), "historical");
});

test("expired procurement closes; date-only deadlines remain open through Beijing calendar day", () => {
  assert.equal(opportunityState({ ...item, status: "open", deadline: "2026-09-30" }, now), "closed");
  assert.equal(opportunityState({ ...item, status: "open", deadline: "2026-10-01" }, now), "open");
  assert.equal(opportunityState({ ...item, status: "open", deadline: "2026-10-01T03:00:00Z" }, now), "closed");
});

test("source links only allow HTTP(S); time is Beijing regardless of host zone", () => {
  assert.equal(sourceHref("javascript:alert(1)"), null);
  assert.equal(sourceHref("/relative"), null);
  assert.equal(sourceHref("https://example.com/source"), "https://example.com/source");
  assert.match(radarTime("2026-09-30T23:30:00Z"), /2026.*10.*01.*07:30/);
  assert.equal(radarTime("invalid"), "时间待确认");
});

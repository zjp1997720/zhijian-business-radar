import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fromDocusaurusChangelog } from "@aihot/backend/sources/web-list";
import type { SourceRow } from "@aihot/backend/sources/types";

test("VitePress WorkBuddy changelog preserves individual sections and dates", () => {
  const base = "https://www.codebuddy.cn/docs/workbuddy/Changelog";
  const source = { id: "workbuddy", config: { url: base, preserveUrlFragment: true } } as unknown as SourceRow;
  const rows = fromDocusaurusChangelog('<div class="vp-doc"><h2 id="v2">2026-09-29 v2.0<a>#</a></h2><p>企业知识库更新</p><h2 id="v1">2026-09-20 v1.9</h2><p>新增分享功能</p></div>', base, source);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.url, `${base}#v2`);
  assert.equal(rows[0]!.publishedAt?.toISOString(), "2026-09-28T16:00:00.000Z");
  assert.match(rows[0]!.bodyText!, /企业知识库更新/);
  assert.doesNotMatch(rows[0]!.bodyText!, /新增分享/);
});

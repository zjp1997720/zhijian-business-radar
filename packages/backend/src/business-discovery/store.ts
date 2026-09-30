import { sql } from "../db.ts";
import { identityKeyForUrl } from "../lib/url.ts";
import { upsertMaterial } from "../content/materials.ts";
import { queueProcessing } from "../jobs/content.ts";
import type { DiscoveryStore } from "./run.ts";

/** Database adapter. No public endpoint accepts full text and no license is inferred. */
export function databaseDiscoveryStore(options: { forceDue?: boolean; queue?: boolean } = {}): DiscoveryStore {
  return {
    async prepare(source, now) {
      const [row] = await sql<{ enabled: boolean; next_fetch_at: Date | null }[]>`
        INSERT INTO sources (id, name, kind, config, tier, participation_mode, first_party, interval_minutes,
          tags, site_fulltext, syndicate_fulltext, enabled, health)
        VALUES (${source.id}, ${source.name}, 'external', ${sql.json({ businessDiscovery: true, sourceNature: source.sourceNature })},
          'T2', ${source.participationMode}, false, ${source.intervalMinutes}, ${["business-discovery", `nature:${source.sourceNature}`]}, false, false, true, 'unknown')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, participation_mode = EXCLUDED.participation_mode,
          interval_minutes = EXCLUDED.interval_minutes, site_fulltext = false, syndicate_fulltext = false,
          config = EXCLUDED.config, updated_at = now()
        RETURNING enabled, next_fetch_at`;
      return row.enabled && (options.forceDue || !row.next_fetch_at || new Date(row.next_fetch_at).getTime() <= now.getTime());
    },
    async seen(url) {
      const key = identityKeyForUrl(url);
      if (!key) return false;
      const [row] = await sql`SELECT id FROM articles WHERE identity_key = ${key} LIMIT 1`;
      return Boolean(row);
    },
    async save(material) {
      return sql.begin(async (tx) => {
        const result = await upsertMaterial(material, tx);
        if (options.queue !== false && (result.created || result.revised)) await queueProcessing(result.articleId, { db: tx });
        return result;
      });
    },
    async record(source, evidence) {
      await sql`INSERT INTO fetch_runs (source_id, started_at, finished_at, status, found_count, new_count, error, detail)
        VALUES (${source.id}, ${evidence.startedAt}, ${evidence.finishedAt!}, ${evidence.status}, ${evidence.found}, ${evidence.created},
          ${evidence.errors.length ? evidence.errors.map((item) => item.error).join("; ").slice(0, 2000) : null}, ${sql.json(evidence as never)})`;
      const failed = evidence.status === "failed";
      await sql`UPDATE sources SET last_fetch_at = now(),
        last_ok_at = CASE WHEN ${failed} THEN last_ok_at ELSE now() END,
        fail_count = CASE WHEN ${failed} THEN fail_count + 1 ELSE 0 END,
        health = CASE WHEN ${failed} THEN 'degraded' ELSE 'ok' END,
        last_error = ${failed ? evidence.errors.map((item) => item.error).join("; ").slice(0, 2000) : null},
        next_fetch_at = now() + (${source.intervalMinutes} * interval '1 minute'), updated_at = now()
        WHERE id = ${source.id}`;
    },
  };
}

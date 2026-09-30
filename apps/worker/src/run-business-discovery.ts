// Default: free HTTP reads only. --write opts into database insertion and the existing processing queue.
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadDiscoveryConfig } from "@aihot/backend/business-discovery/config";
import { runBusinessDiscovery } from "@aihot/backend/business-discovery/run";

const args = parseArgs({ options: {
  write: { type: "boolean", default: false }, "dry-run": { type: "boolean", default: false },
  config: { type: "string" }, source: { type: "string", multiple: true },
  "force-due": { type: "boolean", default: false }, "no-queue": { type: "boolean", default: false },
} });
if (args.values.write && args.values["dry-run"]) throw new Error("Choose --write or --dry-run");
let cleanup: (() => Promise<void>) | undefined;
try {
  const config = await loadDiscoveryConfig(args.values.config ? pathToFileURL(resolve(args.values.config)) : undefined);
  let store;
  if (args.values.write) {
    const { databaseDiscoveryStore } = await import("@aihot/backend/business-discovery/store");
    const { closeDb } = await import("@aihot/backend/db");
    const { stopBoss } = await import("@aihot/backend/jobs/queue");
    store = databaseDiscoveryStore({ forceDue: args.values["force-due"], queue: !args.values["no-queue"] });
    cleanup = async () => { await stopBoss(); await closeDb(); };
  }
  const report = await runBusinessDiscovery(config, { dryRun: !args.values.write, sourceIds: args.values.source }, { store });
  console.log(JSON.stringify(report));
  if (report.status === "failed" || report.status === "partial") process.exitCode = 1;
} finally {
  await cleanup?.();
}

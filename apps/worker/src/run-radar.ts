// Manual generation: node --env-file-if-exists=.env apps/worker/src/run-radar.ts
import { generateRadar } from "@aihot/backend/radar/generate";
import { closeDb } from "@aihot/backend/db";
try {
  const result = await generateRadar();
  console.log(JSON.stringify(result));
  if (result.status === "failed") process.exitCode = 1;
} finally {
  await closeDb();
}

import { apiGet } from "./api.server";
import type { RadarResponse } from "./radar";

export async function loadRadar(request: Request) {
  const now = Date.now();
  try {
    const radar = await apiGet<RadarResponse>("/api/site/radar", { signal: request.signal });
    return { radar: { ...radar, status: { ...radar.status, lastError: radar.status.lastError ? "update_failed" : null } }, unavailable: false, now };
  } catch (error) {
    if (request.signal.aborted) throw error;
    return { radar: null, unavailable: true, now };
  }
}

export function radarHeaders() {
  return { "Cache-Control": "private, no-store" };
}

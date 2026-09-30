import { useLoaderData } from "react-router";
import type { Route } from "./+types/radar-opportunities";
import { loadRadar, radarHeaders } from "../lib/radar.server";
import { pageMeta } from "../lib/seo";
import { RadarDashboard } from "../features/radar/RadarDashboard";

export async function loader({ request }: Route.LoaderArgs) {
  return loadRadar(request);
}

export const headers = radarHeaders;
export function meta() { return pageMeta({ title: "商业机会", path: "/opportunities", noindex: true }); }
export default function Page() {
  const data = useLoaderData<typeof loader>();
  return <RadarDashboard {...data} view="opportunities" />;
}

import { useLoaderData } from "react-router";
import type { Route } from "./+types/radar-recommendations";
import { loadRadar, radarHeaders } from "../lib/radar.server";
import { pageMeta } from "../lib/seo";
import { RadarDashboard } from "../features/radar/RadarDashboard";

export async function loader({ request }: Route.LoaderArgs) {
  return loadRadar(request);
}

export const headers = radarHeaders;
export function meta() { return pageMeta({ title: "推荐选题", path: "/recommendations", noindex: true }); }
export default function Page() {
  const data = useLoaderData<typeof loader>();
  return <RadarDashboard {...data} view="recommendations" />;
}

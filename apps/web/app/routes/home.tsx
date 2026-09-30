import { useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/home";
import { loadRadar, radarHeaders } from "../lib/radar.server";
import { pageMeta } from "../lib/seo";
import { RadarDashboard } from "../features/radar/RadarDashboard";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  if (["q", "category", "channel", "tag"].some((key) => url.searchParams.has(key))) {
    throw redirect(`${url.searchParams.has("q") ? "/all" : "/selected"}${url.search}`);
  }
  return loadRadar(request);
}

export const headers = radarHeaders;
export function meta() { return pageMeta({ title: "业务雷达", path: "/", noindex: true }); }
export default function Page() {
  const data = useLoaderData<typeof loader>();
  return <RadarDashboard {...data} view="overview" />;
}

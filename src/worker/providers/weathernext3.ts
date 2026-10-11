// WeatherNext 3 (Google DeepMind) through its BigQuery linked dataset.
// Schema: https://storage.googleapis.com/weathernext-public/colabs/WeatherNext_3_Starter_Guide_BigQuery_0p1deg.ipynb
//
// Every hour a new "interim" run covers the next 48 h; the 00/06/12/18 UTC runs reach 360 h.
// We stitch the freshest run (first 48 h) onto the latest long run (the rest of the 7 days).

import type { HourPoint, ModelRun } from "../../shared/types";
import { popFromPercentiles, windDirection } from "../../shared/weather";
import { googleAccessToken } from "../google-auth";
import { finishHour, inWindow } from "./common";

export interface Wn3Config {
  serviceAccountJson: string;
  projectId: string;
  table: string;
  maxBytesBilled: string;
}

const COLUMNS = [
  "temperature_2m_mean",
  "temperature_2m_p10",
  "temperature_2m_p90",
  "dewpoint_temperature_2m_mean",
  "total_precipitation_1hr_mean",
  "total_precipitation_1hr_p10",
  "total_precipitation_1hr_p25",
  "total_precipitation_1hr_p50",
  "total_precipitation_1hr_p75",
  "total_precipitation_1hr_p90",
  "total_cloud_cover_mean",
  "wind_speed_10m_mean",
  "u_component_of_wind_10m_mean",
  "v_component_of_wind_10m_mean",
  "mean_sea_level_pressure_mean",
  "surface_solar_radiation_downwards_1hr_mean",
] as const;

type Column = (typeof COLUMNS)[number];

function buildSql(table: string): string {
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(table)) throw new Error("WN3_TABLE must be project.dataset.table");
  const cols = COLUMNS.map((c) => `f.${c}`).join(", ");
  return `
WITH nearest AS (
  SELECT t.init_time, t.forecast
  FROM \`${table}\` AS t
  WHERE t.init_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 HOUR)
    AND ST_DWITHIN(t.geography, ST_GEOGPOINT(@lon, @lat), 9000)
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY t.init_time ORDER BY ST_DISTANCE(t.geography, ST_GEOGPOINT(@lon, @lat))
  ) = 1
),
fresh AS (SELECT * FROM nearest ORDER BY init_time DESC LIMIT 1),
long_run AS (
  SELECT * FROM nearest WHERE MOD(EXTRACT(HOUR FROM init_time), 6) = 0 ORDER BY init_time DESC LIMIT 1
)
SELECT 'fresh' AS src, r.init_time, f.time, ${cols}
FROM fresh AS r, UNNEST(r.forecast) AS f
UNION ALL
SELECT 'long' AS src, r.init_time, f.time, ${cols}
FROM long_run AS r, UNNEST(r.forecast) AS f
WHERE f.time <= TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 170 HOUR)`;
}

interface BqResponse {
  jobComplete: boolean;
  jobReference: { projectId: string; jobId: string; location?: string };
  schema?: { fields: { name: string }[] };
  rows?: { f: { v: string | null }[] }[];
  errors?: unknown[];
  error?: { message: string };
}

async function runQuery(cfg: Wn3Config, lat: number, lon: number): Promise<Record<string, string | null>[]> {
  const token = await googleAccessToken(cfg.serviceAccountJson, "https://www.googleapis.com/auth/bigquery");
  const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(cfg.projectId)}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  let res = await fetch(`${base}/queries`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: buildSql(cfg.table),
      useLegacySql: false,
      useQueryCache: true,
      maximumBytesBilled: cfg.maxBytesBilled,
      timeoutMs: 20_000,
      parameterMode: "NAMED",
      queryParameters: [
        { name: "lat", parameterType: { type: "FLOAT64" }, parameterValue: { value: String(lat) } },
        { name: "lon", parameterType: { type: "FLOAT64" }, parameterValue: { value: String(lon) } },
      ],
    }),
  });
  let body = (await res.json()) as BqResponse;
  if (!res.ok) throw new Error(`BigQuery: ${body.error?.message ?? res.status}`);

  for (let i = 0; !body.jobComplete && i < 6; i++) {
    const { jobId, location } = body.jobReference;
    const q = new URLSearchParams({ timeoutMs: "10000", ...(location ? { location } : {}) });
    res = await fetch(`${base}/queries/${jobId}?${q}`, { headers });
    body = (await res.json()) as BqResponse;
    if (!res.ok) throw new Error(`BigQuery: ${body.error?.message ?? res.status}`);
  }
  if (!body.jobComplete) throw new Error("BigQuery query timed out");

  const names = body.schema?.fields.map((f) => f.name) ?? [];
  return (body.rows ?? []).map((r) => Object.fromEntries(r.f.map((c, i) => [names[i]!, c.v])));
}

const tsToIso = (v: string | null | undefined) => new Date(Number(v) * 1000).toISOString();

export async function fetchWeatherNext3(
  cfg: Wn3Config,
  lat: number,
  lon: number,
): Promise<{ hours: HourPoint[]; runs: ModelRun[] }> {
  const rows = await runQuery(cfg, lat, lon);
  if (!rows.length) throw new Error("WeatherNext 3 returned no rows for this location");

  const byTime = new Map<string, Record<string, string | null>>();
  for (const r of rows) {
    const t = tsToIso(r.time);
    if (r.src === "fresh" || !byTime.has(t)) byTime.set(t, r);
  }

  const n = (r: Record<string, string | null>, c: Column) => Number(r[c] ?? NaN);
  const hours: HourPoint[] = [];
  for (const [t, r] of [...byTime.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!inWindow(Date.parse(t))) continue;
    const k = (c: Column) => n(r, c) - 273.15;
    const mm = (c: Column) => Math.max(0, n(r, c) * 1000);
    const u = n(r, "u_component_of_wind_10m_mean");
    const v = n(r, "v_component_of_wind_10m_mean");
    const pressure = n(r, "mean_sea_level_pressure_mean");
    const solar = n(r, "surface_solar_radiation_downwards_1hr_mean");
    hours.push(
      finishHour(
        {
          t,
          temp: k("temperature_2m_mean"),
          tempLo: k("temperature_2m_p10"),
          tempHi: k("temperature_2m_p90"),
          dew: k("dewpoint_temperature_2m_mean"),
          precip: mm("total_precipitation_1hr_mean"),
          precipHi: mm("total_precipitation_1hr_p90"),
          pop: popFromPercentiles({
            p10: mm("total_precipitation_1hr_p10"),
            p25: mm("total_precipitation_1hr_p25"),
            p50: mm("total_precipitation_1hr_p50"),
            p75: mm("total_precipitation_1hr_p75"),
            p90: mm("total_precipitation_1hr_p90"),
          }),
          cloud: Math.min(100, Math.max(0, n(r, "total_cloud_cover_mean") * 100)),
          wind: n(r, "wind_speed_10m_mean") * 3.6,
          windDir: Number.isFinite(u) && Number.isFinite(v) ? windDirection(u, v) : null,
          pressure: Number.isFinite(pressure) ? pressure / 100 : null,
          solar: Number.isFinite(solar) ? Math.max(0, solar / 3600) : null,
        },
        lat,
        lon,
      ),
    );
  }

  const runs: ModelRun[] = [];
  const fresh = rows.find((r) => r.src === "fresh");
  const long = rows.find((r) => r.src === "long");
  if (fresh) runs.push({ model: "WeatherNext 3", init: tsToIso(fresh.init_time), span: "0–48 h" });
  if (long && long.init_time !== fresh?.init_time)
    runs.push({ model: "WeatherNext 3", init: tsToIso(long.init_time), span: "48–168 h" });
  return { hours, runs };
}

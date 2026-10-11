// Fallback: Google WeatherNext 2 ensemble (64 members) served openly by Open-Meteo.
// Used while WeatherNext 3 credentials are not configured or BigQuery is unavailable.
// Native 6-hourly steps are interpolated to hourly by Open-Meteo.

import type { HourPoint, ModelRun } from "../../shared/types";
import { quantile, roundTo } from "../../shared/weather";
import { finishHour, HORIZON_HOURS, inWindow } from "./common";

const MODEL = "google_weathernext2_ensemble";
const VARS = ["temperature_2m", "precipitation", "cloud_cover", "wind_speed_10m", "wind_direction_10m", "pressure_msl"];

interface EnsembleResponse {
  timezone: string;
  hourly: Record<string, (number | null)[]> & { time: number[] };
}

function members(h: EnsembleResponse["hourly"], v: string, i: number): number[] {
  const out: number[] = [];
  for (const key of Object.keys(h)) {
    if (key === v || key.startsWith(`${v}_member`)) {
      const x = h[key]?.[i];
      if (typeof x === "number" && Number.isFinite(x)) out.push(x);
    }
  }
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

export async function fetchWeatherNext2(lat: number, lon: number): Promise<{ hours: HourPoint[]; runs: ModelRun[] }> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: VARS.join(","),
    models: MODEL,
    timeformat: "unixtime",
    timezone: "GMT",
    past_hours: "2",
    forecast_hours: String(HORIZON_HOURS + 2),
  });
  const [res, meta] = await Promise.all([
    fetch(`https://ensemble-api.open-meteo.com/v1/ensemble?${params}`),
    fetch(`https://ensemble-api.open-meteo.com/data/${MODEL}/static/meta.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ last_run_initialisation_time?: number }>) : null))
      .catch(() => null),
  ]);
  if (!res.ok) throw new Error(`Open-Meteo: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as EnsembleResponse;
  const h = json.hourly;

  const hours: HourPoint[] = [];
  h.time.forEach((sec, i) => {
    const ms = sec * 1000;
    if (!inWindow(ms)) return;
    const temps = members(h, "temperature_2m", i).sort((a, b) => a - b);
    const precs = members(h, "precipitation", i).sort((a, b) => a - b);
    if (!temps.length) return;
    // Vector-average the wind direction across members.
    const speeds = members(h, "wind_speed_10m", i);
    const dirs = members(h, "wind_direction_10m", i);
    let u = 0;
    let v = 0;
    dirs.forEach((d, j) => {
      const s = speeds[j] ?? 1;
      u += -s * Math.sin((d * Math.PI) / 180);
      v += -s * Math.cos((d * Math.PI) / 180);
    });
    const windDir = dirs.length ? (Math.atan2(-u, -v) * (180 / Math.PI) + 360) % 360 : null;
    const pressure = mean(members(h, "pressure_msl", i));
    hours.push(
      finishHour(
        {
          t: new Date(ms).toISOString(),
          temp: mean(temps),
          tempLo: quantile(temps, 0.1),
          tempHi: quantile(temps, 0.9),
          dew: null,
          precip: Math.max(0, mean(precs)),
          precipHi: Math.max(0, quantile(precs, 0.9)),
          pop: precs.length ? roundTo((100 * precs.filter((p) => p >= 0.1).length) / precs.length, 5) : 0,
          cloud: mean(members(h, "cloud_cover", i)),
          wind: mean(speeds),
          windDir,
          pressure: Number.isFinite(pressure) ? pressure : null,
          solar: null,
        },
        lat,
        lon,
      ),
    );
  });

  const init = meta?.last_run_initialisation_time;
  return {
    hours,
    runs: [{ model: "WeatherNext 2", init: init ? new Date(init * 1000).toISOString() : new Date().toISOString() }],
  };
}

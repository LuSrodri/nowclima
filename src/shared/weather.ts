import { sunElevation, sunTimes } from "./sun";
import type { Condition, DaySummary, HourPoint } from "./types";

/** Relative humidity (%) from temperature and dew point, Magnus formula. */
export function relativeHumidity(tempC: number, dewC: number): number {
  const a = 17.625;
  const b = 243.04;
  const rh = 100 * Math.exp((a * dewC) / (b + dewC) - (a * tempC) / (b + tempC));
  return Math.max(0, Math.min(100, rh));
}

/** Apparent temperature: NWS heat index when hot and humid, wind chill when cold and windy. */
export function feelsLike(tempC: number, rh: number | null, windKmh: number): number {
  if (tempC >= 27 && rh !== null) {
    const t = tempC * 1.8 + 32;
    const hi =
      -42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh - 0.00683783 * t * t -
      0.05481717 * rh * rh + 0.00122874 * t * t * rh + 0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh;
    return Math.max(tempC, (hi - 32) / 1.8);
  }
  if (tempC <= 10 && windKmh > 4.8) {
    const v = Math.pow(windKmh, 0.16);
    return 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v;
  }
  return tempC;
}

const RAIN_THRESHOLD_MM = 0.1;

/**
 * Probability (0–100) that hourly precipitation reaches 0.1 mm, estimated from the
 * ensemble percentiles WeatherNext publishes (p10, p25, p50, p75, p90).
 */
export function popFromPercentiles(q: { p10: number; p25: number; p50: number; p75: number; p90: number }): number {
  const pts: [number, number][] = [
    [0.1, q.p10],
    [0.25, q.p25],
    [0.5, q.p50],
    [0.75, q.p75],
    [0.9, q.p90],
  ];
  const thr = RAIN_THRESHOLD_MM;
  if (q.p10 >= thr) return 95;
  if (q.p90 < thr) return q.p90 >= thr / 2 ? 5 : 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [f0, v0] = pts[i]!;
    const [f1, v1] = pts[i + 1]!;
    if (v0 < thr && v1 >= thr) {
      const cdf = v1 === v0 ? f0 : f0 + ((thr - v0) / (v1 - v0)) * (f1 - f0);
      return roundTo(100 * (1 - cdf), 5);
    }
  }
  return 50;
}

export function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

export function classify(p: {
  temp: number;
  precip: number;
  pop: number;
  cloud: number;
  rh: number | null;
  wind: number;
}): Condition {
  const wet = p.precip >= 0.15 || (p.pop >= 55 && p.precip >= 0.05);
  if (wet) {
    if (p.temp <= 0.5) return "snow";
    if (p.precip >= 4) return "heavy-rain";
    if (p.precip >= 0.6) return "rain";
    return "drizzle";
  }
  if (p.rh !== null && p.rh >= 97 && p.wind < 8 && p.cloud >= 60) return "fog";
  if (p.cloud < 20) return "clear";
  if (p.cloud < 55) return "partly";
  if (p.cloud < 85) return "cloudy";
  return "overcast";
}

export function isDaylight(ms: number, lat: number, lon: number): boolean {
  return sunElevation(ms, lat, lon) > -0.833;
}

/** Local calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

const CONDITION_WEIGHT: Record<Condition, number> = {
  clear: 0,
  partly: 1,
  cloudy: 2,
  overcast: 3,
  fog: 4,
  drizzle: 5,
  rain: 6,
  snow: 7,
  "heavy-rain": 8,
};

/** Groups hourly points into local days. The day's condition favours what happens in daylight. */
export function summarizeDays(hours: HourPoint[], timeZone: string, lat: number, lon: number): DaySummary[] {
  const groups = new Map<string, HourPoint[]>();
  for (const h of hours) {
    const key = localDate(Date.parse(h.t), timeZone);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(h);
  }
  const days: DaySummary[] = [];
  for (const [date, hs] of groups) {
    if (hs.length < 6) continue;
    const temps = hs.map((h) => h.temp);
    const precip = hs.reduce((s, h) => s + h.precip, 0);
    // Chance of any rain in the day: 1 − Π(1 − p), dampened because hours are correlated.
    const dry = hs.reduce((acc, h) => acc * (1 - h.pop / 100), 1);
    const pop = roundTo(Math.min(100, Math.max(...hs.map((h) => h.pop), (1 - dry) * 100 * 0.75)), 5);
    const daylight = hs.filter((h) => h.isDay);
    const pool = daylight.length ? daylight : hs;
    const counts = new Map<Condition, number>();
    for (const h of pool) counts.set(h.cond, (counts.get(h.cond) ?? 0) + 1 + CONDITION_WEIGHT[h.cond] * 0.15);
    const cond = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const noon = Date.parse(`${date}T12:00:00Z`) - (lon / 15) * 3_600_000;
    const sun = sunTimes(noon, lat, lon);
    days.push({
      date,
      min: Math.min(...temps),
      max: Math.max(...temps),
      precip,
      pop,
      cond,
      sunrise: sun.rise ? new Date(sun.rise).toISOString() : null,
      sunset: sun.set ? new Date(sun.set).toISOString() : null,
    });
  }
  return days.slice(0, 7);
}

/** Converts wind components (m/s) into the meteorological direction the wind blows from. */
export function windDirection(u: number, v: number): number {
  return (Math.atan2(-u, -v) * (180 / Math.PI) + 360) % 360;
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

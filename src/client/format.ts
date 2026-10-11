import type { Condition, HourPoint } from "../shared/types";

export type Unit = "C" | "F";

export const CONDITION_LABEL: Record<Condition, string> = {
  clear: "Céu limpo",
  partly: "Parcialmente nublado",
  cloudy: "Nublado",
  overcast: "Encoberto",
  fog: "Nevoeiro",
  drizzle: "Garoa",
  rain: "Chuva",
  "heavy-rain": "Chuva forte",
  snow: "Neve",
};

export const NIGHT_LABEL: Partial<Record<Condition, string>> = { clear: "Noite limpa" };

export const conditionLabel = (c: Condition, day: boolean) => (!day && NIGHT_LABEL[c]) || CONDITION_LABEL[c];

export const toUnit = (c: number, u: Unit) => (u === "C" ? c : c * 1.8 + 32);
export const temp = (c: number, u: Unit) => `${Math.round(toUnit(c, u))}°`;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
export function dtf(timeZone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = timeZone + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) fmtCache.set(key, (f = new Intl.DateTimeFormat("pt-BR", { timeZone, ...opts })));
  return f;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const hourLabel = (ms: number, tz: string) => dtf(tz, { hour: "2-digit", minute: "2-digit" }).format(ms);
export const clock = (ms: number, tz: string) =>
  dtf(tz, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(ms);
export const weekday = (ms: number, tz: string) => cap(dtf(tz, { weekday: "long" }).format(ms));
export const shortDay = (ms: number, tz: string) =>
  cap(dtf(tz, { weekday: "short", day: "numeric" }).format(ms).replace(".", ""));
export const longDate = (ms: number, tz: string) =>
  cap(dtf(tz, { weekday: "long", day: "numeric", month: "long" }).format(ms));

const COMPASS = ["N", "NE", "L", "SE", "S", "SO", "O", "NO"];
export const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8]!;

export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `há ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  return `há ${Math.round(m / 60)} h`;
}

/** Linear interpolation between the two hourly points around `ms`, so "now" moves every minute. */
export function interpolate(hours: HourPoint[], ms: number): HourPoint | null {
  if (!hours.length) return null;
  let i = hours.findIndex((h) => Date.parse(h.t) > ms);
  if (i === -1) return hours[hours.length - 1]!;
  if (i === 0) return hours[0]!;
  const a = hours[i - 1]!;
  const b = hours[i]!;
  const ta = Date.parse(a.t);
  const f = (ms - ta) / (Date.parse(b.t) - ta);
  const mix = (x: number, y: number) => x + (y - x) * f;
  const mixN = (x: number | null, y: number | null) => (x === null || y === null ? (x ?? y) : mix(x, y));
  // Hour-accumulated fields (precipitation) belong to the hour that ends at b.t.
  return {
    ...b,
    t: new Date(ms).toISOString(),
    temp: mix(a.temp, b.temp),
    tempLo: mix(a.tempLo, b.tempLo),
    tempHi: mix(a.tempHi, b.tempHi),
    feels: mix(a.feels, b.feels),
    dew: mixN(a.dew, b.dew),
    rh: mixN(a.rh, b.rh),
    cloud: mix(a.cloud, b.cloud),
    wind: mix(a.wind, b.wind),
    pressure: mixN(a.pressure, b.pressure),
    cond: f < 0.5 ? a.cond : b.cond,
    isDay: f < 0.5 ? a.isDay : b.isDay,
  };
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

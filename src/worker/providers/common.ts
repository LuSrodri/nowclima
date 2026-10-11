import type { HourPoint } from "../../shared/types";
import { classify, feelsLike, isDaylight, relativeHumidity } from "../../shared/weather";

export const HORIZON_HOURS = 168;

export type RawHour = Omit<HourPoint, "feels" | "rh" | "cond" | "isDay"> & { rh?: number | null };

export function finishHour(raw: RawHour, lat: number, lon: number): HourPoint {
  const rh = raw.rh ?? (raw.dew !== null ? relativeHumidity(raw.temp, raw.dew) : null);
  const ms = Date.parse(raw.t);
  return {
    ...raw,
    rh,
    feels: feelsLike(raw.temp, rh, raw.wind),
    cond: classify({ temp: raw.temp, precip: raw.precip, pop: raw.pop, cloud: raw.cloud, rh, wind: raw.wind }),
    // Middle of the preceding hour decides day/night for hour-accumulated fields.
    isDay: isDaylight(ms - 1_800_000, lat, lon),
  };
}

/** Window shown by the app: from the start of the previous hour up to 7 days ahead. */
export function inWindow(ms: number, now = Date.now()): boolean {
  const start = Math.floor(now / 3_600_000) * 3_600_000 - 3_600_000;
  return ms >= start && ms <= start + (HORIZON_HOURS + 1) * 3_600_000;
}

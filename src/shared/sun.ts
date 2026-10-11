// Solar position after Vladimir Agafonkin's SunCalc (BSD-2), trimmed to what the app needs.

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;
const J0 = 0.0009;

const toJulian = (ms: number) => ms / DAY_MS - 0.5 + J1970;
const fromJulian = (j: number) => (j + 0.5 - J1970) * DAY_MS;
const toDays = (ms: number) => toJulian(ms) - J2000;

const solarMeanAnomaly = (d: number) => RAD * (357.5291 + 0.98560028 * d);
const eclipticLongitude = (m: number) =>
  m + RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)) + RAD * 102.9372 + Math.PI;
const declination = (l: number) => Math.asin(Math.sin(OBLIQUITY) * Math.sin(l));
const rightAscension = (l: number) => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY), Math.cos(l));

/** Sun elevation above the horizon in degrees. */
export function sunElevation(ms: number, lat: number, lon: number): number {
  const d = toDays(ms);
  const m = solarMeanAnomaly(d);
  const l = eclipticLongitude(m);
  const dec = declination(l);
  const ra = rightAscension(l);
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const sidereal = RAD * (280.16 + 360.9856235 * d) - lw;
  const h = sidereal - ra;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h)) / RAD;
}

/** Sunrise and sunset (ms UTC) for the solar day nearest to `ms`. Null during polar day/night. */
export function sunTimes(ms: number, lat: number, lon: number): { rise: number | null; set: number | null } {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(ms);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const m = solarMeanAnomaly(ds);
  const l = eclipticLongitude(m);
  const dec = declination(l);
  const jNoon = J2000 + ds + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);
  const h0 = RAD * -0.833;
  const cosW = (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW < -1 || cosW > 1) return { rise: null, set: null };
  const w = Math.acos(cosW);
  const a = J0 + (w + lw) / (2 * Math.PI) + n;
  const jSet = J2000 + a + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);
  const jRise = jNoon - (jSet - jNoon);
  return { rise: fromJulian(jRise), set: fromJulian(jSet) };
}

import type { Forecast } from "../shared/types";
import { dtf, escapeHtml, hourLabel, shortDay, toUnit, type Unit } from "./format";
import { icon } from "./icons";

export const COL = 60;
const H = 270;
const TEMP_TOP = 92;
const TEMP_BOTTOM = 168;
const RAIN_BOTTOM = 238;
const RAIN_MAX_H = 46;
const RAIN_SCALE_MM = 6;

type Pt = [number, number];

/** Smooth path through points (Catmull-Rom converted to cubic Béziers). */
function smooth(pts: Pt[]): string {
  if (!pts.length) return "";
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1].toFixed(1)}`;
  }
  return d;
}

const localHour = (ms: number, tz: string) => Number(dtf(tz, { hour: "numeric", hourCycle: "h23" }).format(ms));

export function renderRibbon(f: Forecast, unit: Unit): string {
  const hs = f.hours;
  const tz = f.timezone;
  const width = hs.length * COL;
  const lo = Math.min(...hs.map((h) => h.tempLo));
  const hi = Math.max(...hs.map((h) => h.tempHi));
  const span = Math.max(4, hi - lo);
  const y = (c: number) => TEMP_BOTTOM - ((c - lo) / span) * (TEMP_BOTTOM - TEMP_TOP);
  const x = (i: number) => i * COL + COL / 2;

  const mean = smooth(hs.map((h, i) => [x(i), y(h.temp)]));
  const upper = hs.map((h, i): Pt => [x(i), y(h.tempHi)]);
  const lower = hs.map((h, i): Pt => [x(i), y(h.tempLo)]).reverse();
  const band = `${smooth(upper)} L${lower[0]![0]},${lower[0]![1].toFixed(1)} ${smooth(lower).replace(/^M[^C]*/, "")} Z`;

  const days: string[] = [];
  const bars: string[] = [];
  const labels: string[] = [];
  hs.forEach((h, i) => {
    const ms = Date.parse(h.t);
    if (localHour(ms, tz) === 0) {
      days.push(
        `<line class="day-line" x1="${i * COL}" x2="${i * COL}" y1="0" y2="${H}"/>` +
          `<text class="day-label" x="${i * COL + 8}" y="14">${escapeHtml(shortDay(ms, tz))}</text>`,
      );
    }
    if (h.precip >= 0.05 || h.pop >= 20) {
      const bh = Math.max(2, Math.min(1, Math.sqrt(h.precip / RAIN_SCALE_MM)) * RAIN_MAX_H);
      const bhHi = Math.min(1, Math.sqrt(h.precipHi / RAIN_SCALE_MM)) * RAIN_MAX_H;
      bars.push(
        `<rect class="rain-hi" x="${x(i) - 9}" y="${RAIN_BOTTOM - bhHi}" width="18" height="${bhHi}" rx="3"/>` +
          `<rect class="rain" x="${x(i) - 9}" y="${RAIN_BOTTOM - bh}" width="18" height="${bh}" rx="3"/>`,
      );
    }
    labels.push(
      `<text class="temp-label" x="${x(i)}" y="${(y(h.tempHi) - 8).toFixed(1)}">${Math.round(toUnit(h.temp, unit))}°</text>`,
    );
  });

  const cols = hs
    .map((h, i) => {
      const ms = Date.parse(h.t);
      const pop = h.pop >= 10 ? `${h.pop}%` : "";
      return `<li><button type="button" class="col" data-i="${i}" aria-label="${escapeHtml(hourLabel(ms, tz))}">
        <span class="col-time">${hourLabel(ms, tz).replace(":00", "h")}</span>
        <span class="col-icon">${icon(h.cond, h.isDay, 26)}</span>
        <span class="col-pop">${pop}</span>
      </button></li>`;
    })
    .join("");

  return `<div class="ribbon-track" style="width:${width}px">
    <svg class="ribbon-svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" aria-hidden="true">
      ${days.join("")}
      <path class="band" d="${band}"/>
      <path class="mean" d="${mean}"/>
      ${labels.join("")}
      <line class="rain-base" x1="0" x2="${width}" y1="${RAIN_BOTTOM + 0.5}" y2="${RAIN_BOTTOM + 0.5}"/>
      ${bars.join("")}
      <g class="now-marker"><line x1="0" x2="0" y1="18" y2="${RAIN_BOTTOM}"/><circle cx="0" cy="0" r="5"/></g>
    </svg>
    <ol class="ribbon-cols" style="grid-template-columns:repeat(${hs.length}, ${COL}px)">${cols}</ol>
  </div>`;
}

/** Positions the "now" marker between hourly columns, minute by minute. */
export function placeNowMarker(root: HTMLElement, f: Forecast, nowMs: number, tempNow: number): number | null {
  const marker = root.querySelector<SVGGElement>(".now-marker");
  if (!marker || !f.hours.length) return null;
  const t0 = Date.parse(f.hours[0]!.t);
  const xPos = ((nowMs - t0) / 3_600_000) * COL + COL / 2;
  const lo = Math.min(...f.hours.map((h) => h.tempLo));
  const hi = Math.max(...f.hours.map((h) => h.tempHi));
  const span = Math.max(4, hi - lo);
  const yPos = TEMP_BOTTOM - ((tempNow - lo) / span) * (TEMP_BOTTOM - TEMP_TOP);
  marker.setAttribute("transform", `translate(${xPos.toFixed(1)} 0)`);
  marker.querySelector("circle")!.setAttribute("cy", yPos.toFixed(1));
  return xPos;
}

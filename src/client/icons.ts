import type { Condition } from "../shared/types";

const sun = `<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>`;
const moon = `<path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1Z"/>`;
const cloudPath = (dx = 0, dy = 0) =>
  `<path transform="translate(${dx} ${dy})" d="M7.2 18.5h9.6a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 6.8 11.7a3.4 3.4 0 0 0 .4 6.8Z"/>`;
const smallSun = `<g transform="translate(-3.2 -3.6) scale(.62)"><circle cx="12" cy="12" r="4.2"/><path d="M12 3v2M3 12h2M5.6 5.6 7 7M18.4 5.6 17 7"/></g>`;
const smallMoon = `<g transform="translate(-2.6 -3.4) scale(.6)"><path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1Z"/></g>`;
const drops = (n: number, long = false) =>
  Array.from({ length: n }, (_, i) => {
    const x = 8.5 + i * (7 / Math.max(1, n - 1));
    return `<path d="M${x} 20.2l-.9 ${long ? 2.6 : 1.6}"/>`;
  }).join("");

const ICONS: Record<Condition, (day: boolean) => string> = {
  clear: (d) => (d ? sun : moon),
  partly: (d) => (d ? smallSun : smallMoon) + cloudPath(1.4, 1.2),
  cloudy: (d) => `<g opacity=".55">${cloudPath(-2.6, -3.4)}</g>` + cloudPath(1, 0.5) + (d ? "" : ""),
  overcast: () => `<g opacity=".55">${cloudPath(-2.6, -3.4)}</g>` + cloudPath(1, 0.5),
  fog: () => `${cloudPath(0, -3)}<path d="M4 18.5h11M8 21.2h12"/>`,
  drizzle: () => cloudPath(0, -2.4) + drops(3),
  rain: () => cloudPath(0, -2.4) + drops(4, true),
  "heavy-rain": () => cloudPath(0, -2.4) + drops(5, true) + `<path d="M12.6 15.9l-1.6 3h2.2l-1.4 2.6"/>`,
  snow: () => cloudPath(0, -2.4) + `<path d="M8.5 20.6h.01M12 21.6h.01M15.5 20.6h.01"/>`,
};

export function icon(cond: Condition, day: boolean, size = 24): string {
  return `<svg class="wx-icon wx-${cond}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[cond](day)}</svg>`;
}

export const ui = {
  search: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.6-4.6"/></svg>`,
  locate: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 1.8v2.7M12 19.5v2.7M1.8 12h2.7M19.5 12h2.7"/></svg>`,
  pin: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/></svg>`,
  arrow: (deg: number) =>
    `<svg class="wind-arrow" width="16" height="16" viewBox="0 0 24 24" style="transform:rotate(${deg + 180}deg)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V4M6 10l6-6 6 6"/></svg>`,
};

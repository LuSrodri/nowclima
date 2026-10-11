import "./styles.css";
import { sunElevation } from "../shared/sun";
import type { Daypart, Forecast, HourPoint, Place } from "../shared/types";
import { getForecast, imageUrl, reversePlace, searchPlaces } from "./api";
import {
  ago,
  clock,
  compass,
  conditionLabel,
  escapeHtml,
  hourLabel,
  interpolate,
  longDate,
  temp,
  weekday,
  type Unit,
} from "./format";
import { icon, ui } from "./icons";
import { COL, placeNowMarker, renderRibbon } from "./ribbon";

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;

const els = {
  hero: $(".hero"),
  heroImg: $<HTMLImageElement>(".hero-img"),
  form: $<HTMLFormElement>(".search"),
  input: $<HTMLInputElement>("#q"),
  list: $<HTMLUListElement>("#suggestions"),
  locate: $<HTMLButtonElement>(".locate"),
  units: $(".units"),
  placeName: $(".place-name"),
  placeWhere: $(".place-where"),
  now: $(".now"),
  nowValue: $(".now-value"),
  nowIcon: $(".now-icon"),
  nowCond: $(".now-cond"),
  nowRange: $(".now-range"),
  clockTime: $(".clock-time"),
  clockDate: $(".clock-date"),
  promptToggle: $<HTMLButtonElement>(".prompt-toggle"),
  prompt: $("#prompt"),
  content: $(".content"),
  readings: $(".readings"),
  dayJump: $(".day-jump"),
  detail: $(".detail"),
  ribbon: $(".ribbon"),
  days: $(".days"),
  sourceModel: $(".source-model"),
  sourceRefresh: $(".source-refresh"),
  sourceNote: $(".source-note"),
  toast: $(".toast"),
};

$(".search-icon").innerHTML = ui.search;
els.locate.innerHTML = ui.locate;

const store = {
  get<T>(k: string): T | null {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage unavailable: preferences just won't persist */
    }
  },
};

const state = {
  place: null as Place | null,
  forecast: null as Forecast | null,
  unit: (store.get<Unit>("unit") ?? (navigator.language === "en-US" ? "F" : "C")) as Unit,
  selected: null as number | null,
  imageKey: "",
  lastFetch: 0,
  fetching: false,
  lastMinute: -1,
};

const REFRESH_MS = 60_000;
const KIND_LABEL: Record<Place["kind"], string> = {
  city: "Cidade",
  district: "Bairro",
  locality: "Localidade",
  county: "Município",
  state: "Estado",
  country: "País",
  other: "Lugar",
};

/* ---------- toast ---------- */

let toastTimer = 0;
function toast(msg: string) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (els.toast.hidden = true), 5000);
}

/* ---------- search combobox ---------- */

let results: Place[] = [];
let active = -1;
let searchCtl: AbortController | null = null;
let debounce = 0;

const placeContext = (p: Place) => [p.city, p.state, p.country].filter(Boolean).join(", ");

function renderSuggestions() {
  els.list.innerHTML = results
    .map(
      (p, i) => `<li role="option" id="opt-${i}" data-i="${i}" aria-selected="${i === active}">
        <span class="opt-pin">${ui.pin}</span>
        <span class="opt-text"><strong>${escapeHtml(p.name)}</strong>
        <span>${escapeHtml(KIND_LABEL[p.kind])}${placeContext(p) ? `, ${escapeHtml(placeContext(p))}` : ""}</span></span>
      </li>`,
    )
    .join("");
  const open = results.length > 0;
  els.list.hidden = !open;
  els.input.setAttribute("aria-expanded", String(open));
  if (active >= 0) els.input.setAttribute("aria-activedescendant", `opt-${active}`);
  else els.input.removeAttribute("aria-activedescendant");
}

function closeSuggestions() {
  results = [];
  active = -1;
  renderSuggestions();
}

async function runSearch(q: string): Promise<Place[]> {
  searchCtl?.abort();
  searchCtl = new AbortController();
  try {
    return await searchPlaces(q, searchCtl.signal);
  } catch (err) {
    if ((err as Error).name !== "AbortError") toast("A busca de lugares falhou. Tente de novo em instantes.");
    return [];
  }
}

els.input.addEventListener("input", () => {
  const q = els.input.value.trim();
  clearTimeout(debounce);
  if (q.length < 2) return closeSuggestions();
  debounce = window.setTimeout(async () => {
    results = await runSearch(q);
    active = -1;
    renderSuggestions();
  }, 220);
});

els.input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!results.length) return;
    e.preventDefault();
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
    renderSuggestions();
  } else if (e.key === "Escape") {
    closeSuggestions();
  }
});

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = els.input.value.trim();
  if (q.length < 2) return;
  if (!results.length) results = await runSearch(q);
  const pick = results[Math.max(0, active)];
  if (pick) selectPlace(pick);
  else toast(`Nenhum lugar encontrado para “${q}”. Confira a grafia ou tente a cidade.`);
});

els.list.addEventListener("mousedown", (e) => e.preventDefault());
els.list.addEventListener("click", (e) => {
  const li = (e.target as HTMLElement).closest<HTMLLIElement>("li[data-i]");
  const p = li && results[Number(li.dataset.i)];
  if (p) selectPlace(p);
});
els.input.addEventListener("blur", () => setTimeout(closeSuggestions, 120));

els.locate.addEventListener("click", () => {
  if (!navigator.geolocation) return toast("Seu navegador não informa a localização.");
  els.locate.classList.add("busy");
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      const found = await reversePlace(coords.latitude, coords.longitude).catch(() => null);
      els.locate.classList.remove("busy");
      selectPlace(
        found ?? {
          id: `geo${coords.latitude.toFixed(2)},${coords.longitude.toFixed(2)}`,
          name: "Minha localização",
          kind: "other",
          lat: coords.latitude,
          lon: coords.longitude,
        },
      );
    },
    () => {
      els.locate.classList.remove("busy");
      toast("Não foi possível obter sua localização. Permita o acesso ou busque pelo nome.");
    },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
  );
});

/* ---------- units ---------- */

function syncUnitButtons() {
  els.units.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.unit === state.unit));
  });
}
els.units.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-unit]");
  if (!b) return;
  state.unit = b.dataset.unit as Unit;
  store.set("unit", state.unit);
  syncUnitButtons();
  renderAll();
});
syncUnitButtons();

/* ---------- place selection & url ---------- */

function placeToQuery(p: Place): string {
  const q = new URLSearchParams({ name: p.name, lat: p.lat.toFixed(4), lon: p.lon.toFixed(4), id: p.id, kind: p.kind });
  if (p.city) q.set("city", p.city);
  if (p.state) q.set("state", p.state);
  if (p.country) q.set("country", p.country);
  return `?${q}`;
}

function placeFromQuery(): Place | null {
  const q = new URLSearchParams(location.search);
  const lat = Number(q.get("lat"));
  const lon = Number(q.get("lon"));
  const name = q.get("name");
  if (!name || !q.has("lat") || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    id: q.get("id") ?? `geo${lat.toFixed(2)},${lon.toFixed(2)}`,
    name,
    kind: (q.get("kind") as Place["kind"]) ?? "city",
    city: q.get("city") ?? undefined,
    state: q.get("state") ?? undefined,
    country: q.get("country") ?? undefined,
    lat,
    lon,
  };
}

function selectPlace(p: Place, push = true) {
  closeSuggestions();
  els.input.value = "";
  els.input.blur();
  state.place = p;
  state.forecast = null;
  state.selected = null;
  store.set("place", p);
  if (push) history.pushState(null, "", placeToQuery(p));
  document.title = `${p.name} · nowclima`;
  els.placeName.textContent = p.name;
  const longest = Math.max(...p.name.split(/s+/).map((w) => w.length));
  els.placeName.dataset.size = longest > 11 || p.name.length > 22 ? "s" : longest > 7 || p.name.length > 14 ? "m" : "l";
  els.placeWhere.textContent = [p.kind === "district" ? "Bairro" : null, placeContext(p)].filter(Boolean).join(" em ");
  els.hero.classList.add("loading");
  void loadForecast(true);
}

window.addEventListener("popstate", () => {
  const p = placeFromQuery();
  if (p) selectPlace(p, false);
});

/* ---------- forecast ---------- */

let forecastCtl: AbortController | null = null;

async function loadForecast(initial = false) {
  const p = state.place;
  if (!p || state.fetching) return;
  state.fetching = true;
  forecastCtl?.abort();
  forecastCtl = new AbortController();
  try {
    const f = await getForecast(p.lat, p.lon, forecastCtl.signal);
    if (state.place !== p) return;
    state.forecast = f;
    state.lastFetch = Date.now();
    renderAll();
    if (initial) scrollRibbonToNow(false);
  } catch (err) {
    if ((err as Error).name !== "AbortError")
      toast(initial ? `Não foi possível carregar a previsão: ${(err as Error).message}` : "Falha ao atualizar; nova tentativa em 1 min.");
  } finally {
    state.fetching = false;
    els.hero.classList.remove("loading");
  }
}

/* ---------- hero image ---------- */

function daypartAt(ms: number, lat: number, lon: number): Daypart {
  const el = sunElevation(ms, lat, lon);
  if (el > 8) return "day";
  if (el < -6) return "night";
  return sunElevation(ms + 20 * 60_000, lat, lon) > el ? "dawn" : "dusk";
}

let imgObjectUrl = "";
async function updateImage(now: HourPoint) {
  const p = state.place;
  if (!p) return;
  const daypart = daypartAt(Date.now(), p.lat, p.lon);
  els.hero.dataset.cond = now.cond;
  els.hero.dataset.daypart = daypart;
  const url = imageUrl(p, now.cond, daypart);
  if (url === state.imageKey) return;
  state.imageKey = url;
  els.hero.classList.add("img-pending");
  try {
    const res = await fetch(url);
    if (state.imageKey !== url) return;
    if (!res.ok) {
      if (res.status === 429) toast("O limite diário de imagens foi atingido; mostrando o céu ilustrado.");
      throw new Error(String(res.status));
    }
    const prompt = decodeURIComponent(res.headers.get("x-image-prompt") ?? "");
    const blob = await res.blob();
    if (state.imageKey !== url) return;
    const next = URL.createObjectURL(blob);
    els.heroImg.onload = () => {
      els.hero.classList.add("has-img");
      els.hero.classList.remove("img-pending");
      if (imgObjectUrl) URL.revokeObjectURL(imgObjectUrl);
      imgObjectUrl = next;
    };
    els.heroImg.src = next;
    els.heroImg.alt = `Ilustração gerada de ${p.name}`;
    els.prompt.textContent = `Imagem gerada pelo FLUX.2 [klein] a partir da descrição: “${prompt}”`;
    els.promptToggle.hidden = !prompt;
  } catch {
    els.hero.classList.remove("img-pending", "has-img");
    els.heroImg.removeAttribute("src");
    els.promptToggle.hidden = true;
  }
}

els.promptToggle.addEventListener("click", () => {
  const open = els.prompt.hidden;
  els.prompt.hidden = !open;
  els.promptToggle.setAttribute("aria-expanded", String(open));
});

/* ---------- rendering ---------- */

function reading(label: string, value: string, extra = "") {
  return `<div class="reading"><dt>${label}</dt><dd>${value}${extra ? `<small>${extra}</small>` : ""}</dd></div>`;
}

function renderNow(nowMs: number) {
  const f = state.forecast;
  if (!f) return;
  const h = interpolate(f.hours, nowMs);
  if (!h) return;
  const u = state.unit;
  const today = f.days[0];
  els.now.hidden = false;
  els.nowValue.textContent = temp(h.temp, u);
  els.nowIcon.innerHTML = icon(h.cond, h.isDay, 44);
  els.nowCond.textContent = `${conditionLabel(h.cond, h.isDay)}, sensação de ${temp(h.feels, u)}`;
  els.nowRange.innerHTML = today
    ? `<span>Máx. ${temp(today.max, u)}</span><span>Mín. ${temp(today.min, u)}</span>`
    : "";

  const next = f.hours.find((x) => Date.parse(x.t) > nowMs);
  const day = f.days[0];
  const sun = (iso: string | null) => (iso ? hourLabel(Date.parse(iso), f.timezone) : "—");
  els.readings.innerHTML = `<dl>
    ${reading("Chance de chuva", `${next?.pop ?? h.pop}%`, next ? `${next.precip.toFixed(1)} mm na próxima hora` : "")}
    ${reading("Vento", `${Math.round(h.wind)} km/h`, h.windDir !== null ? `${ui.arrow(h.windDir)} de ${compass(h.windDir)}` : "")}
    ${h.rh !== null ? reading("Umidade", `${Math.round(h.rh)}%`, h.dew !== null ? `orvalho a ${temp(h.dew, u)}` : "") : ""}
    ${reading("Nuvens", `${Math.round(h.cloud)}%`)}
    ${h.pressure !== null ? reading("Pressão", `${Math.round(h.pressure)} hPa`) : ""}
    ${day ? reading("Sol", sun(day.sunrise), `pôr às ${sun(day.sunset)}`) : ""}
  </dl>`;

  const x = placeNowMarker(els.ribbon, f, nowMs, h.temp);
  if (x !== null) els.ribbon.style.setProperty("--now-x", `${x}px`);
  if (state.selected === null) renderDetail(h, true);
  void updateImage(h);
}

function renderDetail(h: HourPoint, isNow = false) {
  const f = state.forecast!;
  const u = state.unit;
  const ms = Date.parse(h.t);
  const when = isNow ? "Agora" : `${weekday(ms, f.timezone)}, ${hourLabel(ms, f.timezone)}`;
  els.detail.innerHTML = `
    <span class="detail-icon">${icon(h.cond, h.isDay, 32)}</span>
    <div class="detail-main">
      <p class="detail-when">${escapeHtml(when)}</p>
      <p class="detail-cond">${conditionLabel(h.cond, h.isDay)}, <strong>${temp(h.temp, u)}</strong>
      <span class="detail-band">provável entre ${temp(h.tempLo, u)} e ${temp(h.tempHi, u)}</span></p>
    </div>
    <dl class="detail-stats">
      <div><dt>Chuva</dt><dd>${h.pop}% · ${h.precip.toFixed(1)} mm</dd></div>
      <div><dt>Vento</dt><dd>${Math.round(h.wind)} km/h${h.windDir !== null ? ` ${compass(h.windDir)}` : ""}</dd></div>
      <div><dt>Sensação</dt><dd>${temp(h.feels, u)}</dd></div>
      ${h.rh !== null ? `<div><dt>Umidade</dt><dd>${Math.round(h.rh)}%</dd></div>` : ""}
    </dl>
    ${isNow ? "" : `<button type="button" class="detail-reset">Voltar para agora</button>`}`;
}

function renderDays() {
  const f = state.forecast!;
  const u = state.unit;
  const lo = Math.min(...f.days.map((d) => d.min));
  const hi = Math.max(...f.days.map((d) => d.max));
  const span = Math.max(1, hi - lo);
  els.days.innerHTML = f.days
    .map((d, i) => {
      const ms = Date.parse(`${d.date}T12:00:00Z`);
      const name = i === 0 ? "Hoje" : i === 1 ? "Amanhã" : weekday(ms, "UTC");
      const left = ((d.min - lo) / span) * 100;
      const width = Math.max(4, ((d.max - d.min) / span) * 100);
      return `<li><button type="button" class="day" data-date="${d.date}">
        <span class="day-name">${escapeHtml(name)}<small>${escapeHtml(dayMonth(ms))}</small></span>
        <span class="day-icon">${icon(d.cond, true, 28)}</span>
        <span class="day-pop">${d.pop >= 10 ? `${d.pop}%` : ""}</span>
        <span class="day-min">${temp(d.min, u)}</span>
        <span class="day-bar" aria-hidden="true"><span style="left:${left}%;width:${width}%"></span></span>
        <span class="day-max">${temp(d.max, u)}</span>
      </button></li>`;
    })
    .join("");

  els.dayJump.innerHTML = f.days
    .map((d, i) => {
      const ms = Date.parse(`${d.date}T12:00:00Z`);
      const label = i === 0 ? "Hoje" : weekday(ms, "UTC").slice(0, 3);
      return `<button type="button" data-date="${d.date}">${escapeHtml(label)}</button>`;
    })
    .join("");
}

function renderSource() {
  const f = state.forecast!;
  const runs = f.source.runs
    .map((r) => `rodada de ${dtf2(r.init, f.timezone)}${r.span ? ` (${r.span})` : ""}`)
    .join(" e ");
  els.sourceModel.innerHTML = `Previsão do <strong>${f.source.model}</strong> (Google DeepMind) via ${escapeHtml(
    f.source.via,
  )}, ${runs}. Valores são a média de 64 cenários do ensemble.`;
  els.sourceNote.textContent = f.source.note ?? "";
}

const dayMonth = (ms: number) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "numeric", month: "long" }).format(ms);

const dtf2 = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
    Date.parse(iso),
  );

function renderAll() {
  const f = state.forecast;
  if (!f) return;
  els.content.hidden = false;
  const scroll = els.ribbon.scrollLeft;
  els.ribbon.innerHTML = renderRibbon(f, state.unit);
  els.ribbon.scrollLeft = scroll;
  renderDays();
  renderSource();
  state.lastMinute = -1;
  tick();
  if (state.selected !== null) selectHour(state.selected, false);
}

function selectHour(i: number | null, scroll = true) {
  const f = state.forecast;
  if (!f) return;
  state.selected = i;
  els.ribbon.querySelectorAll(".col[aria-pressed]").forEach((b) => b.removeAttribute("aria-pressed"));
  if (i === null) {
    const h = interpolate(f.hours, Date.now());
    if (h) renderDetail(h, true);
    scrollRibbonToNow(true);
    return;
  }
  const h = f.hours[i];
  if (!h) return;
  els.ribbon.querySelector(`.col[data-i="${i}"]`)?.setAttribute("aria-pressed", "true");
  renderDetail(h);
  if (scroll) scrollRibbonTo(i * COL);
}

function scrollRibbonTo(x: number, smooth = true) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  els.ribbon.scrollTo({ left: Math.max(0, x - COL * 1.5), behavior: smooth && !reduce ? "smooth" : "auto" });
}

function scrollRibbonToNow(smooth: boolean) {
  const f = state.forecast;
  if (!f?.hours.length) return;
  const x = ((Date.now() - Date.parse(f.hours[0]!.t)) / 3_600_000) * COL;
  scrollRibbonTo(x, smooth);
}

els.ribbon.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".col");
  if (b) selectHour(Number(b.dataset.i), false);
});
els.detail.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest(".detail-reset")) selectHour(null);
});

function jumpToDate(date: string) {
  const f = state.forecast;
  if (!f) return;
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: f.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: f.timezone, hour: "numeric", hourCycle: "h23" });
  const idx = f.hours.findIndex((h) => fmt.format(Date.parse(h.t)) === date);
  if (idx < 0) return;
  // Land on the day's noon when it's not today, the most useful hour to read first.
  const noon = f.hours.findIndex((h, i) => i >= idx && fmt.format(Date.parse(h.t)) === date && Number(hourFmt.format(Date.parse(h.t))) === 12);
  const isToday = idx === 0 || date === fmt.format(Date.now());
  if (isToday) return selectHour(null);
  selectHour(noon >= 0 ? noon : idx);
  els.ribbon.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
}

els.dayJump.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-date]");
  if (b) jumpToDate(b.dataset.date!);
});
els.days.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-date]");
  if (b) jumpToDate(b.dataset.date!);
});

/* ---------- live clock: every second; values every minute; data every minute ---------- */

function tick() {
  const now = Date.now();
  const tz = state.forecast?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (state.place) {
    els.clockTime.textContent = clock(now, tz);
    els.clockTime.setAttribute("datetime", new Date(now).toISOString());
    els.clockDate.textContent = longDate(now, tz);
  }
  const minute = Math.floor(now / 60_000);
  if (minute !== state.lastMinute && state.forecast) {
    state.lastMinute = minute;
    renderNow(now);
  }
  if (state.lastFetch) {
    els.sourceRefresh.textContent = `Dados conferidos ${ago(state.lastFetch, now)}; a previsão é verificada a cada minuto e o “agora” é recalculado minuto a minuto.`;
  }
  if (state.place && !document.hidden && now - state.lastFetch > REFRESH_MS && state.lastFetch) void loadForecast();
}

setInterval(tick, 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tick();
});

/* ---------- boot ---------- */

const initial = placeFromQuery() ?? store.get<Place>("place");
if (initial) selectPlace(initial, false);
else {
  els.placeWhere.innerHTML = `Digite o nome de uma cidade, bairro ou distrito, ou experimente:
    <span class="starters">${["Pinheiros, São Paulo", "Alfama, Lisboa", "Copacabana", "Shibuya", "Montmartre"]
      .map((s) => `<button type="button" data-q="${escapeHtml(s)}">${escapeHtml(s)}</button>`)
      .join("")}</span>`;
  els.placeWhere.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-q]");
    if (!b) return;
    const [first] = await runSearch(b.dataset.q!);
    if (first) selectPlace(first);
  });
  els.input.focus();
}


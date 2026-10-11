import tzlookup from "@photostructure/tz-lookup";
import type { Condition, Daypart, Forecast } from "../shared/types";
import { summarizeDays } from "../shared/weather";
import { reversePlace, searchPlaces } from "./geocode";
import { generateImage, imageKey, type ImageRequest } from "./image";
import { fetchWeatherNext2 } from "./providers/weathernext2";
import { fetchWeatherNext3 } from "./providers/weathernext3";

export interface Env {
  ASSETS: Fetcher;
  AI: Ai;
  CACHE: KVNamespace;
  IMAGE_DAILY_LIMIT: string;
  WN3_MAX_BYTES_BILLED: string;
  GCP_SERVICE_ACCOUNT_JSON?: string;
  GCP_PROJECT_ID?: string;
  WN3_TABLE?: string;
}

const CONDITIONS: Condition[] = ["clear", "partly", "cloudy", "overcast", "fog", "drizzle", "rain", "heavy-rain", "snow"];
const DAYPARTS: Daypart[] = ["dawn", "day", "dusk", "night"];

const json = (data: unknown, init: ResponseInit & { maxAge?: number } = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": init.maxAge ? `public, max-age=${init.maxAge}` : "no-store",
      ...init.headers,
    },
  });

const fail = (status: number, message: string) => json({ error: message }, { status });

function coords(url: URL): { lat: number; lon: number } | null {
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!url.searchParams.has("lat") || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

const wn3Configured = (env: Env) => Boolean(env.GCP_SERVICE_ACCOUNT_JSON && env.GCP_PROJECT_ID && env.WN3_TABLE);

async function forecast(env: Env, lat: number, lon: number): Promise<Forecast> {
  const timezone = tzlookup(lat, lon);
  const cell = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const useWn3 = wn3Configured(env);
  const key = `fc:v1:${useWn3 ? "wn3" : "wn2"}:${cell}`;

  const cached = await env.CACHE.get<Forecast>(key, "json");
  if (cached) return cached;

  let result: Forecast | null = null;
  let note: string | undefined;
  if (useWn3) {
    try {
      const { hours, runs } = await fetchWeatherNext3(
        {
          serviceAccountJson: env.GCP_SERVICE_ACCOUNT_JSON!,
          projectId: env.GCP_PROJECT_ID!,
          table: env.WN3_TABLE!,
          maxBytesBilled: env.WN3_MAX_BYTES_BILLED,
        },
        lat,
        lon,
      );
      result = {
        lat,
        lon,
        timezone,
        source: { model: "WeatherNext 3", via: "Google BigQuery", runs },
        fetchedAt: new Date().toISOString(),
        hours,
        days: summarizeDays(hours, timezone, lat, lon),
      };
    } catch (err) {
      console.error("WeatherNext 3 failed, falling back", err);
      note = "WeatherNext 3 indisponível agora; exibindo WeatherNext 2.";
    }
  }
  if (!result) {
    const { hours, runs } = await fetchWeatherNext2(lat, lon);
    result = {
      lat,
      lon,
      timezone,
      source: { model: "WeatherNext 2", via: "Open-Meteo", runs, note },
      fetchedAt: new Date().toISOString(),
      hours,
      days: summarizeDays(hours, timezone, lat, lon),
    };
  }
  const ttl = result.source.model === "WeatherNext 3" ? 300 : 900;
  await env.CACHE.put(key, JSON.stringify(result), { expirationTtl: ttl });
  return result;
}

const clip = (v: string | null, max = 80) => (v ? v.slice(0, max) : undefined);

async function image(env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const p = url.searchParams;
  const cond = p.get("cond") as Condition;
  const daypart = p.get("daypart") as Daypart;
  const placeId = clip(p.get("placeId"), 40);
  const name = clip(p.get("name"));
  if (!placeId || !name || !CONDITIONS.includes(cond) || !DAYPARTS.includes(daypart)) {
    return fail(400, "Parâmetros de imagem inválidos");
  }
  const req: ImageRequest = {
    placeId,
    name,
    kind: clip(p.get("kind"), 20) ?? "city",
    city: clip(p.get("city")),
    state: clip(p.get("state")),
    country: clip(p.get("country")),
    cond,
    daypart,
  };
  const key = imageKey(req);
  const headers = (type: string, prompt: string) => ({
    "content-type": type,
    "cache-control": "public, max-age=2592000, immutable",
    "x-image-prompt": encodeURIComponent(prompt.slice(0, 600)),
    "access-control-expose-headers": "x-image-prompt",
  });

  const hit = await env.CACHE.getWithMetadata<{ type: string; prompt: string }>(key, "arrayBuffer");
  if (hit.value && hit.metadata) return new Response(hit.value, { headers: headers(hit.metadata.type, hit.metadata.prompt) });

  const quotaKey = `quota:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await env.CACHE.get(quotaKey)) ?? 0);
  if (used >= Number(env.IMAGE_DAILY_LIMIT || 150)) return fail(429, "Limite diário de imagens atingido");

  try {
    const img = await generateImage(env.AI, req);
    ctx.waitUntil(
      Promise.all([
        env.CACHE.put(key, img.bytes, { metadata: { type: img.type, prompt: img.prompt }, expirationTtl: 60 * 86_400 }),
        env.CACHE.put(quotaKey, String(used + 1), { expirationTtl: 2 * 86_400 }),
      ]),
    );
    return new Response(img.bytes, { headers: headers(img.type, img.prompt) });
  } catch (err) {
    console.error("image generation failed", err);
    return fail(502, "Não foi possível gerar a imagem agora");
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET") return fail(405, "Método não permitido");

    try {
      switch (url.pathname) {
        case "/api/search": {
          const q = (url.searchParams.get("q") ?? "").trim();
          if (q.length < 2) return json([]);
          return json(await searchPlaces(q.slice(0, 120), url.searchParams.get("lang") ?? ""), { maxAge: 3600 });
        }
        case "/api/reverse": {
          const c = coords(url);
          if (!c) return fail(400, "Coordenadas inválidas");
          return json(await reversePlace(c.lat, c.lon), { maxAge: 3600 });
        }
        case "/api/forecast": {
          const c = coords(url);
          if (!c) return fail(400, "Coordenadas inválidas");
          return json(await forecast(env, c.lat, c.lon), { maxAge: 30 });
        }
        case "/api/image":
          return await image(env, url, ctx);
        case "/api/status":
          return json({ primaryModel: wn3Configured(env) ? "WeatherNext 3" : "WeatherNext 2" });
        default:
          return fail(404, "Rota não encontrada");
      }
    } catch (err) {
      console.error(err);
      return fail(502, err instanceof Error ? err.message : "Erro inesperado");
    }
  },
} satisfies ExportedHandler<Env>;

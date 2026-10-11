import type { Daypart, Forecast, Place } from "../shared/types";
import type { Condition } from "../shared/types";

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Erro ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const searchPlaces = (q: string, signal?: AbortSignal) =>
  get<Place[]>(`/api/search?${new URLSearchParams({ q, lang: navigator.language.slice(0, 2) })}`, signal);

export const reversePlace = (lat: number, lon: number) =>
  get<Place | null>(`/api/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`);

export const getForecast = (lat: number, lon: number, signal?: AbortSignal) =>
  get<Forecast>(`/api/forecast?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, signal);

export function imageUrl(place: Place, cond: Condition, daypart: Daypart): string {
  const p = new URLSearchParams({ placeId: place.id, name: place.name, kind: place.kind, cond, daypart });
  if (place.city) p.set("city", place.city);
  if (place.state) p.set("state", place.state);
  if (place.country) p.set("country", place.country);
  return `/api/image?${p}`;
}

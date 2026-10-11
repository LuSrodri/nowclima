// Place search and reverse geocoding with Photon (OpenStreetMap data, autocomplete-friendly).

import type { Place, PlaceKind } from "../shared/types";

const UA = "nowclima/1.0 (+https://github.com/LuSrodri/nowclima)";
const LAYERS = ["city", "district", "locality", "county", "state"];

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type?: string;
    osm_id?: number;
    type?: string;
    name?: string;
    city?: string;
    county?: string;
    district?: string;
    state?: string;
    country?: string;
    countrycode?: string;
  };
}

const KINDS: PlaceKind[] = ["city", "district", "locality", "county", "state", "country"];

function toPlace(f: PhotonFeature): Place | null {
  const p = f.properties;
  if (!p.name) return null;
  const kind = (KINDS as string[]).includes(p.type ?? "") ? (p.type as PlaceKind) : "other";
  const [lon, lat] = f.geometry.coordinates;
  return {
    id: `${p.osm_type ?? "X"}${p.osm_id ?? `${lat},${lon}`}`,
    name: p.name,
    kind,
    city: p.city && p.city !== p.name ? p.city : undefined,
    state: p.state && p.state !== p.name ? p.state : undefined,
    country: p.country,
    countryCode: p.countrycode,
    lat,
    lon,
  };
}

async function photon(path: string, params: URLSearchParams): Promise<Place[]> {
  const res = await fetch(`https://photon.komoot.io/${path}?${params}`, {
    headers: { "user-agent": UA, accept: "application/json" },
    cf: { cacheTtl: 86_400, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Photon: ${res.status}`);
  const json = (await res.json()) as { features: PhotonFeature[] };
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const f of json.features) {
    const place = toPlace(f);
    if (!place) continue;
    const key = [place.name, place.city, place.state, place.country].join("|").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out;
}

export function searchPlaces(q: string, lang: string): Promise<Place[]> {
  const params = new URLSearchParams({ q, limit: "8" });
  if (["en", "de", "fr"].includes(lang)) params.set("lang", lang);
  for (const l of LAYERS) params.append("layer", l);
  return photon("api/", params);
}

export async function reversePlace(lat: number, lon: number): Promise<Place | null> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), limit: "1" });
  for (const l of ["district", "locality", "city"]) params.append("layer", l);
  const [place] = await photon("reverse", params);
  return place ? { ...place, lat, lon } : null;
}

// Characteristic image of a place, generated with FLUX.2 [klein] 4B on Workers AI (free daily allocation).
// A small LLM first writes a scene description grounded on the place's real landmarks and look.

import type { Condition, Daypart } from "../shared/types";

const IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
const PROMPT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const WIDTH = 1280;
const HEIGHT = 720;

export interface ImageRequest {
  placeId: string;
  name: string;
  kind: string;
  city?: string;
  state?: string;
  country?: string;
  cond: Condition;
  daypart: Daypart;
}

type Sky = "clear" | "cloudy" | "rain" | "snow" | "fog";

const SKY: Record<Condition, Sky> = {
  clear: "clear",
  partly: "clear",
  cloudy: "cloudy",
  overcast: "cloudy",
  fog: "fog",
  drizzle: "rain",
  rain: "rain",
  "heavy-rain": "rain",
  snow: "snow",
};

const SKY_TEXT: Record<Sky, string> = {
  clear: "clear sky with a few scattered clouds",
  cloudy: "grey overcast sky with soft diffuse light",
  rain: "rainy weather, wet reflective streets, light rain falling",
  snow: "snowfall, snow-covered surfaces",
  fog: "dense fog and mist softening the distance",
};

const DAYPART_TEXT: Record<Daypart, string> = {
  dawn: "early morning at sunrise, warm low golden light",
  day: "daytime, natural daylight",
  dusk: "sunset at golden hour, warm sky glow and the first lights turning on",
  night: "night, city lights and illuminated landmarks under a dark blue sky",
};

export function imageKey(r: ImageRequest): string {
  return `img:v1:${r.placeId}:${SKY[r.cond]}:${r.daypart}`;
}

function describePlace(r: ImageRequest): string {
  const where = [r.city, r.state, r.country].filter(Boolean).join(", ");
  const label =
    r.kind === "district" || r.kind === "locality"
      ? `the neighbourhood/district "${r.name}"`
      : r.kind === "state" || r.kind === "county"
        ? `the region "${r.name}"`
        : `the city "${r.name}"`;
  return where ? `${label} in ${where}` : label;
}

const SYSTEM = `You write prompts for a photorealistic text-to-image model.
Given a place, write ONE paragraph (max 75 words, English) describing the single most characteristic and recognizable real view of that exact place: its real landmarks, typical architecture, streets, vegetation, terrain, coastline or skyline.
Never invent landmarks. If you are not sure what the place looks like, describe the typical architecture and landscape of its region and country instead.
Include the requested weather and time of day as lighting. Wide-angle editorial travel photograph, natural colors.
No text, signs with legible words, logos, watermarks or close-up people. Output only the prompt.`;

async function writePrompt(ai: Ai, r: ImageRequest): Promise<string> {
  const scene = `${SKY_TEXT[SKY[r.cond]]}; ${DAYPART_TEXT[r.daypart]}`;
  const fallback = `Wide-angle editorial travel photograph of ${describePlace(r)}, showing its most characteristic and recognizable view, ${scene}, photorealistic, natural colors, no text.`;
  try {
    const out = (await (ai.run as (m: string, i: unknown) => Promise<unknown>)(PROMPT_MODEL, {
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Place: ${describePlace(r)}.\nWeather: ${scene}.` },
      ],
      max_tokens: 400,
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0.4,
    })) as { response?: string; choices?: { message?: { content?: string } }[] };
    const text = (out.response ?? out.choices?.[0]?.message?.content ?? "").trim().replace(/^"|"$/g, "");
    return text.length > 40 ? text : fallback;
  } catch (err) {
    console.warn("prompt model failed, using template", err);
    return fallback;
  }
}

function sniffType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp";
  return "image/jpeg";
}

export async function generateImage(ai: Ai, r: ImageRequest): Promise<{ bytes: Uint8Array; type: string; prompt: string }> {
  const prompt = await writePrompt(ai, r);
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(WIDTH));
  form.append("height", String(HEIGHT));
  // FormData has to be serialized through a Response to obtain the multipart boundary.
  const serialized = new Response(form);
  const out = (await (ai.run as (m: string, i: unknown) => Promise<unknown>)(IMAGE_MODEL, {
    multipart: { body: serialized.body, contentType: serialized.headers.get("content-type") },
  })) as { image?: string };
  if (!out.image) throw new Error("image model returned no image");
  const bytes = Uint8Array.from(atob(out.image), (c) => c.charCodeAt(0));
  return { bytes, type: sniffType(bytes), prompt };
}

export type Condition =
  | "clear"
  | "partly"
  | "cloudy"
  | "overcast"
  | "fog"
  | "drizzle"
  | "rain"
  | "heavy-rain"
  | "snow";

export type Daypart = "dawn" | "day" | "dusk" | "night";

export type PlaceKind = "city" | "district" | "locality" | "county" | "state" | "country" | "other";

export interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
  lat: number;
  lon: number;
}

export interface HourPoint {
  /** Valid time, ISO 8601 UTC. */
  t: string;
  /** Temperature °C (ensemble mean) with 10th–90th percentile spread. */
  temp: number;
  tempLo: number;
  tempHi: number;
  feels: number;
  dew: number | null;
  rh: number | null;
  /** Precipitation in mm over the hour (mean) and its 90th percentile. */
  precip: number;
  precipHi: number;
  /** Probability of ≥0.1 mm in the hour, 0–100. */
  pop: number;
  /** Cloud cover 0–100. */
  cloud: number;
  /** Wind speed km/h at 10 m and direction it blows from, degrees. */
  wind: number;
  windDir: number | null;
  pressure: number | null;
  /** Downward shortwave radiation, W/m². */
  solar: number | null;
  cond: Condition;
  isDay: boolean;
}

export interface DaySummary {
  /** Local date YYYY-MM-DD. */
  date: string;
  min: number;
  max: number;
  precip: number;
  pop: number;
  cond: Condition;
  sunrise: string | null;
  sunset: string | null;
}

export interface ModelRun {
  model: "WeatherNext 3" | "WeatherNext 2";
  /** Initialization time of the run, ISO UTC. */
  init: string;
  /** Hours covered by this run, e.g. "0–48 h". */
  span?: string;
}

export interface Forecast {
  lat: number;
  lon: number;
  timezone: string;
  source: {
    model: "WeatherNext 3" | "WeatherNext 2";
    via: string;
    runs: ModelRun[];
    note?: string;
  };
  fetchedAt: string;
  hours: HourPoint[];
  days: DaySummary[];
}

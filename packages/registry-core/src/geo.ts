import zipData from "./geo/zips.json" with { type: "json" };
import placeData from "./geo/places.json" with { type: "json" };
import stateData from "./geo/zip-states.json" with { type: "json" };
import type { Entity } from "./entity.js";

// Distance from the user's location, zero network. ZIP and place centroids
// come from the Census 2024 Gazetteer (scripts/data/build_geo.py): every ZCTA
// nationally, every place in the regions the manifest covers. A centroid is
// an area's center, so distances are approximate — good for "within 10 mi",
// not for driving directions.

export interface LatLon { lat: number; lon: number }

const ZIPS = zipData as unknown as Readonly<Record<string, readonly [number, number]>>;
const PLACES = placeData as unknown as Readonly<Record<string, Readonly<Record<string, readonly [number, number]>>>>;

const STATES = stateData as unknown as Readonly<Record<string, { name: string; zip3: readonly (readonly [number, number])[] }>>;

const EARTH_RADIUS_MI = 3958.8;

export function zipCentroid(zip: string): LatLon | undefined {
  const key = zip.trim().slice(0, 5);
  if (!Object.hasOwn(ZIPS, key)) return undefined;
  const p = ZIPS[key]!;
  return { lat: p[0], lon: p[1] };
}

function placeKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function placeCentroid(region: string, name: string): LatLon | undefined {
  if (!Object.hasOwn(PLACES, region)) return undefined;
  const table = PLACES[region]!;
  const key = placeKey(name);
  if (!Object.hasOwn(table, key)) return undefined;
  const p = table[key]!;
  return { lat: p[0], lon: p[1] };
}

// Lowercased place names the region's gazetteer table knows.
export function regionPlaces(region: string): string[] {
  return Object.hasOwn(PLACES, region) ? Object.keys(PLACES[region]!) : [];
}

// Great-circle distance in miles (haversine).
export function milesBetween(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Postal code of the state a 5-digit ZIP belongs to, from its first 3 digits.
export function zipState(zip: string): string | undefined {
  const text = zip.trim();
  if (!/^\d{5}$/.test(text)) return undefined;
  const prefix = Number(text.slice(0, 3));
  for (const [code, state] of Object.entries(STATES)) {
    if (state.zip3.some(([lo, hi]) => prefix >= lo && prefix <= hi)) return code;
  }
  return undefined;
}

export function stateName(code: string): string | undefined {
  const key = code.trim().toUpperCase();
  return Object.hasOwn(STATES, key) ? STATES[key]!.name : undefined;
}

// Every way a state can end a location ("co", "colorado"), longest first so
// "West Virginia" wins over "Virginia".
const STATE_SUFFIXES = Object.entries(STATES)
  .flatMap(([code, state]) => [
    { code, text: code },
    { code, text: state.name },
  ])
  .sort((a, b) => b.text.length - a.text.length)
  .map(({ code, text }) => ({
    code,
    re: new RegExp(`^(.*?\\S)(?:\\s*,\\s*|\\s+)${text.replace(/ /g, "\\s+")}$`, "i"),
  }));

// "Denver, CO" / "denver colorado" -> the town and the state it names.
function splitTrailingState(text: string): { rest: string; state: string } | undefined {
  for (const { code, re } of STATE_SUFFIXES) {
    const m = re.exec(text);
    if (m !== null) return { rest: m[1]!, state: code };
  }
  return undefined;
}

// The state a location names explicitly: a ZIP's state, or a trailing state
// code or name on a town. Undefined when it names none.
export function locationState(input: string): string | undefined {
  const text = input.trim();
  const zip = /^(\d{5})(?:-\d{4})?$/.exec(text);
  if (zip !== null) return zipState(zip[1]!);
  return splitTrailingState(text)?.state;
}

function placeResult(region: string, text: string): { label: string; point: LatLon } | undefined {
  const point = placeCentroid(region, text);
  if (point === undefined) return undefined;
  const state = region.split("-")[1];
  const name = placeKey(text).replace(/\b[a-z]/g, c => c.toUpperCase());
  return { label: state === undefined ? name : `${name}, ${state}`, point };
}

// A ZIP (5 digits or ZIP+4) or a place name in the region, optionally with
// the region's state after it -> a labelled point. A ZIP or town in another
// state resolves to nothing.
export function resolveLocation(region: string, input: string): { label: string; point: LatLon } | undefined {
  const text = input.trim();
  const regionState = region.split("-")[1];
  const zip = /^(\d{5})(?:-\d{4})?$/.exec(text);
  if (zip !== null) {
    const five = zip[1]!;
    const inState = zipState(five);
    if (inState !== undefined && inState !== regionState) return undefined;
    const point = zipCentroid(five);
    return point === undefined ? undefined : { label: `ZIP ${five}`, point };
  }
  // The whole text first, so a place whose name ends in a state word still
  // resolves typed bare.
  const whole = placeResult(region, text);
  if (whole !== undefined) return whole;
  const split = splitTrailingState(text);
  if (split === undefined || split.state !== regionState) return undefined;
  return placeResult(region, split.rest);
}

// Where a business is: its ZIP centroid, else its city's centroid.
export function entityPoint(entity: Entity, region: string): LatLon | undefined {
  const zip = entity.address.zip;
  if (zip !== undefined && zip.trim() !== "") {
    const p = zipCentroid(zip);
    if (p !== undefined) return p;
  }
  const city = entity.address.city;
  if (city !== undefined && city.trim() !== "") return placeCentroid(region, city);
  return undefined;
}

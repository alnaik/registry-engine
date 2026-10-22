import zipData from "./geo/zips.json" with { type: "json" };
import placeData from "./geo/places.json" with { type: "json" };
import type { Entity } from "./entity.js";

// Distance from the user's location, zero network. ZIP and place centroids
// come from the Census 2024 Gazetteer (scripts/data/build_geo.py): every ZCTA
// nationally, every place in the regions the manifest covers. A centroid is
// an area's center, so distances are approximate — good for "within 10 mi",
// not for driving directions.

export interface LatLon { lat: number; lon: number }

const ZIPS = zipData as unknown as Readonly<Record<string, readonly [number, number]>>;
const PLACES = placeData as unknown as Readonly<Record<string, Readonly<Record<string, readonly [number, number]>>>>;

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

// A 5-digit ZIP or a place name in the region -> a labelled point.
export function resolveLocation(region: string, input: string): { label: string; point: LatLon } | undefined {
  const text = input.trim();
  if (/^\d{5}$/.test(text)) {
    const point = zipCentroid(text);
    return point === undefined ? undefined : { label: `ZIP ${text}`, point };
  }
  const point = placeCentroid(region, text);
  if (point === undefined) return undefined;
  const state = region.split("-")[1];
  const name = placeKey(text).replace(/\b[a-z]/g, c => c.toUpperCase());
  return { label: state === undefined ? name : `${name}, ${state}`, point };
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

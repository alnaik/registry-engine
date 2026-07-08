import { ZIP_CENTROIDS } from "./zipCentroids.js";

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function zipsWithinRadius(lat: number, lng: number, radiusMeters: number): string[] {
  return Object.entries(ZIP_CENTROIDS)
    .filter(([, [zipLat, zipLng]]) => haversineDistance(lat, lng, zipLat, zipLng) <= radiusMeters)
    .map(([zip]) => zip);
}

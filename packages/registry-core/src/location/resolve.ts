const CENSUS_BASE = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";

export async function resolveAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  // Census geocoder
  try {
    const url = `${CENSUS_BASE}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
    const resp = await fetch(url);
    if (resp.ok) {
      const data = await resp.json() as {
        result?: {
          addressMatches?: Array<{
            coordinates?: { x: number; y: number };
          }>;
        };
      };
      const match = data.result?.addressMatches?.[0];
      if (match?.coordinates !== undefined) {
        return { lat: match.coordinates.y, lng: match.coordinates.x };
      }
    }
  } catch {
    // fall through to Nominatim
  }

  // Nominatim fallback (1 req/s etiquette enforced by caller's limiter)
  try {
    const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=us`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "registry-engine/0.1 (open source; github.com/alnaik/registry-engine)" },
    });
    if (resp.ok) {
      const results = await resp.json() as Array<{ lat: string; lon: string }>;
      const first = results[0];
      if (first !== undefined) {
        return { lat: parseFloat(first.lat), lng: parseFloat(first.lon) };
      }
    }
  } catch {
    // both failed
  }

  return null;
}

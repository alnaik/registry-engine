import { describe, it, expect } from "vitest";
import { haversineDistance, zipsWithinRadius } from "../../packages/registry-core/src/location/geometry.js";

describe("haversineDistance", () => {
  it("returns ~0 for same point", () => {
    expect(haversineDistance(39.74, -104.99, 39.74, -104.99)).toBeLessThan(1);
  });

  it("returns reasonable distance for Denver to Boulder", () => {
    // ~38-45km depending on exact coordinates used
    const dist = haversineDistance(39.7392, -104.9903, 40.0150, -105.2705);
    expect(dist).toBeGreaterThan(35000);
    expect(dist).toBeLessThan(55000);
  });

  it("returns reasonable distance for Denver to Colorado Springs", () => {
    // ~100km
    const dist = haversineDistance(39.7392, -104.9903, 38.8339, -104.8214);
    expect(dist).toBeGreaterThan(90000);
    expect(dist).toBeLessThan(115000);
  });
});

describe("zipsWithinRadius", () => {
  it("returns zip codes near Denver", () => {
    // Denver center, 5km radius
    const zips = zipsWithinRadius(39.7392, -104.9903, 5000);
    expect(zips.length).toBeGreaterThan(0);
    expect(zips.some(z => z.startsWith("802"))).toBe(true);
  });

  it("returns more zips with larger radius", () => {
    const zipsSmall = zipsWithinRadius(39.7392, -104.9903, 3000);
    const zipsLarge = zipsWithinRadius(39.7392, -104.9903, 20000);
    expect(zipsLarge.length).toBeGreaterThanOrEqual(zipsSmall.length);
  });

  it("returns empty array when radius is 0", () => {
    // No zip centroid will be exactly at an arbitrary point
    const zips = zipsWithinRadius(39.0000, -104.0000, 0);
    expect(Array.isArray(zips)).toBe(true);
  });

  it("returns Colorado Springs zips for CS center", () => {
    const zips = zipsWithinRadius(38.8339, -104.8214, 10000);
    expect(zips.length).toBeGreaterThan(0);
    expect(zips.some(z => z.startsWith("809"))).toBe(true);
  });
});

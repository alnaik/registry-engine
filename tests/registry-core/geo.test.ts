import { describe, it, expect } from "vitest";
import {
  zipCentroid, placeCentroid, regionPlaces, milesBetween, resolveLocation, entityPoint,
} from "../../packages/registry-core/src/geo.js";
import type { Entity } from "../../packages/registry-core/src/entity.js";

function ent(address: Entity["address"]): Entity {
  return {
    id: "x:1", name: "Acme", names: [], status: "", address, officers: [], naics: [],
    contacts: [], source_ids: ["x"], evidence: [],
  };
}

describe("zip and place lookups", () => {
  it("finds a ZIP centroid from the first 5 characters", () => {
    const p = zipCentroid("80202")!;
    expect(p.lat).toBeCloseTo(39.75, 1);
    expect(p.lon).toBeCloseTo(-105.0, 1);
    expect(zipCentroid("80202-1234")).toEqual(p);
    expect(zipCentroid("00000")).toBeUndefined();
  });

  it("finds a place centroid case- and whitespace-insensitively", () => {
    const denver = placeCentroid("US-CO", "denver")!;
    expect(denver.lat).toBeCloseTo(39.76, 1);
    expect(placeCentroid("US-CO", "  DENVER ")).toEqual(denver);
    expect(placeCentroid("US-CO", "Castle  Rock")).toBeDefined();
    expect(placeCentroid("US-CO", "Atlantis")).toBeUndefined();
    expect(placeCentroid("US-ZZ", "denver")).toBeUndefined();
  });

  it("lists lowercased region places", () => {
    const places = regionPlaces("US-CO");
    expect(places).toContain("denver");
    expect(places).toContain("castle rock");
    expect(places.every(p => p === p.toLowerCase())).toBe(true);
    expect(regionPlaces("US-ZZ")).toEqual([]);
  });
});

describe("milesBetween", () => {
  it("Denver to Boulder is about 25 miles", () => {
    const d = milesBetween(placeCentroid("US-CO", "denver")!, placeCentroid("US-CO", "boulder")!);
    expect(d).toBeGreaterThan(24);
    expect(d).toBeLessThan(27);
  });

  it("is zero for the same point", () => {
    const p = zipCentroid("80202")!;
    expect(milesBetween(p, p)).toBe(0);
  });
});

describe("resolveLocation", () => {
  it("resolves a ZIP, a place, and nothing for the unknown", () => {
    const zip = resolveLocation("US-CO", "80202")!;
    expect(zip.label).toBe("ZIP 80202");
    expect(zip.point).toEqual(zipCentroid("80202"));
    const place = resolveLocation("US-CO", "castle rock")!;
    expect(place.label).toBe("Castle Rock, CO");
    expect(place.point).toEqual(placeCentroid("US-CO", "castle rock"));
    expect(resolveLocation("US-CO", "Atlantis")).toBeUndefined();
    expect(resolveLocation("US-CO", "00000")).toBeUndefined();
  });
});

describe("entityPoint", () => {
  it("prefers the ZIP centroid, then the city centroid, else undefined", () => {
    expect(entityPoint(ent({ zip: "80202", city: "Boulder" }), "US-CO")).toEqual(zipCentroid("80202"));
    expect(entityPoint(ent({ zip: "00000", city: "Boulder" }), "US-CO")).toEqual(placeCentroid("US-CO", "boulder"));
    expect(entityPoint(ent({ city: "Boulder" }), "US-CO")).toEqual(placeCentroid("US-CO", "boulder"));
    expect(entityPoint(ent({ city: "Atlantis" }), "US-CO")).toBeUndefined();
    expect(entityPoint(ent({}), "US-CO")).toBeUndefined();
  });
});

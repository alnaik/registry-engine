import { describe, it, expect } from "vitest";
import {
  zipCentroid, placeCentroid, regionPlaces, milesBetween, resolveLocation, entityPoint,
  zipState, stateName, locationState,
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

describe("resolveLocation forms and states", () => {
  it("resolves ZIP+4 as its first 5 digits", () => {
    const r = resolveLocation("US-CO", "80202-1234")!;
    expect(r.label).toBe("ZIP 80202");
    expect(r.point).toEqual(zipCentroid("80202"));
    expect(resolveLocation("US-CO", "8020-12345")).toBeUndefined();
  });

  it("accepts a trailing state code or name that matches the region", () => {
    const denver = placeCentroid("US-CO", "denver");
    for (const input of ["Denver, CO", "denver co", "Denver, Colorado", "DENVER  COLORADO", "Denver,CO"]) {
      const r = resolveLocation("US-CO", input)!;
      expect(r.label).toBe("Denver, CO");
      expect(r.point).toEqual(denver);
    }
    expect(resolveLocation("US-CO", "Castle Rock CO")!.label).toBe("Castle Rock, CO");
    expect(resolveLocation("US-CO", "Atlantis, CO")).toBeUndefined();
  });

  it("refuses a ZIP or a town in another state", () => {
    expect(resolveLocation("US-CO", "06103")).toBeUndefined();
    expect(resolveLocation("US-CO", "Hartford, CT")).toBeUndefined();
    expect(resolveLocation("US-CO", "Hartford, Connecticut")).toBeUndefined();
    expect(resolveLocation("US-CT", "06103")!.label).toBe("ZIP 06103");
  });

  it("resolves a place whose own name ends in a state word when typed bare", () => {
    // "North Washington" is a CO place; the whole text is tried before any strip.
    expect(resolveLocation("US-CO", "North Washington")!.label).toBe("North Washington, CO");
    expect(resolveLocation("US-CO", "North Washington, CO")!.label).toBe("North Washington, CO");
    expect(resolveLocation("US-NY", "Port Washington")!.label).toBe("Port Washington, NY");
  });
});

describe("zipState, stateName and locationState", () => {
  it("maps a ZIP to its state from the first 3 digits", () => {
    expect(zipState("80202")).toBe("CO");
    expect(zipState("06103")).toBe("CT");
    expect(zipState("10001")).toBe("NY");
    expect(zipState("00501")).toBe("NY");
    expect(zipState("20001")).toBe("DC");
    expect(zipState("00601")).toBe("PR");
    expect(zipState("99950")).toBe("AK");
    expect(zipState("80202-1234")).toBeUndefined();
    expect(zipState("8020")).toBeUndefined();
    expect(zipState("abcde")).toBeUndefined();
    expect(zipState("00000")).toBeUndefined();
  });

  it("names a state from its postal code", () => {
    expect(stateName("CO")).toBe("Colorado");
    expect(stateName("ct")).toBe("Connecticut");
    expect(stateName("ZZ")).toBeUndefined();
  });

  it("reports the state a location names explicitly", () => {
    expect(locationState("06103")).toBe("CT");
    expect(locationState("80202-1234")).toBe("CO");
    expect(locationState("Hartford, CT")).toBe("CT");
    expect(locationState("Charleston West Virginia")).toBe("WV");
    expect(locationState("Denver")).toBeUndefined();
    expect(locationState("00000")).toBeUndefined();
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

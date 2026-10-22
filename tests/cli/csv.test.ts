import { describe, it, expect } from "vitest";
import { csvCell, leadsToCsv, CSV_HEADER } from "../../apps/cli/src/csv.js";
import type { Lead } from "../../packages/qualify/src/verbs/brief.js";

describe("csvCell", () => {
  it("double-quotes every cell and doubles embedded quotes", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("plain")).toBe('"plain"');
    expect(csvCell(14)).toBe('"14"');
    expect(csvCell(undefined)).toBe('""');
  });

  it("keeps embedded newlines inside the quotes", () => {
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("neutralises spreadsheet formulas with a leading apostrophe", () => {
    for (const bad of ["=SUM(A1)", "+1+1", "-2+3", "@cmd", "\tTAB", "\rCR"]) {
      expect(csvCell(bad)).toBe(`"'${bad}"`);
    }
    expect(csvCell("a=b")).toBe('"a=b"');
    expect(csvCell("(303) 555-0100")).toBe('"(303) 555-0100"');
  });
});

describe("leadsToCsv", () => {
  const lead: Lead = {
    entity: {
      id: "ppp:1", name: '=HYPERLINK("http://evil")', names: ["ACME", "ACME INC"], status: "",
      address: { street: "1 Main St", city: "Denver", state: "CO", zip: "80207" },
      officers: ["JANE DOE", "JOHN ROE"], naics: ["332312", "999999"], contacts: ["info@x.com", "(303) 555-0100"],
      source_ids: ["co_sos", "ppp"], evidence: [], employees: 14, lastSeen: "2024-05-02",
    },
    score: 95, probe: undefined, web: "none", brief: 'Brief, with "quotes"', opener: "Hi", searchUrl: "https://duckduckgo.com/?q=x", distanceMi: null, band: "",
  };

  it("writes the header and one fully-quoted row per lead, multi-values joined with '; '", () => {
    const [header, row] = leadsToCsv([lead], ["co_sos"]).trimEnd().split("\n");
    expect(header).toBe(CSV_HEADER.map(h => `"${h}"`).join(","));
    expect(header).toBe('"rank","score","name","other_names","street","city","state","zip","naics","naics_titles","employees","last_seen","sources","on_state_registry","contacts","web","search_url","officers","brief","opener","distance_mi","band","found_status","found_phone","found_email","found_website","found_sources"');
    expect(row).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(row).toContain('"ACME; ACME INC"');
    expect(row).toContain('"332312; 999999"');
    expect(row).toContain('"Fabricated Structural Metal Manufacturing; "');
    expect(row).toContain('"co_sos; ppp","yes"');
    expect(row).toContain('"info@x.com; (303) 555-0100"');
    expect(row).toContain('"JANE DOE; JOHN ROE"');
    expect(row).toContain('"Brief, with ""quotes"""');
    expect(row!.startsWith('"1","95",')).toBe(true);
  });

  it("appends distance, band and found-contact columns", () => {
    const withFound: Lead = {
      ...lead, distanceMi: 12.3, band: "10–25 mi",
      found: {
        status: "found", provider: "exa", website: "https://acme.example", phone: "(303) 555-0142",
        email: "a@acme.example", listings: [], sourceUrls: ["https://acme.example/", "https://yelp.com/biz/acme"],
      },
    };
    const [, row] = leadsToCsv([withFound], []).trimEnd().split("\n");
    expect(row!.endsWith(',"12.3","10–25 mi","found","(303) 555-0142","a@acme.example","https://acme.example","https://acme.example/; https://yelp.com/biz/acme"')).toBe(true);
    const [, bare] = leadsToCsv([lead], []).trimEnd().split("\n");
    expect(bare!.endsWith(',"","","","","","",""')).toBe(true);
  });
});

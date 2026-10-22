#!/usr/bin/env python3
"""Build the geo lookup tables from the Census 2024 Gazetteer files.

Usage:
  python3 -I scripts/data/build_geo.py [--zcta <txt>] [--places <txt>] [--states CO,CT,NY]

Omitted inputs are downloaded from census.gov (zip archives) into memory.
Writes into packages/registry-core/src/geo/:
  zips.json    {"80202":[39.7525,-104.9995],...}  every ZCTA nationally
  places.json  {"US-CO":{"denver":[lat,lon],...},...}  places for --states
Place names are lowercased with the trailing LSAD word removed
("Denver city" -> "denver"); on duplicate names the first row wins.
Stdlib only.
"""
import argparse
import io
import json
import os
import urllib.request
import zipfile

BASE = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/"
ZCTA_URL = BASE + "2024_Gaz_zcta_national.zip"
PLACES_URL = BASE + "2024_Gaz_place_national.zip"
OUT_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "packages", "registry-core", "src", "geo",
)

# Longest first so "city and borough" wins over "city".
LSAD_SUFFIXES = sorted(
    [" city and borough", " (balance)", " municipality", " borough", " village", " town", " city", " cdp"],
    key=len,
    reverse=True,
)


def read_rows(path, url):
    """Yield dicts (header -> stripped value) from a Gazetteer txt or its zip."""
    if path is not None:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    else:
        with urllib.request.urlopen(url) as resp:
            data = resp.read()
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            name = next(n for n in zf.namelist() if n.lower().endswith(".txt"))
            text = zf.read(name).decode("utf-8", errors="replace")
    lines = [ln for ln in text.splitlines() if ln.strip() != ""]
    header = [h.strip() for h in lines[0].split("\t")]
    for ln in lines[1:]:
        cells = [c.strip() for c in ln.split("\t")]
        yield dict(zip(header, cells))


def strip_lsad(name):
    lower = name.strip().lower()
    for suffix in LSAD_SUFFIXES:
        if lower.endswith(suffix):
            return lower[: -len(suffix)].strip()
    return lower


def point(row):
    return [round(float(row["INTPTLAT"]), 4), round(float(row["INTPTLONG"]), 4)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zcta")
    ap.add_argument("--places")
    ap.add_argument("--states", default="CO,CT,NY")
    args = ap.parse_args()
    states = [s.strip().upper() for s in args.states.split(",") if s.strip()]

    zips = {}
    for row in read_rows(args.zcta, ZCTA_URL):
        zips[row["GEOID"]] = point(row)

    places = {f"US-{s}": {} for s in states}
    for row in read_rows(args.places, PLACES_URL):
        region = f"US-{row['USPS']}"
        if region not in places:
            continue
        name = strip_lsad(row["NAME"])
        if name != "" and name not in places[region]:
            places[region][name] = point(row)

    os.makedirs(OUT_DIR, exist_ok=True)
    for fname, obj in (("zips.json", zips), ("places.json", places)):
        with open(os.path.join(OUT_DIR, fname), "w", encoding="utf-8") as fh:
            json.dump(obj, fh, separators=(",", ":"))
            fh.write("\n")
    print(f"wrote {len(zips)} zips, " + ", ".join(f"{r}: {len(p)} places" for r, p in places.items()))


if __name__ == "__main__":
    main()

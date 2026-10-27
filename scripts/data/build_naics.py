#!/usr/bin/env python3
"""Build packages/registry-core/src/naics/naics2017.json from the Census files.

Usage:
  python3 -I scripts/data/build_naics.py [--index <xlsx>] [--codes <xlsx>]

Omitted inputs are downloaded from census.gov into a temp dir. Output shape:
  {"version":"2017","titles":{"<code>":"<title>"},"index":[["<6-digit>","<desc>"],...]}
Stdlib only.
"""
import argparse
import json
import os
import re
import sys
import tempfile
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

INDEX_URL = "https://www.census.gov/naics/2017NAICS/2017_NAICS_Index_File.xlsx"
CODES_URL = "https://www.census.gov/naics/2017NAICS/2-6%20digit_2017_Codes.xlsx"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
OUT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "packages", "registry-core", "src", "naics", "naics2017.json",
)


def xlsx_rows(path):
    """Yield each row of sheet1 as {column letter: text}."""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    for row in sheet.iter("{%s}row" % NS["m"]):
        out = {}
        for c in row.findall("m:c", NS):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            v = c.find("m:v", NS)
            if c.get("t") == "s" and v is not None:
                val = shared[int(v.text)]
            elif c.get("t") == "inlineStr":
                val = "".join(t.text or "" for t in c.iter("{%s}t" % NS["m"]))
            else:
                val = v.text if v is not None else ""
            out[col] = val
        yield out


def download(url, dest_dir, name):
    dest = os.path.join(dest_dir, name)
    req = urllib.request.Request(url, headers={"User-Agent": "registry-engine build_naics"})
    with urllib.request.urlopen(req, timeout=60) as resp, open(dest, "wb") as fh:
        fh.write(resp.read())
    return dest


def build_titles(path):
    titles = {}
    for row in xlsx_rows(path):
        code = (row.get("B") or "").strip()
        title = (row.get("C") or "").strip()
        if title == "":
            continue
        m = re.fullmatch(r"(\d{2})-(\d{2})", code)
        if m:
            # Sector range like "31-33" -> each member sector, same title.
            for n in range(int(m.group(1)), int(m.group(2)) + 1):
                titles[f"{n:02d}"] = title
        elif re.fullmatch(r"\d{2,6}", code):
            titles[code] = title
    return titles


def build_index(path):
    index = []
    for i, row in enumerate(xlsx_rows(path)):
        if i == 0:
            continue  # header
        code = (row.get("A") or "").strip()
        desc = (row.get("B") or "").strip()
        if re.fullmatch(r"\d{6}", code) and desc != "":
            index.append([code, desc])
    return index


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--index", help="2017 NAICS Index File .xlsx (downloaded if omitted)")
    ap.add_argument("--codes", help="2-6 digit 2017 codes .xlsx (downloaded if omitted)")
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        index_path = args.index or download(INDEX_URL, tmp, "index.xlsx")
        codes_path = args.codes or download(CODES_URL, tmp, "codes.xlsx")
        titles = build_titles(codes_path)
        index = build_index(index_path)

    out = {"version": "2017", "titles": titles, "index": index}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {os.path.normpath(OUT)}: {len(titles)} titles, {len(index)} index rows")


if __name__ == "__main__":
    sys.exit(main())

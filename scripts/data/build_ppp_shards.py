#!/usr/bin/env python3
"""Build PPP shards (one file per state x 2-digit NAICS sector) from SBA FOIA CSVs.

Usage:
  python3 -I scripts/data/build_ppp_shards.py --state CO --out shards/ppp <csv> [<csv>...]

Input: the SBA PPP FOIA release (https://data.sba.gov/dataset/ppp-foia), which
ships as several large CSVs sharing one header. Output, per sector NN:
  <out>/US-<STATE>/<NN>.json
read by the "ppp" source (static_shard driver, quirks.shardBy "naics2").
Stdlib only.
"""
import argparse
import csv
import datetime
import json
import os
import re
import sys

ORG_SUFFIXES = {
    "LLC", "LC", "INC", "INCORPORATED", "CORP", "CORPORATION",
    "LTD", "LIMITED", "CO", "COMPANY", "LLP", "LP", "PLLC", "PC", "PLC",
}
PLACEHOLDER_NAMES = {"EXEMPTION 6", "NOT AVAILABLE"}
NOTE = ("Built from SBA PPP FOIA CSVs (https://data.sba.gov/dataset/ppp-foia, 240930 release) "
        "by scripts/data/build_ppp_shards.py")


def normalize_name(raw):
    """Uppercase, & -> AND, punctuation -> space, trailing org-form tokens popped."""
    tokens = re.sub(r"[^A-Z0-9]+", " ", raw.upper().replace("&", " AND ")).split()
    while len(tokens) > 1 and tokens[-1] in ORG_SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


def iso_date(raw):
    """MM/DD/YYYY -> YYYY-MM-DD, or "" when it doesn't parse."""
    try:
        return datetime.datetime.strptime(raw.strip(), "%m/%d/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return ""


def zip5(raw):
    m = re.match(r"\d{5}", raw.strip())
    return m.group(0) if m else ""


def parse_jobs(raw):
    try:
        return int(raw.strip())
    except ValueError:
        return None


def read_rows(paths, state):
    """Yield (key, record, jobs) for each usable row of the given CSVs."""
    for path in paths:
        with open(path, encoding="utf-8", errors="replace", newline="") as fh:
            for row in csv.DictReader(fh):
                row_state = (row.get("BorrowerState") or "").strip().upper()
                if row_state == "":
                    row_state = (row.get("ProjectState") or "").strip().upper()
                if row_state != state:
                    continue
                name = (row.get("BorrowerName") or "").strip()
                if name == "" or name.upper() in PLACEHOLDER_NAMES:
                    continue
                naics = (row.get("NAICSCode") or "").strip()
                if not re.fullmatch(r"\d{6}", naics):
                    continue
                zip_code = zip5(row.get("BorrowerZip") or "")
                jobs = parse_jobs(row.get("JobsReported") or "")
                record = {
                    "loan_number": (row.get("LoanNumber") or "").strip(),
                    "name": name,
                    "address": (row.get("BorrowerAddress") or "").strip(),
                    "city": (row.get("BorrowerCity") or "").strip(),
                    "state": state,
                    "zip": zip_code,
                    "naics": naics,
                    "jobs": jobs,
                    "business_type": (row.get("BusinessType") or "").strip(),
                    "business_age": (row.get("BusinessAgeDescription") or "").strip(),
                    "date_approved": iso_date(row.get("DateApproved") or ""),
                }
                yield (normalize_name(name), zip_code), record, jobs


def dedupe(rows):
    """Collapse repeat borrowers (two-draw loans): newest row wins, jobs = max."""
    merged = {}
    for key, record, jobs in rows:
        cur = merged.get(key)
        if cur is None:
            merged[key] = [record, jobs]
            continue
        if record["date_approved"] > cur[0]["date_approved"]:
            cur[0] = record
        if jobs is not None and (cur[1] is None or jobs > cur[1]):
            cur[1] = jobs
    out = []
    for record, jobs in merged.values():
        record["jobs"] = jobs
        out.append(record)
    return out


def write_sector(out_dir, state, sector, records, today):
    region = f"US-{state}"
    records.sort(key=lambda r: (r["city"].upper(), r["name"].upper()))
    head = {
        "source": "ppp", "region": region, "sector": sector,
        "generated": today, "protocol_note": NOTE,
    }
    region_dir = os.path.join(out_dir, region)
    os.makedirs(region_dir, exist_ok=True)
    body = ",\n".join(json.dumps(r, separators=(",", ":"), ensure_ascii=False) for r in records)
    text = json.dumps(head, separators=(",", ":"), ensure_ascii=False)[:-1] + ',"records":[\n' + body + "\n]}\n"
    with open(os.path.join(region_dir, f"{sector}.json"), "w", encoding="utf-8") as fh:
        fh.write(text)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--state", required=True, help="two-letter state, e.g. CO")
    ap.add_argument("--out", required=True, help="output root, e.g. shards/ppp")
    ap.add_argument("csv", nargs="+", help="SBA PPP FOIA CSV file(s)")
    args = ap.parse_args()

    state = args.state.strip().upper()
    csv.field_size_limit(1 << 24)
    records = dedupe(read_rows(args.csv, state))

    by_sector = {}
    for r in records:
        by_sector.setdefault(r["naics"][:2], []).append(r)

    today = datetime.date.today().isoformat()
    for sector in sorted(by_sector):
        write_sector(args.out, state, sector, by_sector[sector], today)
        print(f"  {sector}: {len(by_sector[sector])}")
    print(f"{len(records)} borrowers in {len(by_sector)} sectors -> {os.path.join(args.out, 'US-' + state)}")


if __name__ == "__main__":
    sys.exit(main())

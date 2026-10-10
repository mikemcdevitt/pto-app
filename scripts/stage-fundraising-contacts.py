"""
Stage the fundraising partners spreadsheet for import into the contacts
tables (fundraising_partners / _contacts / _partner_contacts / _outreach).

READ-ONLY with respect to the database -- this only reads the .xlsx and
writes two review files:
  <out>.json  -- what import-fundraising-contacts.ts loads
  <out>.md    -- the same thing as a readable table, for checking

The spreadsheet is messy (near-duplicate names, contacts buried in comment
text, event ideas mixed in with businesses), so most of the judgment lives
in a curation file (exclude/fundraising-curation.json, gitignored -- it
has real names and contact details) rather than in parsing heuristics.
Edit that file or the staged JSON before importing.

Money columns (% Back, Amount received, per-month amounts) are ignored for
now -- month cells are only used to decide whether a partner was active.

Usage:
  python3 scripts/stage-fundraising-contacts.py "exclude/Sprague Fundraising Partners.xlsx" -o exclude/fundraising-staged
"""

import argparse
import json
import re
from collections import OrderedDict

import openpyxl

# Status is judged against the newest sheet. Older sheets only supply
# history ("ran before" -> inactive).
CURRENT_SHEET = "2526"
SHEET_YEARS = {"2526": "2025-26", "2425": "2024-25"}

# ---------------------------------------------------------------------------
# CURATED -- loaded from a JSON file kept in exclude/ (gitignored), because
# it holds real names, contact details and outreach notes. Keys:
#   RENAME                   source name -> canonical partner name
#   IDEAS                    "TO EXPLORE" labels that are event ideas, not businesses
#   EXPLORE_2425_BUSINESSES  canonical name -> note, for 2024-25 free-text explore lines
#   STATUS_OVERRIDES         name -> [status, reason]
#   PTO_OWNERS, WEBSITES, NOTES, REVIEW_FLAGS   name -> text
#   CONTACTS                 key -> {name, email?, phone?, notes?, links: [{partner, role, isPrimary, isCurrent}]}
#   OUTREACH                 [{partner, sheet, date, ptoMember, contactKey, note}]
# ---------------------------------------------------------------------------

RENAME = IDEAS = EXPLORE_2425_BUSINESSES = STATUS_OVERRIDES = None
PTO_OWNERS = WEBSITES = NOTES = CONTACTS = OUTREACH = REVIEW_FLAGS = None


def load_curation(path):
    global RENAME, IDEAS, EXPLORE_2425_BUSINESSES, STATUS_OVERRIDES
    global PTO_OWNERS, WEBSITES, NOTES, CONTACTS, OUTREACH, REVIEW_FLAGS
    with open(path) as f:
        c = json.load(f)
    RENAME = c["RENAME"]
    IDEAS = set(c["IDEAS"])
    EXPLORE_2425_BUSINESSES = c["EXPLORE_2425_BUSINESSES"]
    STATUS_OVERRIDES = {k: tuple(v) for k, v in c["STATUS_OVERRIDES"].items()}
    PTO_OWNERS = c["PTO_OWNERS"]
    WEBSITES = c["WEBSITES"]
    NOTES = c["NOTES"]
    CONTACTS = c["CONTACTS"]
    OUTREACH = [(o["partner"], o["sheet"], o["date"], o["ptoMember"], o["contactKey"], o["note"]) for o in c["OUTREACH"]]
    REVIEW_FLAGS = c["REVIEW_FLAGS"]


MONTH_COLS = list(range(2, 12))  # C..L (0-based)


def canon(name):
    n = re.sub(r"\s+", " ", str(name)).strip()
    return RENAME.get(n, n)


def read_sheet(ws):
    """Vendor rows above the TO EXPLORE / Notes section, plus explore rows."""
    vendors, explore = OrderedDict(), []
    section = "vendors"
    for row in ws.iter_rows(values_only=True):
        b = row[1] if len(row) > 1 else None
        if b is None:
            if section == "vendors" and len(row) > 12 and row[12] == "TOTAL":
                section = "after_total"
            continue
        label = str(b).strip()
        if label == "Vendor":
            continue
        low = label.lower()
        if low.startswith("to explore") or low == "notes:":
            section = "explore" if low.startswith("to explore") else "notes"
            continue
        if low.startswith("gift cards:"):
            continue
        if section == "vendors":
            months = [row[i] for i in MONTH_COLS if i < len(row) and row[i] not in (None, "")]
            amount = row[13] if len(row) > 13 else None
            activity = bool(months) or (isinstance(amount, (int, float)) and amount > 0)
            # Merged duplicates (e.g. "Ski & Tennis" + "Boston Ski & Tennis")
            # share one entry -- OR the activity so an empty duplicate row
            # can't hide the real one.
            prev = vendors.get(canon(label))
            vendors[canon(label)] = {
                "activity": activity or bool(prev and prev["activity"]),
                "rawNames": (prev["rawNames"] if prev else []) + [label],
            }
        elif section in ("explore", "after_total"):
            explore.append(label)
    return vendors, explore


def compute_status(name, sheets):
    if name in STATUS_OVERRIDES:
        return STATUS_OVERRIDES[name]
    cur = sheets[CURRENT_SHEET].get(name)
    if cur and cur["activity"]:
        return ("active", "Activity logged in 2025-26")
    ran_before = any(v.get(name, {}).get("activity") for k, v in sheets.items() if k != CURRENT_SHEET)
    if ran_before:
        return ("inactive", "Ran before; nothing logged in 2025-26")
    return ("prospective", "Listed, but never contacted/ran per the sheet")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("-o", "--out", required=True, help="output path without extension")
    ap.add_argument("--curation", default="exclude/fundraising-curation.json",
                    help="hand-curated merges/contacts/outreach (gitignored)")
    args = ap.parse_args()
    load_curation(args.curation)

    wb = openpyxl.load_workbook(args.xlsx, data_only=True)
    sheets, explore_raw = {}, {}
    for key in SHEET_YEARS:
        sheets[key], explore_raw[key] = read_sheet(wb[key])

    names = OrderedDict()
    for key in SHEET_YEARS:
        for n in sheets[key]:
            names.setdefault(n, set()).add(key)

    ideas_seen, explore_added = [], []
    # 2025-26 numbered TO EXPLORE rows: "1) Whole Foods..." style, name in column B.
    for label in explore_raw["2526"]:
        n = canon(label.lstrip("-").strip())
        if label in IDEAS or n in IDEAS or label.lstrip("-").strip() in IDEAS:
            ideas_seen.append(label)
        elif n not in names:
            names[n] = set()
            explore_added.append(n)
    # 2024-25 free-text explore lines -- curated list, everything else is an idea.
    for n in EXPLORE_2425_BUSINESSES:
        if n not in names:
            names[n] = set()
            explore_added.append(n)
    for label in explore_raw["2425"]:
        stripped = label.lstrip("-").strip()
        if stripped in IDEAS or label in IDEAS:
            ideas_seen.append(label)

    partners = []
    for n in sorted(names, key=lambda s: s.lower().removeprefix("the ")):
        status, why = compute_status(n, sheets)
        note_parts = [p for p in [NOTES.get(n), EXPLORE_2425_BUSINESSES.get(n)] if p]
        partners.append({
            "name": n,
            "status": status,
            "statusReason": why,
            "website": WEBSITES.get(n),
            "ptoOwner": PTO_OWNERS.get(n),
            "notes": " ".join(note_parts) or None,
            "sourceSheets": sorted(SHEET_YEARS[k] for k in names[n]) or ["to-explore list"],
            "reviewFlag": REVIEW_FLAGS.get(n),
        })
    partner_names = {p["name"] for p in partners}

    contacts = []
    for key, c in CONTACTS.items():
        for link in c["links"]:
            assert link["partner"] in partner_names, f"contact {key} links unknown partner {link['partner']}"
        contacts.append({"key": key, "name": c["name"], "email": c.get("email"), "phone": c.get("phone"),
                         "notes": c.get("notes"), "links": c["links"]})

    outreach = []
    for partner, sheet, date, member, contact_key, note in OUTREACH:
        assert partner in partner_names, f"outreach for unknown partner {partner}"
        assert contact_key is None or contact_key in CONTACTS, contact_key
        outreach.append({"partner": partner, "date": date, "ptoMember": member, "contactKey": contact_key,
                         "note": f"[{SHEET_YEARS[sheet]} sheet] {note}"})

    staged = {
        "source": args.xlsx,
        "statusJudgedAgainst": SHEET_YEARS[CURRENT_SHEET],
        "partners": partners,
        "contacts": contacts,
        "outreach": outreach,
        "ideasNotImported": sorted(set(ideas_seen)),
    }
    with open(args.out + ".json", "w") as f:
        json.dump(staged, f, indent=2, ensure_ascii=False)

    # Readable review table
    by_partner_contacts = {}
    for c in contacts:
        for l in c["links"]:
            bits = [c["name"]]
            if l["role"]:
                bits.append(l["role"])
            if c["email"]:
                bits.append(c["email"])
            by_partner_contacts.setdefault(l["partner"], []).append(", ".join(bits))
    outreach_count = {}
    for o in outreach:
        outreach_count[o["partner"]] = outreach_count.get(o["partner"], 0) + 1

    lines = [
        "# Fundraising contacts import -- review",
        "",
        f"{len(partners)} partners, {len(contacts)} contacts, {len(outreach)} outreach entries. "
        f"Status judged against {SHEET_YEARS[CURRENT_SHEET]}.",
        "",
        "| Partner | Status | Why | PTO owner | Contacts | Log | From | Check |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for p in partners:
        lines.append("| " + " | ".join([
            p["name"], p["status"], p["statusReason"], p["ptoOwner"] or "",
            "; ".join(by_partner_contacts.get(p["name"], [])), str(outreach_count.get(p["name"], "")),
            ", ".join(p["sourceSheets"]), p["reviewFlag"] or "",
        ]).replace("\n", " ") + " |")
    lines += ["", "## Event ideas not imported", ""] + [f"- {i}" for i in staged["ideasNotImported"]]
    lines += ["", "## Name merges applied", ""] + [f"- {a} → {b}" for a, b in RENAME.items()]
    with open(args.out + ".md", "w") as f:
        f.write("\n".join(lines) + "\n")

    counts = {}
    for p in partners:
        counts[p["status"]] = counts.get(p["status"], 0) + 1
    print(f"{len(partners)} partners {counts}, {len(contacts)} contacts, {len(outreach)} outreach, "
          f"{len(staged['ideasNotImported'])} ideas skipped")
    print("explore businesses added:", explore_added)


if __name__ == "__main__":
    main()

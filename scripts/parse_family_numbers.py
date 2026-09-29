#!/usr/bin/env python3
"""
Parses a Numbers export of the family directory into the same
family/parent/student JSON shape as parse-family-directory.ts, but reads
directly from a .numbers spreadsheet instead of pasted text.

Expected layout: one sheet/table, one row per family, columns
[Parent, 2nd Parent, Students, ...]. Each cell is multi-line text:

  Parent / 2nd Parent cell:
    Last, First
    email@example.com          (optional)
    123 Some St                (optional, 0-2 address lines)
    City, ST 00000
    m: (555) 555-5555          (optional, h: and/or m:)

  Students cell (one or more students concatenated):
    First Last (Grade)
    preferred_name: Nickname   (optional)
    Home Room Teacher: 4 - Last, First   (optional)
    Home Room: 4AB                        (optional)

Does not touch the database -- only parses and reports, same as the .ts
version. Requires the numbers-parser package:
    pip3 install numbers-parser --break-system-packages

Usage:
    python3 scripts/parse_family_numbers.py exclude/export-p10.numbers -o exclude/export-p10-parsed.json

NOTE ON PII: don't commit the .numbers export or this script's JSON output
-- they contain real names/emails/phones/addresses. Keep them under
exclude/, which is gitignored.
"""

import argparse
import json
import re
import sys

from numbers_parser import Document

GRADE_TEXT_TO_ENUM = {
    "kindergarten": "kindergarten",
    "1st grade": "first",
    "2nd grade": "second",
    "3rd grade": "third",
    "4th grade": "fourth",
    "5th grade": "fifth",
}
GRADE_NUM_TO_ENUM = {
    "k": "kindergarten",
    "1": "first",
    "2": "second",
    "3": "third",
    "4": "fourth",
    "5": "fifth",
}

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_RE = re.compile(r"^(h|m):\s*(.+)$", re.IGNORECASE)
PREFERRED_NAME_RE = re.compile(r"^preferred_name:\s*(.+)$", re.IGNORECASE)
HOMEROOM_TEACHER_RE = re.compile(r"^Home Room Teacher:\s*(.*)$", re.IGNORECASE)
HOMEROOM_RE = re.compile(r"^Home Room:\s*(.+)$", re.IGNORECASE)
STUDENT_HEADER_RE = re.compile(r"^(.+?)\s+\((Kindergarten|[1-5](?:st|nd|rd|th) Grade)\)$")
PARENT_NAME_RE = re.compile(r"^(.+?),\s*(.+)$")
HOMEROOM_DASH_RE = re.compile(r"^([Kk0-9]+)\s*-\s*(.+)$")


def normalize_grade(raw):
    return GRADE_TEXT_TO_ENUM.get(raw.strip().lower())


def lines_of(cell_text):
    if not cell_text:
        return []
    return [l.strip() for l in cell_text.split("\n") if l.strip() != ""]


def parse_homeroom_teacher(raw, where, warnings):
    m = HOMEROOM_DASH_RE.match(raw.strip())
    if not m:
        warnings.append(f"{where}: Home Room Teacher line didn't match \"<grade> - <name>\": \"{raw}\"")
        return {"gradeNum": None, "name": None, "lastName": None, "firstName": None, "raw": raw}
    grade_num, name = m.group(1), m.group(2)
    parts = [p.strip() for p in name.split(",")]
    if len(parts) != 2:
        warnings.append(
            f"{where}: Teacher name not in \"Last, First\" format (check for a typo, e.g. a period instead of a comma): \"{name}\""
        )
        return {"gradeNum": grade_num, "name": name, "lastName": None, "firstName": None, "raw": raw}
    return {"gradeNum": grade_num, "name": name, "lastName": parts[0], "firstName": parts[1], "raw": raw}


def parse_parent_cell(cell_text, where, warnings):
    lines = lines_of(cell_text)
    if not lines:
        return None
    name_match = PARENT_NAME_RE.match(lines[0])
    if not name_match:
        warnings.append(f"{where}: parent cell's first line isn't \"Last, First\": \"{lines[0]}\"")
        last_name, first_name = None, lines[0]
    else:
        last_name, first_name = name_match.group(1).strip(), name_match.group(2).strip()

    email = None
    phones = []
    address_lines = []
    for line in lines[1:]:
        if EMAIL_RE.match(line):
            email = line
            continue
        phone_match = PHONE_RE.match(line)
        if phone_match:
            phones.append({"type": phone_match.group(1).lower(), "number": phone_match.group(2).strip()})
            continue
        address_lines.append(line)

    return {
        "lastName": last_name,
        "firstName": first_name,
        "email": email,
        "phones": phones,
        "address": ", ".join(address_lines) if address_lines else None,
    }


def parse_students_cell(cell_text, where, warnings):
    lines = lines_of(cell_text)
    students = []
    current = None

    for line in lines:
        header = STUDENT_HEADER_RE.match(line)
        if header:
            if current:
                students.append(current)
            full_name, grade_raw = header.group(1).strip(), header.group(2).strip()
            grade = normalize_grade(grade_raw)
            if not grade:
                warnings.append(f"{where}: couldn't normalize grade \"{grade_raw}\" for student \"{full_name}\"")
            name_parts = full_name.split()
            guessed_first = " ".join(name_parts[:-1])
            guessed_last = name_parts[-1] if name_parts else ""
            if len(name_parts) > 2:
                warnings.append(
                    f'{where}: "{full_name}" has more than two words -- first/last split is a guess '
                    f'(guessed "{guessed_first}" / "{guessed_last}"), verify against the roster'
                )
            current = {
                "fullName": full_name,
                "guessedFirstName": guessed_first,
                "guessedLastName": guessed_last,
                "gradeRaw": grade_raw,
                "grade": grade,
                "preferredName": None,
                "homeroomTeacher": None,
                "homeroomAbbrev": None,
            }
            continue

        preferred = PREFERRED_NAME_RE.match(line)
        if preferred:
            if current:
                current["preferredName"] = preferred.group(1).strip()
            else:
                warnings.append(f"{where}: preferred_name line didn't follow a student: \"{line}\"")
            continue

        teacher = HOMEROOM_TEACHER_RE.match(line)
        if teacher:
            if current:
                t = parse_homeroom_teacher(teacher.group(1), where, warnings)
                current["homeroomTeacher"] = t
                expected = GRADE_NUM_TO_ENUM.get((t["gradeNum"] or "").lower())
                if expected and current["grade"] and expected != current["grade"]:
                    warnings.append(
                        f'{where}: {current["fullName"]} is marked "{current["gradeRaw"]}" but homeroom '
                        f'teacher is listed under grade "{t["gradeNum"]}" -- check this row'
                    )
            else:
                warnings.append(f"{where}: Home Room Teacher line didn't follow a student: \"{line}\"")
            continue

        homeroom = HOMEROOM_RE.match(line)
        if homeroom:
            if current:
                current["homeroomAbbrev"] = homeroom.group(1).strip()
            else:
                warnings.append(f"{where}: Home Room line didn't follow a student: \"{line}\"")
            continue

        warnings.append(f"{where}: unrecognized line in students cell: \"{line}\"")

    if current:
        students.append(current)
    return students


def row_is_empty(row):
    return all((c is None or str(c).strip() == "") for c in row[:3])


def row_is_header(row):
    return (row[0] or "").strip() == "Parent" and (row[2] or "").strip() == "Students"


def parse_numbers_file(path):
    doc = Document(path)
    families = []
    warnings = []

    for sheet in doc.sheets:
        for table in sheet.tables:
            for row_idx, row in enumerate(table.rows(values_only=True)):
                where = f'{sheet.name}/{table.name} row {row_idx + 1}'
                if row_is_empty(row) or row_is_header(row):
                    continue

                parent1 = parse_parent_cell(row[0] if len(row) > 0 else None, where, warnings)
                parent2 = parse_parent_cell(row[1] if len(row) > 1 else None, where, warnings)
                students = parse_students_cell(row[2] if len(row) > 2 else None, where, warnings)

                parents = [p for p in (parent1, parent2) if p]
                if not parents:
                    warnings.append(f"{where}: row had no parseable parent")
                if not students:
                    warnings.append(f"{where}: row had no parseable student")

                families.append({"parents": parents, "students": students})

    return families, warnings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="path to the .numbers export")
    ap.add_argument("-o", "--out", help="output JSON path (default: print to stdout)")
    args = ap.parse_args()

    families, warnings = parse_numbers_file(args.input)
    parent_count = sum(len(f["parents"]) for f in families)
    student_count = sum(len(f["students"]) for f in families)

    payload = json.dumps({"families": families}, indent=2)
    if args.out:
        with open(args.out, "w") as f:
            f.write(payload)
        print(f"Wrote {args.out}", file=sys.stderr)
    else:
        print(payload)

    print(f"\nParsed {len(families)} families, {parent_count} parents, {student_count} students.", file=sys.stderr)
    if warnings:
        print(f"\n{len(warnings)} warning(s) -- worth a look before trusting this data:", file=sys.stderr)
        for w in warnings:
            print(f"  {w}", file=sys.stderr)
    else:
        print("No warnings.", file=sys.stderr)


if __name__ == "__main__":
    main()

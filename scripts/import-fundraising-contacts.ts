/**
 * Loads the reviewed output of stage-fundraising-contacts.py into the
 * fundraising contacts tables: partners, contacts, partner<->contact links,
 * and the outreach log.
 *
 * Dry run by default -- prints what it would insert. Pass --commit to write.
 * Refuses to run against a database that already has fundraising partners,
 * so it can't double-import; it's meant for the one-time seed.
 *
 * Everything goes in as ONE db.batch() (a single transaction on neon-http),
 * with ids generated here so links can reference rows in the same batch --
 * it either all lands or none of it does.
 *
 * Usage:
 *   npx tsx scripts/import-fundraising-contacts.ts exclude/fundraising-staged.json            # dry run
 *   npx tsx scripts/import-fundraising-contacts.ts exclude/fundraising-staged.json --commit   # write
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { count } from "drizzle-orm";
import {
  fundraisingContacts,
  fundraisingOutreach,
  fundraisingPartnerContacts,
  fundraisingPartners,
} from "../src/db/schema";
import { FUNDRAISING_STATUSES, type FundraisingStatus } from "../src/lib/fundraising";

interface StagedPartner {
  name: string;
  status: FundraisingStatus;
  website: string | null;
  ptoOwner: string | null;
  notes: string | null;
}
interface StagedContact {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  links: { partner: string; role: string | null; isPrimary: boolean; isCurrent: boolean }[];
}
interface StagedOutreach {
  partner: string;
  date: string | null;
  ptoMember: string | null;
  contactKey: string | null;
  note: string;
}
interface Staged {
  partners: StagedPartner[];
  contacts: StagedContact[];
  outreach: StagedOutreach[];
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const commit = args.includes("--commit");
  if (!file) {
    console.error("Usage: npx tsx scripts/import-fundraising-contacts.ts <staged.json> [--commit]");
    process.exit(1);
  }

  const staged: Staged = JSON.parse(readFileSync(file, "utf8"));

  // ---- Validate the (possibly hand-edited) file before touching the DB ----
  const problems: string[] = [];
  const partnerIds = new Map<string, string>();
  for (const p of staged.partners) {
    if (!p.name?.trim()) problems.push("A partner has no name.");
    if (!FUNDRAISING_STATUSES.includes(p.status)) problems.push(`${p.name}: unknown status "${p.status}"`);
    if (partnerIds.has(p.name)) problems.push(`Duplicate partner name: ${p.name}`);
    partnerIds.set(p.name, randomUUID());
  }

  const contactIds = new Map<string, string>();
  const emails = new Set<string>();
  for (const c of staged.contacts) {
    if (contactIds.has(c.key)) problems.push(`Duplicate contact key: ${c.key}`);
    contactIds.set(c.key, randomUUID());
    const email = c.email?.trim().toLowerCase();
    if (email) {
      if (emails.has(email)) problems.push(`Two contacts share ${email}`);
      emails.add(email);
    }
    for (const l of c.links) {
      if (!partnerIds.has(l.partner)) problems.push(`${c.name} links to unknown partner "${l.partner}"`);
    }
  }
  for (const p of staged.partners) {
    const primaries = staged.contacts.filter((c) => c.links.some((l) => l.partner === p.name && l.isPrimary));
    if (primaries.length > 1) problems.push(`${p.name} has ${primaries.length} primary contacts`);
  }
  for (const o of staged.outreach) {
    if (!partnerIds.has(o.partner)) problems.push(`Outreach for unknown partner "${o.partner}"`);
    if (o.contactKey && !contactIds.has(o.contactKey)) problems.push(`Outreach names unknown contact "${o.contactKey}"`);
    if (o.date && !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) problems.push(`Bad outreach date "${o.date}" for ${o.partner}`);
  }
  if (problems.length) {
    console.error("Fix these in the staged file first:\n  " + problems.join("\n  "));
    process.exit(1);
  }

  const partnerRows = staged.partners.map((p) => ({
    id: partnerIds.get(p.name)!,
    name: p.name.trim(),
    status: p.status,
    website: p.website,
    ptoOwner: p.ptoOwner,
    notes: p.notes,
  }));
  const contactRows = staged.contacts.map((c) => ({
    id: contactIds.get(c.key)!,
    name: c.name.trim(),
    email: c.email?.trim().toLowerCase() || null,
    phone: c.phone,
    notes: c.notes,
  }));
  const linkRows = staged.contacts.flatMap((c) =>
    c.links.map((l) => ({
      partnerId: partnerIds.get(l.partner)!,
      contactId: contactIds.get(c.key)!,
      role: l.role,
      isPrimary: l.isPrimary && l.isCurrent,
      isCurrent: l.isCurrent,
    }))
  );
  const outreachRows = staged.outreach.map((o) => ({
    partnerId: partnerIds.get(o.partner)!,
    contactId: o.contactKey ? contactIds.get(o.contactKey)! : null,
    date: o.date,
    ptoMember: o.ptoMember,
    note: o.note,
  }));

  const byStatus = partnerRows.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `${partnerRows.length} partners ${JSON.stringify(byStatus)}, ${contactRows.length} contacts, ` +
      `${linkRows.length} contact links, ${outreachRows.length} outreach entries`
  );

  if (!commit) {
    console.log("\nDry run -- nothing written. Re-run with --commit to import.");
    return;
  }

  const { db } = await import("../src/db");

  const [{ n }] = await db.select({ n: count() }).from(fundraisingPartners);
  if (n > 0) {
    console.error(`fundraising_partners already has ${n} rows -- refusing to import twice.`);
    process.exit(1);
  }

  await db.batch([
    db.insert(fundraisingPartners).values(partnerRows),
    db.insert(fundraisingContacts).values(contactRows),
    db.insert(fundraisingPartnerContacts).values(linkRows),
    db.insert(fundraisingOutreach).values(outreachRows),
  ]);

  console.log("Imported.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

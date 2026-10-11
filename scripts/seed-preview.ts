/**
 * Fills a PREVIEW database with anonymous, made-up data: school years,
 * classrooms, families (parents, students, classroom assignments), a
 * donation campaign, and a fictional fundraising partner directory. Nothing
 * here comes from real records -- names are random combinations from
 * scripts/seed-preview-names.ts and every email ends in .seed.test /
 * seed.test (a reserved, undeliverable domain).
 *
 * All the "ratios" -- grade mix, kids per family, parents per family,
 * donation rate by grade, and so on -- live in CONFIG just below. Change the
 * numbers and re-run; the same --seed always produces the same data.
 *
 * SAFETY. This script never reads .env.local. It reads ONLY
 * .env.preview.local (see .env.preview.local.example), and it refuses to run
 * if that file's database host is the same as the one in .env.local (your
 * real database). It also refuses to touch a database that already has
 * anything in it unless you pass --wipe AND --confirm-host=<that host>, so a
 * pasted-wrong connection string can't quietly empty production.
 *
 * Defaults to DRY RUN: generates everything in memory, prints a summary and
 * what the target database currently holds, and writes nothing.
 *
 * Usage:
 *   npx tsx scripts/seed-preview.ts                                   # dry run
 *   npx tsx scripts/seed-preview.ts --commit                          # seed an EMPTY database
 *   npx tsx scripts/seed-preview.ts --wipe --confirm-host=<host> --commit
 *       # empty the preview database first (every app table), then seed it
 *   add --seed=123 to get a different (but repeatable) random dataset
 *
 * Why --wipe exists: a Neon branch made from your main branch starts as a
 * copy of your real data. --wipe clears all of it (including saved sign-in
 * sessions and OAuth tokens) before the fake data goes in.
 */

import { config, parse as parseEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { GRADE_ORDER, type Grade } from "../src/lib/grades";
import {
  CONTACT_ROLES,
  FIRST_NAMES,
  LAST_NAMES,
  OUTREACH_NOTES,
  PARTNER_NAMES,
  PTO_MEMBERS,
  TEACHER_NAMES,
  TEACHER_TITLES,
} from "./seed-preview-names";

// ---------------------------------------------------------------------------
// The ratios. Pairs are [value, weight]; weights don't need to add to 1.
// ---------------------------------------------------------------------------
const CONFIG = {
  seed: 20261001,

  // Must match CURRENT_SCHOOL_YEAR_LABEL in the preview deployment's env.
  currentSchoolYearLabel: "2026-2027",
  // Donations are spread from this date up to "now", front-loaded.
  campaignOpenedAt: "2026-09-01",
  campaignId: "seed-campaign-2026", // set WIX_DONATION_CAMPAIGN_ID to this in the preview env

  familyCount: 250,

  // Which grade a family's first (anchor) child is in. Siblings are placed
  // relative to that child, so overall grade counts end up a bit different.
  anchorGradeMix: [
    ["kindergarten", 18], ["first", 17], ["second", 17], ["third", 16], ["fourth", 16], ["fifth", 16],
  ] as [Grade, number][],

  // Children per family at the school, counting siblings outside K-5 that we keep.
  childrenPerFamily: [[1, 42], [2, 40], [3, 14], [4, 4]] as [number, number][],
  // Years between a sibling and the anchor child (0 = twin), direction random.
  siblingGapYears: [[0, 7], [1, 33], [2, 28], [3, 14], [4, 10], [5, 8]] as [number, number][],
  // A sibling who lands outside K-5 (younger preschooler, older middle schooler)
  // is kept this often; otherwise we try a different gap.
  keepOutOfRangeSiblingRate: 0.25,

  parentsPerFamily: [[1, 18], [2, 80], [3, 2]] as [number, number][],
  secondParentSameLastNameRate: 0.65,
  childSameLastNameAsFamilyRate: 0.9,
  parentExtraEmailRate: 0.12, // a work/secondary address in parent_emails
  familyNameBlankRate: 0.1, // families.name is optional

  // Classrooms per grade, each school year. Kids are spread evenly across them.
  classroomsPerGrade: { kindergarten: 3, first: 3, second: 3, third: 3, fourth: 3, fifth: 3 } as Record<Grade, number>,
  // Share of current-year K-5 students with no classroom yet (late enrollees).
  unassignedRate: 0.02,

  // Chance a family donates, by the grade of its child (a family with kids
  // in several grades uses the average).
  donationRateByGrade: {
    kindergarten: 0.3, first: 0.38, second: 0.45, third: 0.5, fourth: 0.55, fifth: 0.6,
  } as Record<Grade, number>,
  donationAmountCents: [
    [2500, 10], [5000, 20], [10000, 30], [15000, 25], [20000, 10], [50000, 5],
  ] as [number, number][],
  // Donations from an email that matches no parent (grandparents, neighbors),
  // as a share of the matched donations.
  unmatchedDonationShare: 0.06,
  // When a donating family has a second email on file, how often the gift used it.
  donationUsesSecondaryEmailRate: 0.25,

  // Fundraising partner directory (all fictional).
  partnerCount: 14,
  partnerStatus: [["active", 35], ["contacted", 25], ["prospective", 25], ["inactive", 15]] as [
    "active" | "contacted" | "prospective" | "inactive",
    number,
  ][],
  contactsPerPartner: [[1, 60], [2, 35], [3, 5]] as [number, number][],
  percentBackBasisPoints: [[1000, 30], [1500, 20], [2000, 35], [2500, 15]] as [number, number][],
};

const PRIMARY_DOMAIN = "seed.test";
const SECONDARY_DOMAIN = "work.seed.test";
const PARTNER_DOMAIN = "partners.seed.test";
const PREVIEW_ENV_FILE = ".env.preview.local";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function die(message: string): never {
  console.error(`\nSTOPPED: ${message}\n`);
  process.exit(1);
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Neon pooled and direct hosts differ only by "-pooler" -- treat as one.
function dbHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/-pooler(?=\.)/, "");
  } catch {
    return null;
  }
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

async function chunked<T>(rows: T[], run: (chunk: T[]) => PromiseLike<unknown>, size = 400) {
  for (let i = 0; i < rows.length; i += size) await run(rows.slice(i, i + size));
}

// ---------------------------------------------------------------------------
// Data generation (pure -- no database access)
// ---------------------------------------------------------------------------
interface SeedParent {
  id: string;
  firstName: string;
  lastName: string;
  emails: { email: string; isPrimary: boolean }[];
}
interface SeedStudent {
  id: string;
  firstName: string;
  lastName: string;
  cohortYear: number;
  gradeIndex: number; // this school year: 0=K .. 5=fifth; outside 0-5 = not in K-5
}
interface SeedFamily {
  id: string;
  name: string | null;
  parents: SeedParent[];
  students: SeedStudent[];
}

function generate(seed: number, testParentEmail: string | null) {
  const rand = mulberry32(seed);
  const chance = (p: number) => rand() < p;
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  const pickWeighted = <T>(items: [T, number][]): T => {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    let r = rand() * total;
    for (const [value, weight] of items) {
      r -= weight;
      if (r < 0) return value;
    }
    return items[items.length - 1][0];
  };
  const shuffle = <T>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const currentSortYear = Number(CONFIG.currentSchoolYearLabel.slice(-4));
  const previousSortYear = currentSortYear - 1;
  const schoolYearLabel = (sortYear: number) => `${sortYear - 1}-${sortYear}`;
  // A student who is in grade index g (0=K..5) this year finishes 5th grade in
  // the summer of currentSortYear + (5 - g).
  const cohortFor = (gradeIndex: number) => currentSortYear + 5 - gradeIndex;

  const simpleLastNames = LAST_NAMES.filter((n) => /^[A-Za-z]+$/.test(n));
  const usedEmails = new Set<string>();
  let emailCounter = 0;
  const makeEmail = (first: string, last: string, domain: string) => {
    let email: string;
    do {
      emailCounter++;
      email = `${slug(first)}.${slug(last)}${emailCounter}@${domain}`;
    } while (usedEmails.has(email));
    usedEmails.add(email);
    return email;
  };

  // ---- families -----------------------------------------------------------
  const families: SeedFamily[] = [];
  for (let f = 0; f < CONFIG.familyCount; f++) {
    const surname = pick(LAST_NAMES);
    const parentCount = pickWeighted(CONFIG.parentsPerFamily);
    const childCount = pickWeighted(CONFIG.childrenPerFamily);
    const usedFirst = new Set<string>();
    const freshFirst = () => {
      let n = pick(FIRST_NAMES);
      for (let i = 0; i < 20 && usedFirst.has(n); i++) n = pick(FIRST_NAMES);
      usedFirst.add(n);
      return n;
    };

    const parents: SeedParent[] = [];
    for (let p = 0; p < parentCount; p++) {
      const lastName = p === 0 ? surname : p === 1 && chance(CONFIG.secondParentSameLastNameRate) ? surname : pick(LAST_NAMES);
      const firstName = freshFirst();
      const emails = [{ email: makeEmail(firstName, lastName, PRIMARY_DOMAIN), isPrimary: true }];
      if (chance(CONFIG.parentExtraEmailRate)) {
        emails.push({ email: makeEmail(firstName, lastName, SECONDARY_DOMAIN), isPrimary: false });
      }
      parents.push({ id: randomUUID(), firstName, lastName, emails });
    }

    const otherSurname =
      parents[1] && parents[1].lastName !== surname ? parents[1].lastName : `${surname}-${pick(simpleLastNames)}`;
    const childLast = () => (chance(CONFIG.childSameLastNameAsFamilyRate) ? surname : otherSurname);

    const anchor = GRADE_ORDER.indexOf(pickWeighted(CONFIG.anchorGradeMix));
    const students: SeedStudent[] = [
      { id: randomUUID(), firstName: freshFirst(), lastName: childLast(), cohortYear: cohortFor(anchor), gradeIndex: anchor },
    ];
    for (let c = 1; c < childCount; c++) {
      let idx: number | null = null;
      for (let tries = 0; tries < 8 && idx === null; tries++) {
        const candidate = anchor + pickWeighted(CONFIG.siblingGapYears) * (chance(0.5) ? 1 : -1);
        if ((candidate >= 0 && candidate <= 5) || chance(CONFIG.keepOutOfRangeSiblingRate)) idx = candidate;
      }
      if (idx === null) continue;
      students.push({ id: randomUUID(), firstName: freshFirst(), lastName: childLast(), cohortYear: cohortFor(idx), gradeIndex: idx });
    }

    families.push({
      id: randomUUID(),
      name: chance(CONFIG.familyNameBlankRate) ? null : surname,
      parents,
      students,
    });
  }

  // Let the person previewing sign in as a parent and see real-looking kids.
  if (testParentEmail) {
    const inK5 = (f: SeedFamily) => f.students.filter((s) => s.gradeIndex >= 0 && s.gradeIndex <= 5).length;
    const target = families.find((f) => inK5(f) >= 2) ?? families[0];
    target.parents[0].emails[0].email = testParentEmail;
    usedEmails.add(testParentEmail);
  }

  // ---- school years + classrooms -----------------------------------------
  const teacherPool = shuffle(TEACHER_NAMES);
  let teacherCursor = 0;
  const years = [previousSortYear, currentSortYear].map((sortYear) => ({
    id: randomUUID(),
    sortYear,
    label: schoolYearLabel(sortYear),
  }));
  const classroomRows = years.flatMap((year) =>
    GRADE_ORDER.flatMap((grade, gi) =>
      Array.from({ length: CONFIG.classroomsPerGrade[grade] }, (_, i) => ({
        id: randomUUID(),
        schoolYearId: year.id,
        grade,
        gradeIndex: gi,
        teacherName: `${pick(TEACHER_TITLES)} ${teacherPool[teacherCursor++ % teacherPool.length]}`,
        abbreviation: `${gi === 0 ? "K" : gi}${String.fromCharCode(65 + i)}`,
      }))
    )
  );

  // ---- classroom assignments ---------------------------------------------
  const assignmentRows: { id: string; studentId: string; classroomId: string; schoolYearId: string }[] = [];
  for (const year of years) {
    const yearOffset = year.sortYear - currentSortYear; // 0 now, -1 last year
    const byGrade = new Map<number, SeedStudent[]>();
    for (const s of families.flatMap((f) => f.students)) {
      const g = s.gradeIndex + yearOffset;
      if (g < 0 || g > 5) continue;
      if (yearOffset === 0 && chance(CONFIG.unassignedRate)) continue;
      byGrade.set(g, [...(byGrade.get(g) ?? []), s]);
    }
    for (const [g, kids] of byGrade) {
      const rooms = classroomRows.filter((c) => c.schoolYearId === year.id && c.gradeIndex === g);
      shuffle(kids).forEach((s, i) =>
        assignmentRows.push({ id: randomUUID(), studentId: s.id, classroomId: rooms[i % rooms.length].id, schoolYearId: year.id })
      );
    }
  }

  // ---- donations ----------------------------------------------------------
  const currentYearId = years[1].id;
  const openedAt = new Date(`${CONFIG.campaignOpenedAt}T12:00:00Z`).getTime();
  const spanMs = Math.max(0, Date.now() - openedAt);
  const donationTime = () => new Date(openedAt + spanMs * rand() ** 1.8);
  const donationRows: {
    id: string; wixOrderId: string; wixOrderNumber: string; donorEmail: string; amountCents: number;
    wixCampaignId: string; schoolYearId: string; orderCreatedAt: Date;
  }[] = [];
  const donatingFamilyIds = new Set<string>();
  const addDonation = (email: string) => {
    const n = donationRows.length + 1;
    donationRows.push({
      id: randomUUID(),
      wixOrderId: `seed-order-${n}`,
      wixOrderNumber: String(10000 + n),
      donorEmail: email,
      amountCents: pickWeighted(CONFIG.donationAmountCents),
      wixCampaignId: CONFIG.campaignId,
      schoolYearId: currentYearId,
      orderCreatedAt: donationTime(),
    });
  };
  for (const family of families) {
    const rates = family.students
      .filter((s) => s.gradeIndex >= 0 && s.gradeIndex <= 5)
      .map((s) => CONFIG.donationRateByGrade[GRADE_ORDER[s.gradeIndex]]);
    if (rates.length === 0 || !chance(rates.reduce((a, b) => a + b, 0) / rates.length)) continue;
    const donor = pick(family.parents);
    const secondary = donor.emails.find((e) => !e.isPrimary);
    const email = secondary && chance(CONFIG.donationUsesSecondaryEmailRate) ? secondary.email : donor.emails[0].email;
    addDonation(email);
    donatingFamilyIds.add(family.id);
  }
  const matchedDonations = donationRows.length;
  for (let i = 0; i < Math.round(matchedDonations * CONFIG.unmatchedDonationShare); i++) {
    addDonation(`supporter${i + 1}@${PRIMARY_DOMAIN}`);
  }

  // ---- fundraising partners (fictional) ----------------------------------
  const today = new Date();
  const daysFromToday = (d: number) => isoDate(new Date(today.getTime() + d * 86400000));
  const partners = PARTNER_NAMES.slice(0, CONFIG.partnerCount).map((name) => {
    const status = pickWeighted(CONFIG.partnerStatus);
    return {
      id: randomUUID(),
      name,
      status,
      website: `https://${slug(name)}.example.test`,
      notes: chance(0.5) ? "Seed data: friendly to school groups." : null,
      ptoOwner: pick(PTO_MEMBERS),
      // Some due soon, some already overdue, none for inactive partners.
      followUpBy: status === "inactive" ? null : daysFromToday(Math.round(rand() * 80 - 20)),
    };
  });
  const contacts: { id: string; name: string; email: string; phone: string; notes: string | null }[] = [];
  const partnerContacts: { partnerId: string; contactId: string; role: string; isPrimary: boolean; isCurrent: boolean }[] = [];
  partners.forEach((partner) => {
    const count = pickWeighted(CONFIG.contactsPerPartner);
    for (let i = 0; i < count; i++) {
      let contact = contacts.length > 0 && chance(0.08) ? pick(contacts) : null; // a person who works with two businesses
      if (contact && partnerContacts.some((pc) => pc.partnerId === partner.id && pc.contactId === contact!.id)) contact = null;
      if (!contact) {
        const first = pick(FIRST_NAMES);
        const last = pick(simpleLastNames);
        contact = {
          id: randomUUID(),
          name: `${first} ${last}`,
          email: makeEmail(first, last, PARTNER_DOMAIN),
          phone: `555-01${String(contacts.length % 100).padStart(2, "0")}`,
          notes: null,
        };
        contacts.push(contact);
      }
      partnerContacts.push({
        partnerId: partner.id,
        contactId: contact.id,
        role: pick(CONTACT_ROLES),
        isPrimary: i === 0,
        isCurrent: i === 0 || !chance(0.25),
      });
    }
  });
  const outreach = partners
    .filter((p) => p.status !== "prospective")
    .flatMap((partner) =>
      Array.from({ length: Math.floor(rand() * 4) + 1 }, () => {
        const linked = partnerContacts.filter((pc) => pc.partnerId === partner.id);
        return {
          id: randomUUID(),
          partnerId: partner.id,
          contactId: chance(0.7) && linked.length > 0 ? pick(linked).contactId : null,
          date: daysFromToday(-Math.round(rand() * 120)),
          ptoMember: pick(PTO_MEMBERS),
          note: pick(OUTREACH_NOTES),
        };
      })
    );
  const campaigns = partners
    .filter((p) => p.status === "active" || p.status === "inactive")
    .map((partner) => ({
      id: randomUUID(),
      partnerId: partner.id,
      schoolYearId: currentYearId,
      percentBackBasisPoints: pickWeighted(CONFIG.percentBackBasisPoints),
      amountReceivedCents: partner.status === "active" ? Math.round((5000 + rand() * 115000) / 100) * 100 : 0,
      amountLoggedMonth: Math.floor(rand() * 12) + 1,
      comments: chance(0.4) ? "Seed data: spirit night, 5-8pm." : null,
    }));
  const monthlyActivity = campaigns.flatMap((campaign) =>
    shuffle([9, 10, 11, 12, 1, 2, 3, 4, 5])
      .slice(0, Math.floor(rand() * 4))
      .map((month) => ({ id: randomUUID(), campaignId: campaign.id, month, note: "Seed data: event held." }))
  );

  return {
    currentSortYear,
    years,
    classroomRows,
    families,
    assignmentRows,
    donationRows,
    donatingFamilyIds,
    partners,
    contacts,
    partnerContacts,
    outreach,
    campaigns,
    monthlyActivity,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const wipe = args.includes("--wipe");
  const confirmHost = args.find((a) => a.startsWith("--confirm-host="))?.split("=")[1];
  const seedArg = args.find((a) => a.startsWith("--seed="))?.split("=")[1];
  const seed = seedArg ? Number(seedArg) : CONFIG.seed;
  if (!Number.isFinite(seed)) die(`--seed must be a number, got "${seedArg}".`);

  if (!existsSync(PREVIEW_ENV_FILE)) {
    die(
      `${PREVIEW_ENV_FILE} not found. Copy .env.preview.local.example to ${PREVIEW_ENV_FILE} and put the PREVIEW database's connection string in it.`
    );
  }
  config({ path: PREVIEW_ENV_FILE, override: true });
  const url = process.env.DATABASE_URL;
  if (!url) die(`${PREVIEW_ENV_FILE} has no DATABASE_URL.`);
  const host = dbHost(url);
  if (!host) die(`Couldn't read a host out of the DATABASE_URL in ${PREVIEW_ENV_FILE}.`);

  if (existsSync(".env.local")) {
    const realUrl = parseEnv(readFileSync(".env.local")).DATABASE_URL;
    if (realUrl && dbHost(realUrl) === host) {
      die(
        `The DATABASE_URL in ${PREVIEW_ENV_FILE} points at the same database as .env.local (${host}) -- that's your REAL database. Use the preview branch's connection string instead.`
      );
    }
  }

  const { db } = await import("../src/db");
  const schema = await import("../src/db/schema");
  const { count, getTableName, sql } = await import("drizzle-orm");

  console.log(`Target database host: ${host}`);
  console.log(commit ? "COMMIT mode -- this will write to that database." : "DRY RUN -- nothing will be written. Pass --commit to seed.");

  // What's in the target database right now?
  const existingTables = {
    school_years: schema.schoolYears,
    parents: schema.parents,
    students: schema.students,
    families: schema.families,
    donations: schema.donations,
    users: schema.users,
    fundraising_partners: schema.fundraisingPartners,
  };
  let existingTotal = 0;
  for (const [label, table] of Object.entries(existingTables)) {
    const [row] = await db.select({ n: count() }).from(table);
    const n = Number(row.n);
    existingTotal += n;
    if (n > 0) console.log(`  already in database: ${n} ${label}`);
  }
  if (existingTotal > 0) {
    if (!wipe) {
      const msg =
        "The database isn't empty. Seeding on top of existing data would mix real and fake records. If this really is the preview database, re-run with --wipe --confirm-host=" +
        host;
      if (commit) die(msg);
      console.log(`\nNOTE: ${msg}`);
    } else if (commit && confirmHost !== host) {
      die(`--wipe empties every app table. To confirm this is the right database, add --confirm-host=${host}`);
    }
  } else if (wipe) {
    console.log("(--wipe given, but the database is already empty -- nothing to clear.)");
  }

  // Build everything in memory.
  const testParentEmail = process.env.SEED_TEST_PARENT_EMAIL?.trim().toLowerCase() || null;
  const data = generate(seed, testParentEmail);
  const students = data.families.flatMap((f) => f.students);
  const parents = data.families.flatMap((f) => f.parents);
  const enrolled = students.filter((s) => s.gradeIndex >= 0 && s.gradeIndex <= 5);

  console.log(`\nSeed ${seed}: ${data.families.length} families, ${parents.length} parents, ${students.length} students (${enrolled.length} in K-5)`);
  console.log(`  ${data.classroomRows.length} classrooms across 2 school years, ${data.assignmentRows.length} classroom assignments`);
  console.log(`  ${data.donationRows.length} donations (${data.donationRows.length - Math.round(data.donationRows.length / (1 + CONFIG.unmatchedDonationShare))} from emails that match no parent)`);
  console.log(`  ${data.partners.length} fundraising partners, ${data.contacts.length} contacts, ${data.outreach.length} outreach entries, ${data.campaigns.length} campaigns`);
  if (testParentEmail) console.log(`  parent sign-in test account: ${testParentEmail}`);

  console.log(`\n${CONFIG.currentSchoolYearLabel} by grade (families with a child in that grade):`);
  console.log("  grade   students  families  donated  rate");
  GRADE_ORDER.forEach((grade, gi) => {
    const inGrade = data.families.filter((f) => f.students.some((s) => s.gradeIndex === gi));
    const donated = inGrade.filter((f) => data.donatingFamilyIds.has(f.id)).length;
    const kids = students.filter((s) => s.gradeIndex === gi).length;
    console.log(
      `  ${grade.padEnd(13)}${String(kids).padStart(3)}${String(inGrade.length).padStart(10)}${String(donated).padStart(9)}${(inGrade.length ? `${Math.round((100 * donated) / inGrade.length)}%` : "-").padStart(7)}`
    );
  });

  if (!commit) {
    console.log("\nDry run only. Re-run with --commit (plus --wipe --confirm-host=... if the database isn't empty).");
    return;
  }

  // Write.
  if (existingTotal > 0 && wipe) {
    const tables = [
      schema.fundraisingMonthlyActivity, schema.fundraisingCampaigns, schema.fundraisingOutreach,
      schema.fundraisingPartnerContacts, schema.fundraisingContacts, schema.fundraisingPartners,
      schema.donations, schema.studentClassrooms, schema.familyStudents, schema.familyParents,
      schema.parentStudents, schema.parentEmails, schema.families, schema.students, schema.parents,
      schema.classrooms, schema.schoolYears, schema.sessions, schema.accounts, schema.verificationTokens, schema.users,
    ];
    const list = tables.map((t) => `"${getTableName(t)}"`).join(", ");
    console.log("\nWiping every app table...");
    await db.execute(sql.raw(`TRUNCATE TABLE ${list} CASCADE`));
  }

  console.log("\nWriting seed data...");
  await db.insert(schema.schoolYears).values(data.years.map(({ id, label, sortYear }) => ({ id, label, sortYear })));
  await chunked(data.classroomRows, (c) =>
    db.insert(schema.classrooms).values(c.map(({ id, schoolYearId, grade, teacherName, abbreviation }) => ({ id, schoolYearId, grade, teacherName, abbreviation })))
  );
  await chunked(data.families, (c) => db.insert(schema.families).values(c.map((f) => ({ id: f.id, name: f.name }))));
  await chunked(parents, (c) =>
    db.insert(schema.parents).values(c.map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, email: p.emails[0].email })))
  );
  await chunked(
    parents.flatMap((p) => p.emails.map((e) => ({ parentId: p.id, email: e.email, isPrimary: e.isPrimary }))),
    (c) => db.insert(schema.parentEmails).values(c)
  );
  await chunked(students, (c) =>
    db.insert(schema.students).values(c.map((s) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName, cohortYear: s.cohortYear })))
  );
  await chunked(
    data.families.flatMap((f) => f.parents.map((p) => ({ familyId: f.id, parentId: p.id }))),
    (c) => db.insert(schema.familyParents).values(c)
  );
  await chunked(
    data.families.flatMap((f) => f.students.map((s) => ({ familyId: f.id, studentId: s.id }))),
    (c) => db.insert(schema.familyStudents).values(c)
  );
  // Every parent <-> every child in the family, same as scripts/sync-parent-students.ts.
  await chunked(
    data.families.flatMap((f) => f.parents.flatMap((p) => f.students.map((s) => ({ parentId: p.id, studentId: s.id })))),
    (c) => db.insert(schema.parentStudents).values(c)
  );
  await chunked(data.assignmentRows, (c) => db.insert(schema.studentClassrooms).values(c));
  await chunked(data.donationRows, (c) => db.insert(schema.donations).values(c));
  await chunked(data.partners, (c) => db.insert(schema.fundraisingPartners).values(c));
  await chunked(data.contacts, (c) => db.insert(schema.fundraisingContacts).values(c));
  await chunked(data.partnerContacts, (c) => db.insert(schema.fundraisingPartnerContacts).values(c));
  await chunked(data.outreach, (c) => db.insert(schema.fundraisingOutreach).values(c));
  await chunked(data.campaigns, (c) => db.insert(schema.fundraisingCampaigns).values(c));
  await chunked(data.monthlyActivity, (c) => db.insert(schema.fundraisingMonthlyActivity).values(c));

  console.log("Done.\n");
  console.log("Set these in the preview deployment's environment variables:");
  console.log(`  CURRENT_SCHOOL_YEAR_LABEL=${CONFIG.currentSchoolYearLabel}`);
  console.log(`  WIX_DONATION_CAMPAIGN_ID=${CONFIG.campaignId}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  pgEnum,
  primaryKey,
  unique,
  uniqueIndex,
  timestamp,
  date,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";

export const gradeEnum = pgEnum("grade", [
  "kindergarten",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.provider, table.providerAccountId] }),
  })
);

export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").notNull().primaryKey(),
  userId: uuid("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.identifier, table.token] }),
  })
);

export const schoolYears = pgTable("school_years", {
  id: uuid("id").defaultRandom().primaryKey(),
  label: text("label").notNull().unique(), // e.g. "2025-2026"
  sortYear: integer("sort_year").notNull().unique(), // e.g. 2026 — last 4 digits, for ordering
});

export const classrooms = pgTable(
  "classrooms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    schoolYearId: uuid("school_year_id")
      .notNull()
      .references(() => schoolYears.id, { onDelete: "restrict" }),
    grade: gradeEnum("grade").notNull(),
    teacherName: text("teacher_name").notNull(),
    abbreviation: text("abbreviation").notNull(), // no longer .unique() here
  },
  (table) => ({
    uniqueYearAbbreviation: unique().on(table.schoolYearId, table.abbreviation),
  })
);

// A household: the group of parents and students who are directly related
// to each other. Name is optional -- not every family has one on file, and
// participation counting shouldn't depend on it. A parent or student can
// belong to at most one family (see family_parents / family_students below,
// which mirror parent_students' join-table style even though today each
// side is effectively single-valued, in case a blended-family case ever
// needs more than one link).
export const families = pgTable("families", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
});

export const parents = pgTable("parents", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
});

// A parent can have more than one email on file (a personal address and a
// work address, say). parents.email stays the single "primary" email --
// the one everything that needs to resolve a parent to exactly one
// address still uses (donation matching, the family-import upsert) -- and
// is kept in sync with the row here where is_primary is true. Nothing
// reads secondary emails yet; this just gives us somewhere to put them.
export const parentEmails = pgTable(
  "parent_emails",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => parents.id, { onDelete: "cascade" }),
    email: text("email").notNull().unique(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    // At most one row per parent can be marked primary. (Zero is allowed --
    // e.g. transiently mid-edit -- but the app is expected to always keep
    // exactly one in sync with parents.email.)
    onePrimaryPerParent: uniqueIndex("one_primary_email_per_parent")
      .on(table.parentId)
      .where(sql`${table.isPrimary}`),
  })
);

export const students = pgTable("students", {
  id: uuid("id").defaultRandom().primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  // The calendar year of the summer this student is expected to finish
  // fifth grade (e.g. a student finishing 5th grade in June 2031 is
  // cohort 2031). Nullable so existing students aren't blocked/broken;
  // set going forward via the Add/Edit Student forms.
  cohortYear: integer("cohort_year"),
});

export const parentStudents = pgTable(
  "parent_students",
  {
    parentId: uuid("parent_id")
      .notNull()
      .references(() => parents.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.parentId, table.studentId] }),
  })
);

export const familyParents = pgTable(
  "family_parents",
  {
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => parents.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.familyId, table.parentId] }),
  })
);

export const familyStudents = pgTable(
  "family_students",
  {
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.familyId, table.studentId] }),
  })
);

export const studentClassrooms = pgTable(
  "student_classrooms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    classroomId: uuid("classroom_id")
      .notNull()
      .references(() => classrooms.id, { onDelete: "restrict" }),
    schoolYearId: uuid("school_year_id")
      .notNull()
      .references(() => schoolYears.id, { onDelete: "restrict" }),
  },
  (table) => ({
    uniqueStudentYear: unique().on(table.studentId, table.schoolYearId),
  })
);

export const fundraisingStatusEnum = pgEnum("fundraising_status", [
  "prospective",
  "contacted",
  "active",
  "inactive",
]);

// A business (or program) the PTO partners with. People live in
// fundraising_contacts and are linked through fundraising_partner_contacts,
// so one person can be the contact for several businesses and a business
// can have several contacts over time.
export const fundraisingPartners = pgTable("fundraising_partners", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  status: fundraisingStatusEnum("status").notNull().default("prospective"),
  website: text("website"),
  notes: text("notes"), // durable notes about the relationship
  ptoOwner: text("pto_owner"), // who on the PTO side owns this relationship, plain text
  followUpBy: date("follow_up_by"), // next follow-up due; the directory flags it when overdue
});

// A person at a partner business. Independent of any one partner -- see
// fundraising_partner_contacts for the many-to-many link. Email is stored
// lowercased and is unique when present (it's how the import dedupes people).
export const fundraisingContacts = pgTable(
  "fundraising_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueEmail: uniqueIndex("fundraising_contacts_email_unique")
      .on(table.email)
      .where(sql`${table.email} is not null`),
  })
);

// Many-to-many: which people are contacts for which partners. Role,
// primary and current live here, not on the person, because the same
// person can be the current owner at one business and a former contact
// at another.
export const fundraisingPartnerContacts = pgTable(
  "fundraising_partner_contacts",
  {
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => fundraisingPartners.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => fundraisingContacts.id, { onDelete: "cascade" }),
    role: text("role"), // free text: "owner", "event coordinator", "manager"...
    isPrimary: boolean("is_primary").notNull().default(false),
    isCurrent: boolean("is_current").notNull().default(true), // false = former contact, kept for history
  },
  (table) => ({
    pk: primaryKey({ columns: [table.partnerId, table.contactId] }),
    onePrimaryPerPartner: uniqueIndex("one_primary_contact_per_partner")
      .on(table.partnerId)
      .where(sql`${table.isPrimary}`),
  })
);

// Dated log of outreach to a partner ("sent email", "met the manager").
// contactId is optional -- plenty of outreach isn't to a specific person.
// date is nullable only so undated comments from the old spreadsheet can be
// imported as-is; the app always sets one.
export const fundraisingOutreach = pgTable("fundraising_outreach", {
  id: uuid("id").defaultRandom().primaryKey(),
  partnerId: uuid("partner_id")
    .notNull()
    .references(() => fundraisingPartners.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => fundraisingContacts.id, { onDelete: "set null" }),
  date: date("date"),
  ptoMember: text("pto_member"), // who on the PTO side, plain text
  note: text("note").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const fundraisingCampaigns = pgTable(
  "fundraising_campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => fundraisingPartners.id, { onDelete: "cascade" }),
    schoolYearId: uuid("school_year_id")
      .notNull()
      .references(() => schoolYears.id, { onDelete: "restrict" }),
    percentBackBasisPoints: integer("percent_back_basis_points"), // 10% -> 1000
    amountReceivedCents: integer("amount_received_cents").notNull().default(0),
    amountLoggedMonth: integer("amount_logged_month"), // 1-12, which month the annual total counts toward in the summary
    comments: text("comments"),
  },
  (table) => ({
    uniquePartnerYear: unique().on(table.partnerId, table.schoolYearId),
  })
);

export const fundraisingMonthlyActivity = pgTable(
  "fundraising_monthly_activity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => fundraisingCampaigns.id, { onDelete: "cascade" }),
    month: integer("month").notNull(), // 1-12
    note: text("note"),
  },
  (table) => ({
    uniqueCampaignMonth: unique().on(table.campaignId, table.month),
  })
);


export const donations = pgTable(
  "donations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    wixOrderId: text("wix_order_id").notNull().unique(),
    wixOrderNumber: text("wix_order_number"),
    donorEmail: text("donor_email").notNull(),
    amountCents: integer("amount_cents").notNull(),
    wixCampaignId: text("wix_campaign_id").notNull(),
    schoolYearId: uuid("school_year_id")
      .notNull()
      .references(() => schoolYears.id, { onDelete: "restrict" }),
    orderCreatedAt: timestamp("order_created_at", { withTimezone: true }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueDonorCampaign: unique().on(table.donorEmail, table.wixCampaignId),
  })
);

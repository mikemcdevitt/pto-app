import {
  pgTable,
  uuid,
  text,
  integer,
  pgEnum,
  primaryKey,
  unique,
  timestamp,
} from "drizzle-orm/pg-core";
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

export const fundraisingPartners = pgTable("fundraising_partners", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  status: fundraisingStatusEnum("status").notNull().default("prospective"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  website: text("website"),
  notes: text("notes"),
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

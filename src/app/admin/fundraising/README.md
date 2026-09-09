# Fundraising Tracker

Admin route for tracking PTO fundraising partners (restaurants, retailers, service
businesses that give back a percentage of sales) — contact cards for each partner, plus
monthly/annual summaries of what's active and how much has come in.

Source data: `Sprague Fundraising Partners.xlsx`, one sheet per school year (`2526`,
`2425`, ...), which is why the data model below keys everything off the existing
`schoolYears` table the same way `classrooms` and `studentClassrooms` already do.

## What the spreadsheet actually contains

Each year-sheet is a flat table, one row per vendor:

| Column | Contents |
|---|---|
| A | Alphabetical group letter (e.g. `F`, `I-K`) — just a manual sort aid, not data worth storing |
| B (`Vendor`) | Partner name |
| C–L (`SEP`...`JUN`) | Per-month cell, inconsistently used as: a date (when a fundraiser ran or was requested), free text (`"up and running"`, `"ongoing till we quit it"`, `"--"`), or blank |
| M (`% Back`) | Commission rate as a decimal (e.g. `0.1` = 10%) |
| N (`Amount received`) | **One lump sum for the whole year** — not broken out by month |
| O (`Comments`) | Free-text status/contact notes, e.g. `"Nov. 13 - Julie Amrose is new Contact"`, embedded emails, links |

Below the vendor rows each sheet also has a `TO EXPLORE` / `Notes` section — prospective
partners that were never formally onboarded (no contact yet, just an idea and who should
reach out). Those are real data worth keeping, just at a different lifecycle stage.

**Gap in the source data:** the sheet has no per-month dollar amount, only a per-month
*status/date* and one annual total.

## Decisions

- **Monthly $ granularity**: keep one annual total per partner per year, matching how the
  sheet is actually filled in — don't add per-month dollar entry. The monthly summary
  therefore shows which partners were **active** each month (from the per-month
  status/date), with the annual total attributed to whichever month it's logged against
  (see `amountLoggedMonth` below), rather than a true month-by-month revenue split.
- **`% Back` storage**: integer basis points (`1000` = 10%), consistent with the rest of
  the schema avoiding floats for anything numeric that matters.
- **Import status**: infer each partner's status from activity rather than defaulting
  everything to `prospective` — `active` if the year's row has an amount received or any
  month with a date/status, `inactive` if the partner has a campaign row for a past year
  but no activity in the current one, `prospective` only for genuine `TO EXPLORE` rows
  that were never actually contacted.

## Data model

Add to [src/db/schema.ts](../../../db/schema.ts):

```ts
export const fundraisingStatusEnum = pgEnum("fundraising_status", [
  "prospective", // idea only, e.g. "TO EXPLORE" rows — no contact made yet
  "contacted",   // outreach sent, awaiting response
  "active",      // currently running / rolled out
  "inactive",    // ran before, not currently active
]);

// The contact-card directory. One row per business, independent of school year.
export const fundraisingPartners = pgTable("fundraising_partners", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  status: fundraisingStatusEnum("status").notNull().default("prospective"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  website: text("website"),
  notes: text("notes"), // durable notes about the relationship, not month-specific
});

// One row per partner per school year — the "% Back" / annual total from the sheet.
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
    amountReceivedCents: integer("amount_received_cents").notNull().default(0), // one annual total, per Decisions above
    amountLoggedMonth: integer("amount_logged_month"), // 1-12, nullable — which month the annual total counts toward in the monthly summary
    comments: text("comments"),
  },
  (table) => ({
    uniquePartnerYear: unique().on(table.partnerId, table.schoolYearId),
  })
);

// One row per campaign per month — just the status/date that used to live in the
// month cell (e.g. "up and running", a specific date). No dollar amount here; see Decisions.
export const fundraisingMonthlyActivity = pgTable(
  "fundraising_monthly_activity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => fundraisingCampaigns.id, { onDelete: "cascade" }),
    month: integer("month").notNull(), // 1-12
    note: text("note"), // free-text status or date-derived note, e.g. "up and running", "requested 11/13"
  },
  (table) => ({
    uniqueCampaignMonth: unique().on(table.campaignId, table.month),
  })
);
```

Money and the commission rate are stored as integers (cents, basis points) rather than
floats — nothing else in the current schema stores money, so this is a new convention to
establish here, but it matches the codebase's general avoidance of floats for anything
that gets summed.

## Routes

Following the existing admin CRUD pattern ([parents](../parents), [classrooms](../classrooms)):

```
src/app/admin/fundraising/
  page.tsx                    # partner directory as contact cards, filter by status/year
  FundraisingPartnerForm.tsx  # client form, mirrors ParentForm.tsx (fetch to /api, router.refresh)
  new/page.tsx                # create a partner (status defaults to "prospective")
  [id]/page.tsx                # partner detail: edit contact info + this year's campaign
                               #   (percent back, annual total, monthly status grid)
  summary/page.tsx            # monthly/annual summary report, year-filterable like
                               #   classrooms/YearFilter.tsx

src/app/api/fundraising/
  partners/route.ts           # GET (list), POST (create)
  partners/[id]/route.ts      # GET, PATCH, DELETE
  campaigns/[id]/route.ts     # PATCH campaign (percentBackBasisPoints, amountReceivedCents, amountLoggedMonth, comments)
  campaigns/[id]/activity/route.ts  # PATCH monthly status note for a campaign+month
```

Add a nav link in [layout.tsx](../layout.tsx) alongside Classrooms/Parents/Students.
`requireAdmin()` gating stays the same as every other admin route.

### Partner directory (`page.tsx`)

Contact cards, not a table — one card per partner showing name, status badge, contact
info, website, and (when a school year is selected) that year's `% Back` and running
total. Reuse the `YearFilter` component's pattern for a school-year selector, defaulting
to the most recent year like `classrooms/page.tsx` does.

### Summary (`summary/page.tsx`)

For the selected school year: total raised (sum of `amountReceivedCents` across
campaigns), count of active partners, and a month-by-month grid (`SEP`...`JUN` columns,
same order as the sheet) showing which partners had activity that month, pulled from
`fundraisingMonthlyActivity`. Each partner's annual total appears once, under whichever
month its `amountLoggedMonth` points to — this is an approximation of "amount raised per
month," not a precise one, per the [Decisions](#decisions) above.

## Importing the existing spreadsheet

One-time script (not a route) to seed from `Sprague Fundraising Partners.xlsx`, following
the shape of [src/db/seed.ts](../../../db/seed.ts):

1. One `fundraisingPartners` row per unique vendor name across **both** sheets (`2526`,
   `2425`) — de-dupe by name (watch for near-duplicates like `"Ski & Tennis"` vs.
   `"Boston Ski & Tennis"`, `"Timesaving Auto Det"` vs. `"Timesaving Auto Detailing"`).
2. One `fundraisingCampaigns` row per (partner, sheet-year) pair that has any data,
   mapping sheet `2526` → school year `2025-2026`, `2425` → `2024-2025`.
3. `Amount received` → `fundraisingCampaigns.amountReceivedCents` directly (dollars × 100).
   `amountLoggedMonth` can be left null on import (the sheet doesn't say which month the
   money landed) — set it later by hand for reporting if it matters, or default it to the
   last month with recorded activity for that partner.
4. `% Back` → `percentBackBasisPoints` (decimal × 10000, e.g. `0.1` → `1000`).
5. Per-month cells that are dates or status text → one `fundraisingMonthlyActivity` row
   per non-blank cell, `note` holding the date (formatted) or the text verbatim
   (`"up and running"`, `"--"`, `"ongoing till we quit it"`).
6. Rows under `TO EXPLORE` → `fundraisingPartners` with `status: "prospective"` and no
   campaign row at all (they were never actually run).
7. Spot-check the `2425` sheet's `TOTAL` row (`$2,523.34`) against the sum of imported
   `amountReceivedCents` for that year as a sanity check on the import script.

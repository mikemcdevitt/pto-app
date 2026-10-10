# Fundraising Partners

Admin area for the PTO's fundraising partners -- restaurants, retailers and services that
give back a share of sales or donate gift cards -- replacing `Sprague Fundraising
Partners.xlsx`.

**Phase 1 (built): contacts.** Who the businesses are, who we talk to there, who on the
PTO owns each relationship, and a dated outreach log with follow-up reminders.

**Phase 2 (deferred): money.** Per-year % back and amounts received. The tables for it
(`fundraising_campaigns`, `fundraising_monthly_activity`) exist from the earlier design
but nothing reads or writes them yet -- see [Phase 2](#phase-2-money-tracking-deferred).

## Access

| Who | Gets |
|---|---|
| `ADMIN_EMAILS` | everything, including fundraising |
| `FUNDRAISING_EMAILS` (e.g. `fundraising@spragueschoolpto.com`) | `/admin/fundraising/**` and `/api/fundraising/**` only -- no family/student data |

Both lists live in [src/lib/access-lists.ts](../../../lib/access-lists.ts), shared by
`src/proxy.ts` and `requireFundraising()` / `requireFundraisingPage()` in
`src/lib/require-admin.ts`. A fundraising-only login lands on `/admin/fundraising` after
sign-in (and from `/admin`), and the nav shows only the Fundraising link.

## Data model

```
fundraising_partners          one row per business
  name, status, website, notes
  pto_owner      text -- who on the PTO side handles it (a volunteer's first name)
  follow_up_by   date -- next follow-up due; directory flags it when today or past

fundraising_contacts          one row per person, independent of any business
  name, email (lowercased, unique when present), phone, notes

fundraising_partner_contacts  many-to-many link
  partner_id + contact_id (PK)
  role         free text: "owner", "event coordinator"...
  is_primary   at most one per partner (partial unique index)
  is_current   false = former contact, kept for history

fundraising_outreach          dated log per partner
  partner_id, contact_id (optional, set null if the person is deleted)
  date (nullable only for undated imported comments), pto_member, note
```

Role / primary / current live on the link, not the person, because one person can be the
current contact at one business and a former one at another (the spreadsheet already
has one instructor who is the contact for two different partners).

Status values: `prospective` (idea, no contact yet), `contacted` (outreach made, nothing
running), `active` (running now), `inactive` (ran before, or declined).

Migrations: `drizzle/0002_fundraising_contacts.sql` (new tables; drops the old
`contact_name/email/phone` columns from partners) and
`drizzle/0003_partner_owner_follow_up.sql`.

## Behavior worth knowing

- **Primary swaps are atomic.** Making someone primary clears the old primary in the same
  `db.batch()` (a transaction on neon-http), so the one-primary index never trips.
- **Marking someone former drops primary**; making a former contact primary makes them
  current again.
- **Logging outreach** on a `prospective` partner moves it to `contacted`, and the form's
  "Next follow-up" field replaces the partner's follow-up date.
- **Removing** a person from a partner only unlinks them. **Deleting** a person removes
  all their links; outreach entries keep the note and lose the link.
- **Deleting a partner** deletes its links and outreach log (people stay). The confirm
  dialog suggests Inactive instead when the history matters.
- Adding a "new person" whose email already exists is refused with the existing
  person's name, so people get reused rather than duplicated.

## Routes

```
src/app/admin/fundraising/
  page.tsx                 directory: contact cards, status/"Follow-up due" tabs, search
  new/page.tsx             add partner -> redirects to its page to add contacts
  [id]/page.tsx            details form + contacts panel + outreach log
  contacts/page.tsx        everyone, with the businesses they're linked to
  contacts/new, [id]       add / edit a person

src/app/api/fundraising/
  partners                 GET, POST
  partners/[id]            GET (with contacts + outreach), PATCH, DELETE
  partners/[id]/contacts   POST link existing ({contactId}) or new ({newContact})
  partners/[id]/contacts/[contactId]   PATCH role/isPrimary/isCurrent, DELETE (unlink)
  partners/[id]/outreach   POST
  outreach/[id]            DELETE
  contacts, contacts/[id]  GET/POST, GET/PATCH/DELETE
```

## Importing the spreadsheet (one time)

Two steps, same look-before-you-leap pattern as the family import. The hand-curated
merges, people and outreach notes live in `exclude/fundraising-curation.json`
(gitignored -- real names and contact details), not in the script.

```bash
# 1. Stage: reads the .xlsx, writes a review JSON + a readable .md table. No DB access.
python3 scripts/stage-fundraising-contacts.py "exclude/Sprague Fundraising Partners.xlsx" -o exclude/fundraising-staged

# 2. Review exclude/fundraising-staged.md, edit the .json if needed, then:
npx tsx scripts/import-fundraising-contacts.ts exclude/fundraising-staged.json            # dry run
npx tsx scripts/import-fundraising-contacts.ts exclude/fundraising-staged.json --commit   # write
```

The import validates the file first, refuses to run if `fundraising_partners` already has
rows, and inserts everything in one batch (all or nothing).

What staging does with the sheet (curation lives at the top of the .py):

- **Merges near-duplicate business names** (e.g. "Great Wok" -> "The Great Wok", and
  rows where a contact's name was typed into the business name).
- **Status is judged against 2025-26** (the newest sheet): activity logged in 2025-26 ->
  active; ran in 2024-25 only -> inactive; outreach but never ran -> contacted; listed or
  "TO EXPLORE" businesses never contacted -> prospective. Hand overrides for declines,
  bankruptcy, outreach-only rows.
- **Pulls people out of the comment text** into contacts linked to their businesses.
  Several are first-name only, as in the sheet.
- **Turns comments into outreach entries**, dated where the comment gives an unambiguous
  date, prefixed with the sheet year (`[2024-25 sheet] ...`) so undated ones keep context.
- **Leaves out event ideas** (Principal for a Day, Tat the Teacher, Turkey-Athon, ...) --
  they aren't businesses. Listed in the review file for reference.
- **Ignores money**: % back, amounts, per-month dollar cells.

Review flags in the staged file: two 2024-25 partners that may be the same event entered
twice; passive programs (Box Tops, Shutterfly, ...) marked inactive only because 2025-26
is blank.

## Phase 2: money tracking (deferred)

Kept from the original design for when this picks back up:

- One row per partner per school year in `fundraising_campaigns` (`percent_back_basis_points`,
  `amount_received_cents`, `amount_logged_month`), monthly status notes in
  `fundraising_monthly_activity`. Money as integer cents, rates as basis points.
- Open questions from the spreadsheet review:
  1. Some month cells hold dollar amounts that add up to the annual total. Add an
     optional `amount_cents` to monthly activity, or stay annual-only?
  2. Do gift cards count toward totals or get tracked as in-kind?
  3. The 2024-25 total ($2,523.34 per the sheet) may double-count one $260 event.
- Sheet quirks the money import will need to handle: wrong years typed into dates (go by
  the column, not the cell's year), progress notes in columns P/Q/S.

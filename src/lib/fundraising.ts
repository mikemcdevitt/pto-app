// Shared bits for the fundraising contacts pages and API routes.

export const FUNDRAISING_STATUSES = ["prospective", "contacted", "active", "inactive"] as const;
export type FundraisingStatus = (typeof FUNDRAISING_STATUSES)[number];

export const STATUS_LABELS: Record<FundraisingStatus, string> = {
  prospective: "Prospective",
  contacted: "Contacted",
  active: "Active",
  inactive: "Inactive",
};

export const STATUS_BADGE_CLASSES: Record<FundraisingStatus, string> = {
  prospective: "bg-gray-100 text-gray-700",
  contacted: "bg-amber-100 text-amber-800",
  active: "bg-green-100 text-green-800",
  inactive: "bg-slate-200 text-slate-600",
};

export function isStatus(value: unknown): value is FundraisingStatus {
  return typeof value === "string" && (FUNDRAISING_STATUSES as readonly string[]).includes(value);
}

// Trimmed string, or null for missing/blank. Non-strings become null.
export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t === "" ? null : t;
}

export function cleanEmail(value: unknown): string | null {
  const t = cleanText(value);
  return t ? t.toLowerCase() : null;
}

// "YYYY-MM-DD" (what <input type="date"> sends), or null. Anything else is
// rejected by returning undefined so callers can 400.
export function cleanDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(value + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? undefined : value;
}

// Postgres unique_violation. Drizzle sometimes wraps the driver error, so
// check the cause too.
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

// Today's date in the PTO's timezone as YYYY-MM-DD, for "is this follow-up
// overdue" checks and as the default outreach date.
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function formatDate(value: string | null): string {
  if (!value) return "";
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Accepts "example.com" as well as full URLs, for display links.
export function websiteHref(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

// ---- Request body parsing ---------------------------------------------

type Parsed<T> = { ok: true; values: T } | { ok: false; error: string };

export interface PartnerValues {
  name: string;
  status: FundraisingStatus;
  website: string | null;
  notes: string | null;
  ptoOwner: string | null;
  followUpBy: string | null;
}

export function parsePartnerBody(body: Record<string, unknown>): Parsed<PartnerValues> {
  const name = cleanText(body.name);
  if (!name) return { ok: false, error: "Name is required." };
  const status = body.status ?? "prospective";
  if (!isStatus(status)) return { ok: false, error: "Unknown status." };
  const followUpBy = cleanDate(body.followUpBy);
  if (followUpBy === undefined) return { ok: false, error: "Follow-up date isn't a valid date." };
  return {
    ok: true,
    values: {
      name,
      status,
      website: cleanText(body.website),
      notes: cleanText(body.notes),
      ptoOwner: cleanText(body.ptoOwner),
      followUpBy,
    },
  };
}

export interface ContactValues {
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export function parseContactBody(body: Record<string, unknown>): Parsed<ContactValues> {
  const name = cleanText(body.name);
  if (!name) return { ok: false, error: "Contact name is required." };
  const email = cleanEmail(body.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "That email doesn't look right." };
  }
  return {
    ok: true,
    values: { name, email, phone: cleanText(body.phone), notes: cleanText(body.notes) },
  };
}

CREATE TABLE "parent_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"email" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "parent_emails_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "parent_emails" ADD CONSTRAINT "parent_emails_parent_id_parents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "one_primary_email_per_parent" ON "parent_emails" USING btree ("parent_id") WHERE "parent_emails"."is_primary";
--> statement-breakpoint
-- Backfill: every existing parent's current email becomes their primary
-- email in the new table. parents.email itself is untouched -- it stays
-- the source of truth for "primary" unless/until the app starts writing
-- through parent_emails instead.
INSERT INTO "parent_emails" ("parent_id", "email", "is_primary")
SELECT "id", "email", true FROM "parents";

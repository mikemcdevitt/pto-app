CREATE TABLE "fundraising_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fundraising_outreach" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"contact_id" uuid,
	"date" date,
	"pto_member" text,
	"note" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fundraising_partner_contacts" (
	"partner_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	CONSTRAINT "fundraising_partner_contacts_partner_id_contact_id_pk" PRIMARY KEY("partner_id","contact_id")
);
--> statement-breakpoint
ALTER TABLE "fundraising_outreach" ADD CONSTRAINT "fundraising_outreach_partner_id_fundraising_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."fundraising_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraising_outreach" ADD CONSTRAINT "fundraising_outreach_contact_id_fundraising_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."fundraising_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraising_partner_contacts" ADD CONSTRAINT "fundraising_partner_contacts_partner_id_fundraising_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."fundraising_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraising_partner_contacts" ADD CONSTRAINT "fundraising_partner_contacts_contact_id_fundraising_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."fundraising_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fundraising_contacts_email_unique" ON "fundraising_contacts" USING btree ("email") WHERE "fundraising_contacts"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "one_primary_contact_per_partner" ON "fundraising_partner_contacts" USING btree ("partner_id") WHERE "fundraising_partner_contacts"."is_primary";--> statement-breakpoint
ALTER TABLE "fundraising_partners" DROP COLUMN "contact_name";--> statement-breakpoint
ALTER TABLE "fundraising_partners" DROP COLUMN "contact_email";--> statement-breakpoint
ALTER TABLE "fundraising_partners" DROP COLUMN "contact_phone";
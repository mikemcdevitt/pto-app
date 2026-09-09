CREATE TYPE "public"."fundraising_status" AS ENUM('prospective', 'contacted', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."grade" AS ENUM('kindergarten', 'first', 'second', 'third', 'fourth', 'fifth');--> statement-breakpoint
CREATE TABLE "classrooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_year_id" uuid NOT NULL,
	"grade" "grade" NOT NULL,
	"teacher_name" text NOT NULL,
	"abbreviation" text NOT NULL,
	CONSTRAINT "classrooms_school_year_id_abbreviation_unique" UNIQUE("school_year_id","abbreviation")
);
--> statement-breakpoint
CREATE TABLE "fundraising_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"school_year_id" uuid NOT NULL,
	"percent_back_basis_points" integer,
	"amount_received_cents" integer DEFAULT 0 NOT NULL,
	"amount_logged_month" integer,
	"comments" text,
	CONSTRAINT "fundraising_campaigns_partner_id_school_year_id_unique" UNIQUE("partner_id","school_year_id")
);
--> statement-breakpoint
CREATE TABLE "fundraising_monthly_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"month" integer NOT NULL,
	"note" text,
	CONSTRAINT "fundraising_monthly_activity_campaign_id_month_unique" UNIQUE("campaign_id","month")
);
--> statement-breakpoint
CREATE TABLE "fundraising_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "fundraising_status" DEFAULT 'prospective' NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"website" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "parent_students" (
	"parent_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	CONSTRAINT "parent_students_parent_id_student_id_pk" PRIMARY KEY("parent_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "parents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	CONSTRAINT "parents_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "school_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"sort_year" integer NOT NULL,
	CONSTRAINT "school_years_label_unique" UNIQUE("label"),
	CONSTRAINT "school_years_sort_year_unique" UNIQUE("sort_year")
);
--> statement-breakpoint
CREATE TABLE "student_classrooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"classroom_id" uuid NOT NULL,
	"school_year_id" uuid NOT NULL,
	CONSTRAINT "student_classrooms_student_id_school_year_id_unique" UNIQUE("student_id","school_year_id")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraising_campaigns" ADD CONSTRAINT "fundraising_campaigns_partner_id_fundraising_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."fundraising_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraising_campaigns" ADD CONSTRAINT "fundraising_campaigns_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraising_monthly_activity" ADD CONSTRAINT "fundraising_monthly_activity_campaign_id_fundraising_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."fundraising_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_students" ADD CONSTRAINT "parent_students_parent_id_parents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_students" ADD CONSTRAINT "parent_students_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_classrooms" ADD CONSTRAINT "student_classrooms_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_classrooms" ADD CONSTRAINT "student_classrooms_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_classrooms" ADD CONSTRAINT "student_classrooms_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE restrict ON UPDATE no action;
CREATE TYPE "public"."grade" AS ENUM('kindergarten', 'first', 'second', 'third', 'fourth', 'fifth');--> statement-breakpoint
CREATE TABLE "classrooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grade" "grade" NOT NULL,
	"teacher_name" text NOT NULL,
	"abbreviation" text NOT NULL,
	CONSTRAINT "classrooms_abbreviation_unique" UNIQUE("abbreviation")
);

import {
  pgTable,
  uuid,
  text,
  integer,
  pgEnum,
  primaryKey,
  unique,
} from "drizzle-orm/pg-core";

export const gradeEnum = pgEnum("grade", [
  "kindergarten",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
]);

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
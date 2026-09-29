/**
 * Finds parents and students that ARE associated with each other (via
 * parent_students) but have no `families` linkage at all -- typically
 * from the Add/Edit Parent admin flow, which links parent_students but
 * never touches family_parents/family_students -- and sets up (or
 * extends) a family for each such group.
 *
 * Groups members into households by following parent_students edges
 * transitively (a union-find over every parent/student, not just the
 * orphaned ones, so an orphan linked to an already-familied person joins
 * that person's group correctly instead of being treated as its own
 * island). For each group that contains at least one orphan:
 *   - if none of its members belong to any existing family, creates a
 *     new family and links every parent/student in the group to it.
 *   - if exactly one existing family already covers part of the group
 *     (e.g. a new student added to a parent who already has a family),
 *     extends THAT family with the missing members instead of creating
 *     a duplicate.
 *   - if members of the group already belong to two or more DIFFERENT
 *     existing families, that's a conflict -- left alone and reported,
 *     not guessed at.
 *
 * A parent or student with no parent_students link at all can't be
 * grouped automatically (nothing says who they belong with) -- these are
 * listed separately so you can link them by hand via the admin pages.
 *
 * Defaults to DRY RUN -- prints what it would do without touching the
 * database. Pass --commit to actually write.
 *
 * Usage:
 *   npx tsx scripts/link-orphan-families.ts            # dry run
 *   npx tsx scripts/link-orphan-families.ts --commit    # actually writes
 */

import { config } from "dotenv";
config({ path: ".env.local" });

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const pNode = (id: string) => `p:${id}`;
const sNode = (id: string) => `s:${id}`;

async function main() {
  const { db } = await import("../src/db");
  const { parents, students, parentStudents, families, familyParents, familyStudents } = await import(
    "../src/db/schema"
  );

  const commit = process.argv.includes("--commit");

  const allParents = await db.select().from(parents);
  const allStudents = await db.select().from(students);
  const allParentStudents = await db.select().from(parentStudents);
  const allFamilyParents = await db.select().from(familyParents);
  const allFamilyStudents = await db.select().from(familyStudents);

  console.log(
    commit
      ? "COMMIT mode -- this will write to the real database."
      : "DRY RUN -- no writes will happen. Pass --commit to actually write."
  );

  const parentHasFamily = new Set(allFamilyParents.map((l) => l.parentId));
  const studentHasFamily = new Set(allFamilyStudents.map((l) => l.studentId));

  const orphanParents = allParents.filter((p) => !parentHasFamily.has(p.id));
  const orphanStudents = allStudents.filter((s) => !studentHasFamily.has(s.id));

  console.log(
    `${allParents.length} parents (${orphanParents.length} without a family), ` +
      `${allStudents.length} students (${orphanStudents.length} without a family).`
  );

  if (orphanParents.length === 0 && orphanStudents.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const uf = new UnionFind();
  const allNodes: string[] = [];
  for (const p of allParents) {
    const n = pNode(p.id);
    uf.find(n);
    allNodes.push(n);
  }
  for (const s of allStudents) {
    const n = sNode(s.id);
    uf.find(n);
    allNodes.push(n);
  }
  for (const l of allParentStudents) uf.union(pNode(l.parentId), sNode(l.studentId));

  const familyByParentNode = new Map(allFamilyParents.map((l) => [pNode(l.parentId), l.familyId]));
  const familyByStudentNode = new Map(allFamilyStudents.map((l) => [sNode(l.studentId), l.familyId]));

  const orphanNodeSet = new Set([...orphanParents.map((p) => pNode(p.id)), ...orphanStudents.map((s) => sNode(s.id))]);

  const nodesByRoot = new Map<string, string[]>();
  for (const n of allNodes) {
    const root = uf.find(n);
    nodesByRoot.set(root, [...(nodesByRoot.get(root) ?? []), n]);
  }

  const parentById = new Map(allParents.map((p) => [p.id, p]));
  const studentById = new Map(allStudents.map((s) => [s.id, s]));

  let created = 0;
  let extended = 0;
  let conflicts = 0;
  const isolated: string[] = [];

  for (const [, allNodesInComponent] of nodesByRoot) {
    const hasOrphan = allNodesInComponent.some((n) => orphanNodeSet.has(n));
    if (!hasOrphan) continue;

    const parentNodes = allNodesInComponent.filter((n) => n.startsWith("p:"));
    const studentNodes = allNodesInComponent.filter((n) => n.startsWith("s:"));

    if (parentNodes.length + studentNodes.length <= 1) {
      for (const n of allNodesInComponent) if (orphanNodeSet.has(n)) isolated.push(n);
      continue;
    }

    const existingFamilyIds = new Set<string>();
    for (const n of parentNodes) {
      const f = familyByParentNode.get(n);
      if (f) existingFamilyIds.add(f);
    }
    for (const n of studentNodes) {
      const f = familyByStudentNode.get(n);
      if (f) existingFamilyIds.add(f);
    }

    const parentIds = parentNodes.map((n) => n.slice(2));
    const studentIds = studentNodes.map((n) => n.slice(2));
    const parentNames = parentIds.map((id) => {
      const p = parentById.get(id)!;
      return `${p.firstName} ${p.lastName} <${p.email}>`;
    });
    const studentNames = studentIds.map((id) => `${studentById.get(id)!.firstName} ${studentById.get(id)!.lastName}`);

    console.log(`\n=== group: parents=[${parentNames.join("; ")}]  students=[${studentNames.join("; ")}] ===`);

    if (existingFamilyIds.size > 1) {
      console.log(
        `  CONFLICT: members already split across ${existingFamilyIds.size} different families [${[...existingFamilyIds].join(", ")}] -- skipping, resolve by hand.`
      );
      conflicts++;
      continue;
    }

    let targetFamilyId: string;
    if (existingFamilyIds.size === 1) {
      targetFamilyId = [...existingFamilyIds][0];
      console.log(`  extend existing family ${targetFamilyId}`);
      extended++;
    } else {
      const lastNames = new Set(parentIds.map((id) => parentById.get(id)!.lastName));
      const suggestedName = lastNames.size === 1 ? `${[...lastNames][0]} Family` : null;
      console.log(`  create new family (name: ${suggestedName ?? "none"})`);
      if (commit) {
        const [newFamily] = await db.insert(families).values({ name: suggestedName }).returning();
        targetFamilyId = newFamily.id;
      } else {
        targetFamilyId = "(dry-run: new family)";
      }
      created++;
    }

    const missingParents = parentIds.filter((id) => !familyByParentNode.has(pNode(id)));
    const missingStudents = studentIds.filter((id) => !familyByStudentNode.has(sNode(id)));
    for (const id of missingParents) console.log(`  link parent ${id} -> family ${targetFamilyId}`);
    for (const id of missingStudents) console.log(`  link student ${id} -> family ${targetFamilyId}`);

    if (commit) {
      if (missingParents.length > 0) {
        await db.insert(familyParents).values(missingParents.map((parentId) => ({ familyId: targetFamilyId, parentId })));
      }
      if (missingStudents.length > 0) {
        await db.insert(familyStudents).values(missingStudents.map((studentId) => ({ familyId: targetFamilyId, studentId })));
      }
    }
  }

  console.log(`\n${commit ? "Created" : "Would create"} ${created} new famil${created === 1 ? "y" : "ies"}.`);
  console.log(
    `${commit ? "Extended" : "Would extend"} ${extended} existing famil${extended === 1 ? "y" : "ies"} with missing member(s).`
  );
  console.log(`Skipped ${conflicts} group(s) with a conflict -- resolve by hand and re-run.`);
  if (isolated.length > 0) {
    console.log(`\n${isolated.length} orphan(s) have no parent_students link at all -- can't be grouped automatically:`);
    for (const n of isolated) {
      if (n.startsWith("p:")) {
        const p = parentById.get(n.slice(2))!;
        console.log(`  parent: ${p.firstName} ${p.lastName} <${p.email}> (${p.id})`);
      } else {
        const s = studentById.get(n.slice(2))!;
        console.log(`  student: ${s.firstName} ${s.lastName} (${s.id})`);
      }
    }
    console.log("These need a parent<->student link created first (Edit Parent admin page), then re-run this script.");
  }
}

main();

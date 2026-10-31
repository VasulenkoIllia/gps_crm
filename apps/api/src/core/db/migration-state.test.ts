import { describe, expect, it } from "vitest";
import { findMigrationProblem, type MigrationRow } from "./migration-state.js";

const applied = (name: string): MigrationRow => ({ name, isFinished: true, isRolledBack: false });

describe("findMigrationProblem", () => {
  it("finds nothing when every expected migration is applied", () => {
    expect(findMigrationProblem(["a", "b"], [applied("a"), applied("b")])).toBeNull();
  });

  it("allows migrations this image does not know, for a code rollback", () => {
    expect(findMigrationProblem(["a"], [applied("a"), applied("b")])).toBeNull();
  });

  it("reports a pending migration", () => {
    expect(findMigrationProblem(["a", "b"], [applied("a")])).toEqual({ kind: "pending", name: "b" });
  });

  it("reports a failed migration this image ships", () => {
    const failed: MigrationRow = { name: "b", isFinished: false, isRolledBack: false };
    expect(findMigrationProblem(["a", "b"], [applied("a"), failed])).toEqual({ kind: "failed", name: "b" });
  });

  it("stays ready on a failed migration of a newer release, so the running version keeps serving", () => {
    const failed: MigrationRow = { name: "b", isFinished: false, isRolledBack: false };
    expect(findMigrationProblem(["a"], [applied("a"), failed])).toBeNull();
  });

  it("accepts a failed attempt that was rolled back and applied again", () => {
    const rolledBack: MigrationRow = { name: "a", isFinished: false, isRolledBack: true };
    expect(findMigrationProblem(["a"], [rolledBack, applied("a")])).toBeNull();
  });

  it("treats a rolled back migration without a new attempt as pending", () => {
    const rolledBack: MigrationRow = { name: "a", isFinished: false, isRolledBack: true };
    expect(findMigrationProblem(["a"], [rolledBack])).toEqual({ kind: "pending", name: "a" });
  });
});

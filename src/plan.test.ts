import { describe, it } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import { planCleanup, type Artifact } from "./plan.ts";

const now = moment("2026-09-03T12:00:00Z");
const maxAge = now.clone().subtract(30, "days");

function artifact(id: number, daysOld: number, headSha?: string): Artifact {
  return {
    id,
    name: `artifact-${id}`,
    created_at: now.clone().subtract(daysOld, "days").toISOString(),
    workflow_run: headSha === undefined ? null : { head_sha: headSha },
  };
}

const defaults = {
  maxAge,
  skipTags: false,
  taggedCommits: [],
  skipRecent: 0,
  skipRecentCommits: 0,
};

describe("planCleanup", () => {
  it("removes artifacts older than maxAge and keeps newer ones", () => {
    const plan = planCleanup([artifact(1, 31), artifact(2, 29)], defaults);

    assert.deepEqual(
      plan.remove.map((a) => a.id),
      [1]
    );
    assert.deepEqual(
      plan.kept.map((a) => a.id),
      [2]
    );
  });

  it("keeps the newest artifacts for skip-recent regardless of input order", () => {
    const plan = planCleanup(
      [artifact(1, 90), artifact(2, 40), artifact(3, 60)],
      { ...defaults, skipRecent: 2 }
    );

    assert.deepEqual(
      plan.recent.map((a) => a.id),
      [2, 3]
    );
    assert.deepEqual(
      plan.remove.map((a) => a.id),
      [1]
    );
  });

  it("deduplicates artifacts repeated across pages", () => {
    const plan = planCleanup([artifact(1, 40), artifact(1, 40)], {
      ...defaults,
      skipRecent: 1,
    });

    assert.deepEqual(
      plan.recent.map((a) => a.id),
      [1]
    );
    assert.deepEqual(plan.remove, []);
  });

  it("keeps artifacts of tagged commits when skip-tags is on", () => {
    const plan = planCleanup(
      [artifact(1, 40, "release"), artifact(2, 40, "other")],
      { ...defaults, skipTags: true, taggedCommits: ["release"] }
    );

    assert.deepEqual(
      plan.tagged.map((a) => a.id),
      [1]
    );
    assert.deepEqual(
      plan.remove.map((a) => a.id),
      [2]
    );
  });

  it("keeps artifacts without commit information when skip-tags is on", () => {
    const plan = planCleanup([artifact(1, 40)], {
      ...defaults,
      skipTags: true,
    });

    assert.deepEqual(
      plan.unknownCommit.map((a) => a.id),
      [1]
    );
    assert.deepEqual(plan.tagged, []);
    assert.deepEqual(plan.remove, []);
  });

  it("deletes artifacts of tagged commits when skip-tags is off", () => {
    const plan = planCleanup([artifact(1, 40, "release")], {
      ...defaults,
      taggedCommits: ["release"],
    });

    assert.deepEqual(
      plan.remove.map((a) => a.id),
      [1]
    );
  });

  it("does not count tagged artifacts towards skip-recent", () => {
    const plan = planCleanup(
      [artifact(1, 10, "release"), artifact(2, 40, "other")],
      { ...defaults, skipTags: true, taggedCommits: ["release"], skipRecent: 1 }
    );

    assert.deepEqual(
      plan.recent.map((a) => a.id),
      [2]
    );
  });

  it("keeps artifacts with an invalid created_at", () => {
    const plan = planCleanup(
      [
        { ...artifact(1, 40), created_at: null },
        { ...artifact(2, 40), created_at: "soon" },
      ],
      defaults
    );

    assert.deepEqual(
      plan.invalid.map((a) => a.id),
      [1, 2]
    );
    assert.deepEqual(plan.remove, []);
  });

  it("does not let invalid artifacts take skip-recent slots", () => {
    const plan = planCleanup(
      [
        { ...artifact(1, 40), created_at: null },
        artifact(2, 10),
        artifact(3, 40),
      ],
      { ...defaults, skipRecent: 1 }
    );

    assert.deepEqual(
      plan.recent.map((a) => a.id),
      [2]
    );
    assert.deepEqual(
      plan.invalid.map((a) => a.id),
      [1]
    );
    assert.deepEqual(
      plan.remove.map((a) => a.id),
      [3]
    );
  });

  it("keeps all artifacts of the most recent commits for skip-recent-commits", () => {
    const plan = planCleanup(
      [
        artifact(1, 40, "c3"),
        artifact(2, 41, "c3"),
        artifact(3, 50, "c2"),
        artifact(4, 60, "c1"),
        artifact(5, 70, "c2"),
        artifact(6, 80),
      ],
      { ...defaults, skipRecentCommits: 2 }
    );

    assert.deepEqual(
      plan.recentCommit.map((a) => a.id),
      [1, 2, 3, 5]
    );
    assert.deepEqual(
      plan.remove.map((a) => a.id),
      [4, 6]
    );
  });

  it("does not count artifacts of recent commits towards skip-recent", () => {
    const plan = planCleanup(
      [artifact(1, 40, "c2"), artifact(2, 50, "c1"), artifact(3, 60, "c1")],
      { ...defaults, skipRecentCommits: 1, skipRecent: 1 }
    );

    assert.deepEqual(
      plan.recentCommit.map((a) => a.id),
      [1]
    );
    assert.deepEqual(
      plan.recent.map((a) => a.id),
      [2]
    );
    assert.deepEqual(
      plan.remove.map((a) => a.id),
      [3]
    );
  });
});

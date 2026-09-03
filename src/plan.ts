import type moment from "moment";

/** The subset of the GitHub artifact object this action uses. */
export interface Artifact {
  id: number;
  name: string;
  created_at: string | null;
  workflow_run?: { head_sha?: string } | null;
}

export interface PlanOptions {
  maxAge: moment.Moment;
  skipTags: boolean;
  taggedCommits: string[];
  skipRecent: number;
}

export interface Plan {
  /** Older than maxAge, to be deleted. */
  remove: Artifact[];
  /** Kept because skip-tags is on and the artifact belongs to a tagged commit. */
  tagged: Artifact[];
  /** Kept because skip-tags is on and the artifact has no commit to check against. */
  unknownCommit: Artifact[];
  /** Kept because of skip-recent. */
  recent: Artifact[];
  /** Kept because they are newer than maxAge. */
  kept: Artifact[];
  /** Kept because created_at is missing or unparsable. */
  invalid: Artifact[];
}

/**
 * Decides what to do with each artifact. Pure: no API calls, no logging.
 * Artifacts are deduplicated by id and sorted newest first, so skip-recent
 * keeps the genuinely newest ones regardless of the order the API returned.
 */
export function planCleanup(artifacts: Artifact[], options: PlanOptions): Plan {
  const plan: Plan = {
    remove: [],
    tagged: [],
    unknownCommit: [],
    recent: [],
    kept: [],
    invalid: [],
  };
  const tagged = new Set(options.taggedCommits);
  const maxAge = options.maxAge.valueOf();

  const dated: { artifact: Artifact; createdAt: number }[] = [];

  for (const artifact of new Map(artifacts.map((a) => [a.id, a])).values()) {
    const createdAt = Date.parse(artifact.created_at ?? "");

    if (Number.isNaN(createdAt)) {
      plan.invalid.push(artifact);
    } else {
      dated.push({ artifact, createdAt });
    }
  }

  dated.sort((a, b) => b.createdAt - a.createdAt);

  for (const { artifact, createdAt } of dated) {
    if (options.skipTags) {
      const headSha = artifact.workflow_run?.head_sha;

      if (!headSha) {
        // Fail safe: without a commit we cannot tell whether it is a release artifact.
        plan.unknownCommit.push(artifact);
        continue;
      }

      if (tagged.has(headSha)) {
        plan.tagged.push(artifact);
        continue;
      }
    }

    if (plan.recent.length < options.skipRecent) {
      plan.recent.push(artifact);
    } else if (createdAt < maxAge) {
      plan.remove.push(artifact);
    } else {
      plan.kept.push(artifact);
    }
  }

  return plan;
}

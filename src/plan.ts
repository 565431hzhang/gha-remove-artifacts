import moment from "moment";

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
  /** Kept because skip-tags is on and the artifact belongs to a tagged commit (or its commit is unknown). */
  tagged: Artifact[];
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
    recent: [],
    kept: [],
    invalid: [],
  };
  const tagged = new Set(options.taggedCommits);

  const unique = [...new Map(artifacts.map((a) => [a.id, a])).values()].sort(
    (a, b) => moment(b.created_at).valueOf() - moment(a.created_at).valueOf()
  );

  for (const artifact of unique) {
    if (options.skipTags) {
      const headSha = artifact.workflow_run?.head_sha;

      // Fail safe: without a commit we cannot tell whether it is a release artifact.
      if (!headSha || tagged.has(headSha)) {
        plan.tagged.push(artifact);
        continue;
      }
    }

    if (plan.recent.length < options.skipRecent) {
      plan.recent.push(artifact);
      continue;
    }

    const createdAt = moment(artifact.created_at);

    if (!createdAt.isValid()) {
      plan.invalid.push(artifact);
    } else if (createdAt.isBefore(options.maxAge)) {
      plan.remove.push(artifact);
    } else {
      plan.kept.push(artifact);
    }
  }

  return plan;
}

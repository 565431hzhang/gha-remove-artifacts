import { getInput, setFailed } from "@actions/core";
import { getConfig } from "./config.ts";
import { createOctokit } from "./octokit.ts";
import { planCleanup, type Artifact } from "./plan.ts";

const PER_PAGE = 100;

function describe(artifact: Artifact): string {
  return `(id: ${artifact.id}, name: ${artifact.name})`;
}

/** HTTP status of an Octokit request error, if that is what `error` is. */
function httpStatus(error: unknown): number | undefined {
  return (error as { status?: number } | null)?.status;
}

/** One-line summary of a thrown value. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const status = httpStatus(error);
  return status ? `HTTP ${status}: ${message}` : message;
}

async function run(): Promise<void> {
  const config = getConfig(getInput);
  const octokit = createOctokit(config.maxRetries);

  console.log(
    `Removing artifacts created before ${config.maxAge.format()}` +
      (config.dryRun ? " (dry run, nothing is deleted)" : "")
  );

  const taggedCommits = config.skipTags
    ? (
        await octokit.paginate(octokit.rest.repos.listTags, {
          ...config.repo,
          per_page: PER_PAGE,
        })
      ).map((tag) => tag.commit.sha)
    : [];

  const artifacts = await octokit.paginate(
    octokit.rest.actions.listArtifactsForRepo,
    { ...config.repo, per_page: PER_PAGE }
  );

  console.log(`Found ${artifacts.length} artifacts.`);

  const plan = planCleanup(artifacts, { ...config, taggedCommits });

  const skipReasons: [Artifact[], (artifact: Artifact) => string][] = [
    [plan.tagged, (a) => `tagged, commit ${a.workflow_run?.head_sha}`],
    [
      plan.unknownCommit,
      () => "no commit information, cannot tell whether it is tagged",
    ],
    [plan.recent, () => "recent"],
    [plan.recentCommit, (a) => `recent commit ${a.workflow_run?.head_sha}`],
    [plan.invalid, () => "invalid created_at"],
  ];

  for (const [artifacts, reason] of skipReasons) {
    for (const artifact of artifacts) {
      console.log(
        `Skipping artifact ${describe(artifact)}: ${reason(artifact)}.`
      );
    }
  }

  let removed = 0;
  let failed = 0;

  for (const artifact of plan.remove) {
    if (config.dryRun) {
      console.log(`Would remove artifact ${describe(artifact)}.`);
      removed += 1;
      continue;
    }

    try {
      await octokit.rest.actions.deleteArtifact({
        ...config.repo,
        artifact_id: artifact.id,
      });
      removed += 1;
      console.log(`Removed artifact ${describe(artifact)}.`);
    } catch (error) {
      if (httpStatus(error) === 404) {
        console.log(`Artifact ${describe(artifact)} was already removed.`);
        continue;
      }

      failed += 1;
      console.error(
        `Failed to remove artifact ${describe(artifact)}: ${describeError(error)}`
      );
    }
  }

  const skippedTagged = plan.tagged.length + plan.unknownCommit.length;
  const skippedRecent = plan.recent.length + plan.recentCommit.length;

  console.log(
    `Done. ${config.dryRun ? "Would have removed" : "Removed"} ${removed} artifacts. ` +
      `Skipped ${skippedTagged} tagged, ${skippedRecent} recent, ` +
      `${plan.kept.length} newer than the maximum age, ${plan.invalid.length} invalid. ` +
      `Failed: ${failed}.`
  );

  if (failed > 0) {
    throw new Error(
      `${failed} artifact(s) could not be removed, see the log above.`
    );
  }
}

run().catch((error: unknown) => {
  setFailed(error instanceof Error ? error : String(error));
});

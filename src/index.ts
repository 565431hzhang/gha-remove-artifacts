import { getInput, setFailed } from "@actions/core";
import { getConfig } from "./config.ts";
import { createOctokit } from "./octokit.ts";
import { planCleanup, type Artifact } from "./plan.ts";

const PER_PAGE = 100;

function describe(artifact: Artifact): string {
  return `(id: ${artifact.id}, name: ${artifact.name})`;
}

/** One-line summary of an Octokit RequestError or any other thrown value. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { status?: number }).status;
    return status ? `HTTP ${status}: ${error.message}` : error.message;
  }
  return String(error);
}

async function run(): Promise<void> {
  const config = getConfig(getInput);
  const octokit = createOctokit(config.maxRetries);

  console.log(
    `Removing artifacts created before ${config.maxAge.format()}` +
      (config.dryRun ? " (dry run, nothing is deleted)" : "")
  );

  let taggedCommits: string[] = [];

  if (config.skipTags) {
    try {
      const tags = await octokit.paginate(octokit.rest.repos.listTags, {
        ...config.repo,
        per_page: PER_PAGE,
      });
      taggedCommits = tags.map((tag) => tag.commit.sha);
    } catch (error) {
      console.error(
        `Failed to list tags (needed for skip-tags): ${describeError(error)}`
      );
      throw error;
    }
  }

  const artifacts = await octokit.paginate(
    octokit.rest.actions.listArtifactsForRepo,
    { ...config.repo, per_page: PER_PAGE }
  );

  console.log(`Found ${artifacts.length} artifacts.`);

  const plan = planCleanup(artifacts, { ...config, taggedCommits });

  for (const artifact of plan.tagged) {
    console.log(
      `Skipping tagged artifact ${describe(artifact)}, commit ${artifact.workflow_run?.head_sha}.`
    );
  }
  for (const artifact of plan.unknownCommit) {
    console.log(
      `Skipping artifact ${describe(artifact)}: no commit information, cannot tell whether it is tagged.`
    );
  }
  for (const artifact of plan.recent) {
    console.log(`Skipping recent artifact ${describe(artifact)}.`);
  }
  for (const artifact of plan.invalid) {
    console.log(`Skipping artifact ${describe(artifact)}: invalid created_at.`);
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
      if ((error as { status?: number }).status === 404) {
        console.log(`Artifact ${describe(artifact)} was already removed.`);
        continue;
      }

      failed += 1;
      console.error(
        `Failed to remove artifact ${describe(artifact)}: ${describeError(error)}`
      );
    }
  }

  const skipped = plan.tagged.length + plan.unknownCommit.length;

  console.log(
    `Done. ${config.dryRun ? "Would have removed" : "Removed"} ${removed} artifacts. ` +
      `Skipped ${skipped} tagged, ${plan.recent.length} recent, ` +
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

import { getInput, setFailed } from "@actions/core";
import { getConfig, type InputName } from "./config.ts";
import { createOctokit } from "./octokit.ts";
import { planCleanup, type Artifact } from "./plan.ts";

// Dev mode (`pnpm run dev`): inputs come from .env (AGE, SKIP_TAGS, ...) and nothing is deleted.
const devEnv = process.env.NODE_ENV === "dev";

function readInput(name: InputName): string | undefined {
  if (devEnv) {
    return process.env[name.toUpperCase().replaceAll("-", "_")];
  }

  return getInput(name);
}

const PER_PAGE = 100;

function describe(artifact: Artifact): string {
  return `(id: ${artifact.id}, name: ${artifact.name})`;
}

async function run(): Promise<void> {
  const config = getConfig(readInput);
  const octokit = createOctokit(config.maxRetries);

  console.log(
    `Maximum artifact age: removing artifacts created before ${config.maxAge.format()}`
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

  for (const artifact of plan.tagged) {
    const commit = artifact.workflow_run?.head_sha ?? "unknown commit";
    console.log(`Skipping tagged artifact ${describe(artifact)}, ${commit}.`);
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
    if (devEnv) {
      console.log(
        `Development environment, not removing artifact ${describe(artifact)}.`
      );
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
        `Failed to remove artifact ${describe(artifact)}: ${(error as Error).message}`
      );
    }
  }

  console.log(
    `Done. ${devEnv ? "Would have removed" : "Removed"} ${removed} artifacts. ` +
      `Skipped ${plan.tagged.length} tagged, ${plan.recent.length} recent, ` +
      `${plan.kept.length} newer than the maximum age, ${plan.invalid.length} invalid. ` +
      `Failed: ${failed}.`
  );

  if (failed > 0) {
    throw new Error(
      `${failed} artifact(s) could not be removed, see the log above.`
    );
  }
}

run().catch((error: Error) => {
  setFailed(error.message);
});

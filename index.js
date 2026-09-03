import { getInput, setFailed } from "@actions/core";
import { Octokit } from "@octokit/action";
import { throttling } from "@octokit/plugin-throttling";
import moment from "moment";
import yn from "yn";
import dotenv from "dotenv-safe";

const devEnv = process.env.NODE_ENV === "dev";

const inputKeys = {
  AGE: devEnv ? "AGE" : "age",
  SKIP_TAGS: devEnv ? "SKIP_TAGS" : "skip-tags",
  SKIP_RECENT: devEnv ? "SKIP_RECENT" : "skip-recent",
  MAX_RETRIES: devEnv ? "MAX_RETRIES" : "max-retries",
};

const defaultMaxRetries = 5;

if (devEnv) {
  dotenv.config();
}

function readInput(key, isRequired = false) {
  if (devEnv) {
    return process.env[key];
  }

  return getInput(key, { required: isRequired });
}

function getConfigs() {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  const [age, units] = readInput(inputKeys.AGE, true).split(" ");
  const maxAge = moment().subtract(age, units);

  console.log(
    "Maximum artifact age:",
    age,
    units,
    "( created before",
    maxAge.format(),
    ")"
  );

  const skipRecent = readInput(inputKeys.SKIP_RECENT);

  if (skipRecent) {
    const parsedRecent = Number(skipRecent);

    if (Number.isNaN(parsedRecent)) {
      throw new Error("skip-recent option must be type of number.");
    }
  }

  const maxRetries = readInput(inputKeys.MAX_RETRIES);

  if (maxRetries && Number.isNaN(Number(maxRetries))) {
    throw new Error("max-retries option must be type of number.");
  }

  return {
    repo: {
      owner,
      repo,
    },
    pagination: {
      perPage: 100,
    },
    maxAge: moment().subtract(age, units),
    skipTags: yn(readInput(inputKeys.SKIP_TAGS)),
    skipRecent: Number(skipRecent),
    maxRetries: maxRetries ? Number(maxRetries) : defaultMaxRetries,
  };
}

const ThrottledOctokit = Octokit.plugin(throttling);

async function run() {
  const configs = getConfigs();

  function shouldRetry(retryAfter, retryCount) {
    if (retryCount >= configs.maxRetries) {
      console.error(
        `Giving up after ${retryCount} retries (max-retries: ${configs.maxRetries}).`
      );

      return false;
    }

    console.log(`Retrying after ${retryAfter} seconds!`);

    return true;
  }
  const octokit = new ThrottledOctokit({
    throttle: {
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        console.error(
          `Request quota exhausted for request ${options.method} ${options.url}, retry count: ${retryCount}`
        );

        return shouldRetry(retryAfter, retryCount);
      },
      onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
        console.error(
          `Secondary rate limit hit for request ${options.method} ${options.url}, retry count: ${retryCount}`
        );

        return shouldRetry(retryAfter, retryCount);
      },
    },
  });

  async function getTaggedCommits() {
    const tags = await octokit.paginate(octokit.rest.repos.listTags, {
      ...configs.repo,
      per_page: configs.pagination.perPage,
    });

    return tags.map((tag) => tag.commit.sha);
  }

  let taggedCommits;

  if (configs.skipTags) {
    try {
      taggedCommits = await getTaggedCommits();
    } catch (err) {
      console.error("Error while requesting tags: ", err);

      throw err;
    }
  }

  const artifacts = await octokit.paginate(
    octokit.rest.actions.listArtifactsForRepo,
    {
      ...configs.repo,
      per_page: configs.pagination.perPage,
    }
  );

  let skippedRecentCounter = 0;
  let removedCounter = 0;

  // Artifacts are listed newest first.
  for (const artifact of artifacts) {
    if (artifact.expired) {
      continue;
    }

    const headSha = artifact.workflow_run?.head_sha;

    if (configs.skipTags && taggedCommits.includes(headSha)) {
      console.log(
        `Skipping tagged artifact (id: ${artifact.id}, name: ${artifact.name}, commit: ${headSha}).`
      );

      continue;
    }

    if (configs.skipRecent && configs.skipRecent > skippedRecentCounter) {
      console.log(
        `Skipping recent artifact (id: ${artifact.id}, name: ${artifact.name}).`
      );

      skippedRecentCounter += 1;

      continue;
    }

    if (!moment(artifact.created_at).isBefore(configs.maxAge)) {
      continue;
    }

    if (devEnv) {
      console.log(
        `Recognized development environment, preventing artifact (id: ${artifact.id}, name: ${artifact.name}) from being removed.`
      );

      continue;
    }

    await octokit.rest.actions.deleteArtifact({
      ...configs.repo,
      artifact_id: artifact.id,
    });

    removedCounter += 1;

    console.log(
      `Successfully removed artifact (id: ${artifact.id}, name: ${artifact.name}).`
    );
  }

  console.log(
    `Done. Removed ${removedCounter} of ${artifacts.length} artifacts.`
  );
}

run().catch((err) => {
  setFailed(err.toString());
});

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
    try {
      const tags = await octokit.paginate(octokit.rest.repos.listTags, {
        ...configs.repo,
        per_page: configs.pagination.perPage,
      });

      return tags.map((tag) => tag.commit.sha);
    } catch (err) {
      console.error("Error while requesting tags: ", err);

      throw err;
    }
  }

  const taggedCommits = configs.skipTags ? await getTaggedCommits() : [];

  const listedArtifacts = await octokit.paginate(
    octokit.rest.actions.listArtifactsForRepo,
    {
      ...configs.repo,
      per_page: configs.pagination.perPage,
    }
  );

  // The API returns newest first, but that is undocumented, and page-based
  // pagination can repeat an item when artifacts are uploaded concurrently.
  // Dedupe and sort so `skip-recent` keeps the genuinely newest artifacts.
  const artifacts = [
    ...new Map(
      listedArtifacts.map((artifact) => [artifact.id, artifact])
    ).values(),
  ].sort(
    (a, b) => moment(b.created_at).valueOf() - moment(a.created_at).valueOf()
  );

  console.log(`Found ${artifacts.length} artifacts.`);

  const counters = { removed: 0, tagged: 0, recent: 0, kept: 0, failed: 0 };
  const errors = [];

  for (const artifact of artifacts) {
    const label = `(id: ${artifact.id}, name: ${artifact.name})`;

    if (configs.skipTags) {
      const headSha = artifact.workflow_run?.head_sha;

      if (!headSha) {
        console.log(
          `Skipping artifact ${label}: no commit information, cannot tell whether it is tagged.`
        );

        counters.tagged += 1;

        continue;
      }

      if (taggedCommits.includes(headSha)) {
        console.log(`Skipping tagged artifact ${label}, commit: ${headSha}.`);

        counters.tagged += 1;

        continue;
      }
    }

    if (configs.skipRecent > counters.recent) {
      console.log(`Skipping recent artifact ${label}.`);

      counters.recent += 1;

      continue;
    }

    const createdAt = moment(artifact.created_at);

    if (!createdAt.isValid()) {
      console.log(`Skipping artifact ${label}: invalid created_at.`);

      counters.kept += 1;

      continue;
    }

    if (!createdAt.isBefore(configs.maxAge)) {
      counters.kept += 1;

      continue;
    }

    if (devEnv) {
      console.log(
        `Recognized development environment, preventing artifact ${label} from being removed.`
      );

      counters.removed += 1;

      continue;
    }

    try {
      await octokit.rest.actions.deleteArtifact({
        ...configs.repo,
        artifact_id: artifact.id,
      });

      counters.removed += 1;

      console.log(`Successfully removed artifact ${label}.`);
    } catch (err) {
      if (err.status === 404) {
        console.log(`Artifact ${label} was already removed.`);

        continue;
      }

      console.error(`Failed to remove artifact ${label}: ${err.message}`);

      counters.failed += 1;
      errors.push(err);
    }
  }

  console.log(
    `Done. ${devEnv ? "Would have removed" : "Removed"} ${counters.removed} artifacts. ` +
      `Skipped ${counters.tagged} tagged, ${counters.recent} recent, ${counters.kept} newer than the maximum age. ` +
      `Failed: ${counters.failed}.`
  );

  if (errors.length > 0) {
    throw new Error(
      `${errors.length} artifact(s) could not be removed, see the log above.`
    );
  }
}

run().catch((err) => {
  setFailed(err.toString());
});

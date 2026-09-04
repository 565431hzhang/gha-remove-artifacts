import { getInput } from "@actions/core";
import { Octokit } from "@octokit/action";
import { throttling } from "@octokit/plugin-throttling";

const ThrottledOctokit = Octokit.plugin(throttling);

/**
 * The `GITHUB_TOKEN` input wins over a `GITHUB_TOKEN` env var. @octokit/action's
 * own resolution throws when both are set, which is common when the token is
 * exported for all steps (#48).
 */
function resolveToken(): string {
  const token = getInput("GITHUB_TOKEN") || process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error("GITHUB_TOKEN must be provided as an input or env var.");
  }

  return token;
}

/** An Octokit that retries rate-limited requests up to `maxRetries` times. */
export function createOctokit(maxRetries: number) {
  function shouldRetry(retryAfter: number, retryCount: number): boolean {
    if (retryCount >= maxRetries) {
      console.error(
        `Giving up after ${retryCount} retries (max-retries: ${maxRetries}).`
      );
      return false;
    }

    console.log(`Retrying after ${retryAfter} seconds.`);
    return true;
  }

  return new ThrottledOctokit({
    authStrategy: undefined, // disable @octokit/action's env-based resolution
    auth: resolveToken(),
    throttle: {
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        console.error(
          `Request quota exhausted for ${options.method} ${options.url}, retry count: ${retryCount}`
        );
        return shouldRetry(retryAfter, retryCount);
      },
      onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
        console.error(
          `Secondary rate limit hit for ${options.method} ${options.url}, retry count: ${retryCount}`
        );
        return shouldRetry(retryAfter, retryCount);
      },
    },
  });
}

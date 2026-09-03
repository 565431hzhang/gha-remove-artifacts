import { Octokit } from "@octokit/action";
import { throttling } from "@octokit/plugin-throttling";

const ThrottledOctokit = Octokit.plugin(throttling);

type ThrottledOctokit = InstanceType<typeof ThrottledOctokit>;

/** An Octokit that retries rate-limited requests up to `maxRetries` times. */
export function createOctokit(maxRetries: number): ThrottledOctokit {
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

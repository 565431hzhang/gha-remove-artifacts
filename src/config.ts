import moment from "moment";

export type InputName = "age" | "skip-tags" | "skip-recent" | "max-retries";

/** Reads a raw input value; `undefined` or `""` when not provided. */
export type InputReader = (name: InputName) => string | undefined;

export interface Config {
  repo: { owner: string; repo: string };
  /** Artifacts created before this are removed. */
  maxAge: moment.Moment;
  skipTags: boolean;
  skipRecent: number;
  maxRetries: number;
}

const DEFAULT_MAX_RETRIES = 5;

const truthy = new Set(["true", "1", "yes", "y", "on"]);

export function parseBoolean(value: string | undefined): boolean {
  return value !== undefined && truthy.has(value.trim().toLowerCase());
}

export function parseCount(
  name: InputName,
  value: string | undefined
): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const count = Number(value);

  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${value}".`);
  }

  return count;
}

/** Parses e.g. "1 month" or "90 seconds" into a point in time relative to `now`. */
export function parseAge(value: string, now = moment()): moment.Moment {
  const [amountText, unitText, ...rest] = value.trim().split(/\s+/);
  const amount = Number(amountText);
  const unit = moment.normalizeUnits(unitText as moment.unitOfTime.All) as
    moment.unitOfTime.DurationConstructor | undefined;

  if (rest.length > 0 || !Number.isFinite(amount) || amount < 0 || !unit) {
    throw new Error(
      `age must be "<number> <unit>", e.g. "1 month" or "90 seconds", got "${value}".`
    );
  }

  return now.clone().subtract(amount, unit);
}

export function getConfig(
  readInput: InputReader,
  repository = process.env.GITHUB_REPOSITORY
): Config {
  const [owner, repo] = (repository ?? "").split("/");

  if (!owner || !repo) {
    throw new Error("GITHUB_REPOSITORY must be set to <owner>/<repo>.");
  }

  const age = readInput("age");

  if (!age) {
    throw new Error("age input is required.");
  }

  return {
    repo: { owner, repo },
    maxAge: parseAge(age),
    skipTags: parseBoolean(readInput("skip-tags")),
    skipRecent: parseCount("skip-recent", readInput("skip-recent")) ?? 0,
    maxRetries:
      parseCount("max-retries", readInput("max-retries")) ??
      DEFAULT_MAX_RETRIES,
  };
}

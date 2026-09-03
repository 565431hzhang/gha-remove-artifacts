import moment from "moment";

export type InputName =
  "age" | "skip-tags" | "skip-recent" | "max-retries" | "dry-run";

/** Reads a raw input value; `undefined` or `""` when not provided. */
export type InputReader = (name: InputName) => string | undefined;

export interface Config {
  repo: { owner: string; repo: string };
  /** Artifacts created before this are removed. */
  maxAge: moment.Moment;
  skipTags: boolean;
  skipRecent: number;
  maxRetries: number;
  /** Log what would be removed without deleting anything. */
  dryRun: boolean;
}

const DEFAULT_MAX_RETRIES = 5;

// Same spellings the `yn` package accepted.
const truthy = new Set(["y", "yes", "t", "true", "1", "on"]);

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

// moment.normalizeUnits also knows non-duration units such as "date" (D) or
// "weekday" (e), which subtract() silently treats as zero, so allowlist explicitly.
const durationUnits = new Set([
  "year",
  "quarter",
  "month",
  "week",
  "day",
  "hour",
  "minute",
  "second",
  "millisecond",
]);

function toDurationUnit(
  text: string
): moment.unitOfTime.DurationConstructor | undefined {
  const unit = moment.normalizeUnits(text as moment.unitOfTime.All);

  return durationUnits.has(unit)
    ? (unit as moment.unitOfTime.DurationConstructor)
    : undefined;
}

/** Parses e.g. "1 month" or "90 seconds" into a point in time relative to `now`. */
export function parseAge(value: string, now = moment()): moment.Moment {
  const [amountText, unitText = "", ...rest] = value.trim().split(/\s+/);
  const amount = Number(amountText);
  const unit = toDurationUnit(unitText);

  if (rest.length > 0 || !Number.isInteger(amount) || amount < 0 || !unit) {
    throw new Error(
      `age must be "<whole number> <unit>", e.g. "1 month" or "90 seconds", got "${value}".`
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
    dryRun: parseBoolean(readInput("dry-run")),
  };
}

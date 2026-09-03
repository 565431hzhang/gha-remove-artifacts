import { describe, it } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import { getConfig, parseAge, parseBoolean, parseCount } from "./config.ts";

describe("parseAge", () => {
  const now = moment("2026-09-03T12:00:00Z");

  it("subtracts the given duration", () => {
    assert.equal(
      parseAge("1 month", now).toISOString(),
      "2026-08-03T12:00:00.000Z"
    );
    assert.equal(
      parseAge("90 seconds", now).toISOString(),
      "2026-09-03T11:58:30.000Z"
    );
    assert.equal(
      parseAge("2 years", now).toISOString(),
      "2024-09-03T12:00:00.000Z"
    );
  });

  it("accepts singular and short unit spellings", () => {
    assert.equal(
      parseAge("1 day", now).toISOString(),
      "2026-09-02T12:00:00.000Z"
    );
    assert.equal(
      parseAge("2 d", now).toISOString(),
      "2026-09-01T12:00:00.000Z"
    );
    assert.equal(
      parseAge("1 M", now).toISOString(),
      "2026-08-03T12:00:00.000Z"
    );
  });

  it("rejects malformed values", () => {
    const malformed = [
      "",
      "month",
      "1",
      "1 fortnight",
      "-1 days",
      "1 2 days",
      // fractional amounts are rounded or dropped by moment
      "0.4 days",
      "1.5 months",
      // units moment knows but that are not durations (would subtract nothing)
      "1 D",
      "30 date",
      "3 weekdays",
      "1 dayOfYear",
    ];

    for (const value of malformed) {
      assert.throws(() => parseAge(value, now), /age must be/, value);
    }
  });
});

describe("parseBoolean", () => {
  it("accepts yes/no-like values", () => {
    assert.equal(parseBoolean("true"), true);
    assert.equal(parseBoolean("Yes"), true);
    assert.equal(parseBoolean("1"), true);
    assert.equal(parseBoolean("t"), true);
    assert.equal(parseBoolean("T"), true);
    assert.equal(parseBoolean("on"), true);
    assert.equal(parseBoolean("false"), false);
    assert.equal(parseBoolean("no"), false);
    assert.equal(parseBoolean(""), false);
    assert.equal(parseBoolean(undefined), false);
  });
});

describe("parseCount", () => {
  it("returns undefined when not provided", () => {
    assert.equal(parseCount("skip-recent", undefined), undefined);
    assert.equal(parseCount("skip-recent", ""), undefined);
  });

  it("parses non-negative integers and rejects everything else", () => {
    assert.equal(parseCount("skip-recent", "5"), 5);
    assert.equal(parseCount("skip-recent", "0"), 0);
    assert.throws(
      () => parseCount("skip-recent", "abc"),
      /skip-recent must be/
    );
    assert.throws(() => parseCount("skip-recent", "-1"), /skip-recent must be/);
    assert.throws(
      () => parseCount("skip-recent", "1.5"),
      /skip-recent must be/
    );
  });
});

describe("getConfig", () => {
  const inputs = (values: Record<string, string>) => (name: string) =>
    values[name];

  it("applies defaults", () => {
    const config = getConfig(inputs({ age: "1 day" }), "owner/repo");

    assert.deepEqual(config.repo, { owner: "owner", repo: "repo" });
    assert.equal(config.skipTags, false);
    assert.equal(config.skipRecent, 0);
    assert.equal(config.maxRetries, 5);
    assert.equal(config.dryRun, false);
  });

  it("reads all inputs", () => {
    const config = getConfig(
      inputs({
        age: "1 day",
        "skip-tags": "true",
        "skip-recent": "3",
        "max-retries": "0",
      }),
      "owner/repo"
    );

    assert.equal(config.skipTags, true);
    assert.equal(config.skipRecent, 3);
    assert.equal(config.maxRetries, 0);
  });

  it("requires age and a valid repository", () => {
    assert.throws(
      () => getConfig(inputs({}), "owner/repo"),
      /age input is required/
    );
    assert.throws(
      () => getConfig(inputs({ age: "1 day" }), "nope"),
      /GITHUB_REPOSITORY/
    );
  });
});

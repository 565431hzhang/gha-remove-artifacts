// End-to-end: runs the action as a child process against an in-process mock
// of the GitHub API and checks both the output and what the "API" received.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";
import { once } from "node:events";
import type { Artifact } from "./plan.ts";

const DAY = 86_400_000;

function artifact(id: number, daysOld: number, headSha?: string): Artifact {
  return {
    id,
    name: `a${id}`,
    created_at: new Date(Date.now() - daysOld * DAY).toISOString(),
    workflow_run: headSha === undefined ? null : { head_sha: headSha },
  };
}

// id 1 belongs to the tagged commit, id 5 has no commit information.
const artifacts = [
  artifact(1, 100, "release"),
  artifact(2, 50, "x"),
  artifact(3, 10, "x"),
  artifact(4, 200, "x"),
  artifact(5, 300),
];
const tags = [{ name: "v1", commit: { sha: "release" } }];

interface DeleteResponse {
  status: number;
  message?: string;
  headers?: Record<string, string>;
}

/** Called for every DELETE with the artifact id and how many times it was already attempted. */
type OnDelete = (id: number, attempt: number) => DeleteResponse;

const ok: OnDelete = () => ({ status: 204 });

function rateLimited(kind: "primary" | "secondary"): DeleteResponse {
  return kind === "primary"
    ? {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000)),
        },
      }
    : {
        // The throttling plugin recognises secondary limits by GitHub's wording.
        status: 403,
        message: "You have exceeded a secondary rate limit",
        headers: { "retry-after": "1" }, // 0 would be falsy and fall back to the plugin's 60s default
      };
}

async function startMockApi(onDelete: OnDelete, perPage = 2) {
  const deleted: number[] = [];
  const attempts = new Map<number, number>();
  let requests = 0;

  const server = http.createServer((req, res) => {
    requests += 1;
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body?: unknown, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };

    if (req.method === "DELETE") {
      const id = Number(url.pathname.split("/").pop());
      const attempt = attempts.get(id) ?? 0;
      attempts.set(id, attempt + 1);
      const response = onDelete(id, attempt);
      if (response.status === 204) deleted.push(id);
      return send(
        response.status,
        { message: response.message ?? `status ${response.status}` },
        response.headers
      );
    }

    if (url.pathname.endsWith("/tags")) return send(200, tags);

    if (url.pathname.endsWith("/actions/artifacts")) {
      // Paginate in small pages so the pagination path is exercised too.
      const page = Number(url.searchParams.get("page") ?? 1);
      const slice = artifacts.slice((page - 1) * perPage, page * perPage);
      const address = server.address() as { port: number };
      const headers =
        page * perPage < artifacts.length
          ? {
              link: `<http://127.0.0.1:${address.port}${url.pathname}?page=${page + 1}>; rel="next"`,
            }
          : {};
      return send(
        200,
        { total_count: artifacts.length, artifacts: slice },
        headers
      );
    }

    send(500, { message: `unexpected ${req.method} ${req.url}` });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${port}`,
    deleted,
    get requests() {
      return requests;
    },
    close: () => server.close(),
  };
}

// Must be async: a blocking spawn would starve the in-process mock API.
async function runAction(
  apiUrl: string,
  inputs: Record<string, string>,
  extraEnv: Record<string, string> = {}
) {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    GITHUB_API_URL: apiUrl,
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_ACTION: "test",
    INPUT_GITHUB_TOKEN: "token",
    ...extraEnv,
  };
  for (const [name, value] of Object.entries(inputs)) {
    env[`INPUT_${name.toUpperCase()}`] = value;
  }

  try {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      ["src/index.ts"],
      { env, encoding: "utf8" }
    );
    return { status: 0, output: stdout + stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { status: failed.code, output: failed.stdout + failed.stderr };
  }
}

async function withMockApi(
  onDelete: OnDelete,
  test: (api: Awaited<ReturnType<typeof startMockApi>>) => Promise<void>
) {
  const api = await startMockApi(onDelete);
  try {
    await test(api);
  } finally {
    api.close();
  }
}

// Each delete waits ~1s (the plugin serialises writes) and each retry another second or two.
describe("end to end", { timeout: 120_000 }, () => {
  it("removes artifacts older than age and keeps newer ones", () =>
    withMockApi(ok, async (api) => {
      const { status, output } = await runAction(api.url, { age: "30 days" });

      assert.equal(status, 0, output);
      assert.deepEqual(api.deleted.sort(), [1, 2, 4, 5]);
      assert.match(output, /Found 5 artifacts/);
      assert.match(
        output,
        /Removed 4 artifacts\. Skipped 0 tagged, 0 recent, 1 newer/
      );
    }));

  it("honours skip-tags and skip-recent", () =>
    withMockApi(ok, async (api) => {
      const { status, output } = await runAction(api.url, {
        age: "30 days",
        "skip-tags": "true",
        "skip-recent": "1",
      });

      assert.equal(status, 0, output);
      assert.deepEqual(api.deleted.sort(), [2, 4]);
      assert.match(output, /\(id: 1, name: a1\): tagged, commit release/);
      assert.match(output, /\(id: 5, name: a5\): no commit information/);
      assert.match(output, /\(id: 3, name: a3\): recent/);
    }));

  it("keeps artifacts of recent commits with skip-recent-commits", () =>
    withMockApi(ok, async (api) => {
      const { status, output } = await runAction(api.url, {
        age: "30 days",
        "skip-recent-commits": "1",
      });

      assert.equal(status, 0, output);
      // id 3 is the newest artifact and belongs to commit "x", as do ids 2 and 4.
      assert.deepEqual(api.deleted.sort(), [1, 5]);
      assert.match(output, /\(id: 2, name: a2\): recent commit x/);
    }));

  it("works when GITHUB_TOKEN is set both as input and env var", () =>
    withMockApi(ok, async (api) => {
      const { status, output } = await runAction(
        api.url,
        { age: "30 days", "dry-run": "true" },
        { GITHUB_TOKEN: "env-token" }
      );

      assert.equal(status, 0, output);
      assert.match(output, /Would have removed 4 artifacts/);
    }));

  it("deletes nothing in dry-run mode", () =>
    withMockApi(ok, async (api) => {
      const { status, output } = await runAction(api.url, {
        age: "30 days",
        "dry-run": "true",
      });

      assert.equal(status, 0, output);
      assert.deepEqual(api.deleted, []);
      assert.match(output, /dry run, nothing is deleted/);
      assert.match(output, /Would have removed 4 artifacts/);
    }));

  it("retries after a primary rate limit", () =>
    withMockApi(
      (id, attempt) =>
        id === 2 && attempt === 0 ? rateLimited("primary") : ok(id, attempt),
      async (api) => {
        const { status, output } = await runAction(api.url, { age: "30 days" });

        assert.equal(status, 0, output);
        assert.deepEqual(api.deleted.sort(), [1, 2, 4, 5]);
        assert.match(output, /Request quota exhausted .* retry count: 0/);
        assert.match(output, /Retrying after \d+ seconds/);
      }
    ));

  it("retries after a secondary rate limit", () =>
    withMockApi(
      (id, attempt) =>
        attempt === 0 ? rateLimited("secondary") : ok(id, attempt),
      async (api) => {
        const { status, output } = await runAction(api.url, { age: "30 days" });

        assert.equal(status, 0, output);
        assert.deepEqual(api.deleted.sort(), [1, 2, 4, 5]);
        assert.match(output, /Secondary rate limit hit/);
      }
    ));

  it("gives up after max-retries and fails the run", () =>
    withMockApi(
      () => rateLimited("primary"),
      async (api) => {
        const { status, output } = await runAction(api.url, {
          age: "30 days",
          "max-retries": "1",
        });

        assert.equal(status, 1);
        assert.deepEqual(api.deleted, []);
        assert.match(output, /Giving up after 1 retries \(max-retries: 1\)/);
        assert.match(output, /Failed: 4/);
        assert.match(output, /::error::.*4 artifact\(s\) could not be removed/);
      }
    ));

  it("keeps going after a failed delete and reports it at the end", () =>
    withMockApi(
      (id) => ({ status: id === 1 ? 404 : id === 2 ? 500 : 204 }),
      async (api) => {
        const { status, output } = await runAction(api.url, { age: "30 days" });

        assert.equal(status, 1);
        assert.deepEqual(api.deleted.sort(), [4, 5]);
        assert.match(output, /\(id: 1, name: a1\) was already removed/);
        assert.match(
          output,
          /Failed to remove artifact \(id: 2, name: a2\): HTTP 500/
        );
        assert.match(output, /Removed 2 artifacts\..*Failed: 1/);
      }
    ));

  it("rejects invalid input before calling the API", () =>
    withMockApi(ok, async (api) => {
      const { status, output } = await runAction(api.url, { age: "0.5 days" });

      assert.equal(status, 1);
      assert.equal(api.requests, 0);
      assert.match(output, /::error::.*age must be/);
    }));
});

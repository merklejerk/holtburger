import { appendFileSync } from "node:fs";
import { z } from "zod";
import { commandLine, runCli } from "../cli.ts";
import { ROOT, readJson, runBytes } from "../io.ts";

/** Only root prose is exempt: bundled quickstart edits remain build inputs. */
export function documentationOnly(path: string): boolean {
  return !path.includes("/") && path.endsWith(".md") && path !== "LICENSE.md";
}

/** Evaluate push/PR source changes, retaining forced verification for tags/manual runs. */
export function buildRelevant(
  event: unknown,
  name: string,
  refType: string,
): boolean {
  if (refType === "tag" || ["workflow_dispatch", "schedule"].includes(name))
    return true;
  const source = z
    .union([
      z
        .object({
          pull_request: z.object({
            base: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) }),
          }),
        })
        .transform((value) => value.pull_request.base.sha),
      z
        .object({ before: z.string().regex(/^[0-9a-f]{40}$/) })
        .transform((value) => value.before),
    ])
    .parse(event);
  const args = /^0+$/.test(source)
    ? ["ls-files", "-z"]
    : ["diff", "--name-only", "-z", source, "HEAD"];
  return runBytes("git", args, ROOT)
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .some((path) => !documentationOnly(path));
}

if (import.meta.main) {
  await runCli(
    commandLine("npm run check:changes --").command(
      "$0",
      "Determine build relevance from the GitHub event environment",
      {},
      () => {
        const env = z
          .object({
            GITHUB_EVENT_PATH: z.string(),
            GITHUB_EVENT_NAME: z.string(),
            GITHUB_REF_TYPE: z.string(),
            GITHUB_OUTPUT: z.string(),
          })
          .parse(process.env);
        const relevant = buildRelevant(
          readJson(env.GITHUB_EVENT_PATH),
          env.GITHUB_EVENT_NAME,
          env.GITHUB_REF_TYPE,
        );
        appendFileSync(env.GITHUB_OUTPUT, `relevant=${relevant}\n`);
        console.log(`Build-input changes: ${relevant}`);
      },
    ),
  );
}

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { AppBuild } from "../src/app/app-build.ts";

/** Capture source identity during configuration; missing package/Git metadata fails the build. */
export function readAppBuild(appRoot: string, development: boolean): AppBuild {
	const { version } = z
		.object({ version: z.string().min(1) })
		.parse(JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")));
	const revision = execFileSync("git", ["rev-parse", "--short=8", "HEAD"], {
		cwd: appRoot,
		encoding: "utf8",
	}).trim();
	const status = execFileSync(
		"git",
		[
			"--no-optional-locks",
			"status",
			"--porcelain",
			"--untracked-files=normal",
			"--ignore-submodules=none",
		],
		{ cwd: appRoot, encoding: "utf8" },
	);
	return { development, version, revision, modified: status.length > 0 };
}

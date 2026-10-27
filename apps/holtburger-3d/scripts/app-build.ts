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
	const revision = (
		process.env.HOLTBURGER_SOURCE_REVISION ??
		execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: appRoot,
			encoding: "utf8",
		}).trim()
	).slice(0, 8);
	const modified = process.env.HOLTBURGER_SOURCE_MODIFIED;
	if (modified !== undefined && modified !== "0" && modified !== "1")
		throw new Error("HOLTBURGER_SOURCE_MODIFIED must be 0 or 1");
	const status =
		modified === undefined
			? execFileSync(
					"git",
					[
						"--no-optional-locks",
						"status",
						"--porcelain",
						"--untracked-files=normal",
						"--ignore-submodules=none",
					],
					{ cwd: appRoot, encoding: "utf8" },
				)
			: null;
	return {
		development,
		version,
		revision,
		modified: status === null ? modified === "1" : status.length > 0,
	};
}

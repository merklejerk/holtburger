import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { isAllowedNavigation } from "./navigation-policy.js";

const developmentPolicy = {
	packaged: false,
	appPath: "/application",
	developmentOrigin: "http://127.0.0.1:1420",
};

describe("isAllowedNavigation", () => {
	it("accepts only the exact development origin", () => {
		expect(
			isAllowedNavigation(
				"http://127.0.0.1:1420/explorer/index.html?landblock=0000",
				developmentPolicy,
			),
		).toBe(true);
		expect(
			isAllowedNavigation(
				"http://127.0.0.1:1420.evil.example/explorer/index.html",
				developmentPolicy,
			),
		).toBe(false);
		expect(
			isAllowedNavigation("https://127.0.0.1:1420/", developmentPolicy),
		).toBe(false);
	});

	it("contains packaged navigation within the distribution directory", () => {
		const appPath = join(process.cwd(), "packaged-app");
		const policy = { ...developmentPolicy, packaged: true, appPath };
		expect(
			isAllowedNavigation(
				pathToFileURL(
					join(appPath, "dist", "explorer", "index.html"),
				).toString(),
				policy,
			),
		).toBe(true);
		expect(
			isAllowedNavigation(
				pathToFileURL(join(appPath, "dist-escape", "index.html")).toString(),
				policy,
			),
		).toBe(false);
		expect(isAllowedNavigation("https://example.com/", policy)).toBe(false);
	});
});

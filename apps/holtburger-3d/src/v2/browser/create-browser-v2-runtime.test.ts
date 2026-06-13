import { describe, expect, it } from "vitest";
import {
	shouldUseBrowserSourceResolver,
	shouldUseBrowserWorkerBaker,
} from "./create-browser-v2-runtime";

describe("browser V2 runtime routing", () => {
	it("routes outdoor-detail through source resolver and worker baker", () => {
		expect(
			shouldUseBrowserSourceResolver({
				domain: "outdoor-detail",
				scope: {
					kind: "landblock",
					landblockId: 0xda55ffff,
				},
			}),
		).toBe(true);
		expect(shouldUseBrowserWorkerBaker("outdoor-detail")).toBe(true);
	});

	it("routes env-cell bundles through source resolver and placeholder baker", () => {
		expect(
			shouldUseBrowserSourceResolver({
				domain: "landblock-env-cells",
				scope: {
					kind: "landblock",
					landblockId: 0xda55ffff,
				},
			}),
		).toBe(true);
		expect(shouldUseBrowserWorkerBaker("landblock-env-cells")).toBe(false);
	});
});

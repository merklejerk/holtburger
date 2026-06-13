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

	it("keeps unsupported browser static domains on placeholder paths", () => {
		expect(
			shouldUseBrowserSourceResolver({
				domain: "landblock-topology",
				scope: {
					kind: "landblock",
					landblockId: 0xda55ffff,
				},
			}),
		).toBe(false);
		expect(shouldUseBrowserWorkerBaker("landblock-topology")).toBe(false);
	});
});

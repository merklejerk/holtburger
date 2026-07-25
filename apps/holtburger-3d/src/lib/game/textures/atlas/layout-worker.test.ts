import { describe, expect, it } from "vitest";
import { createAssetTextureKey, TexturePurpose } from "../types";
import { createAtlasPageId } from "./layout";
import {
	runAtlasLayoutWorkerJob,
	type AtlasLayoutWorkerJob,
} from "./layout-worker";

describe("atlas layout worker", () => {
	it("preserves the opaque correlation token without receiving pixel payloads", () => {
		const job: AtlasLayoutWorkerJob = {
			request: {
				correlationId: "reservation:17",
				entries: [
					{
						height: 4,
						key: createAssetTextureKey(
							TexturePurpose.ObjectIndex8,
							"0x05000017",
						),
						purpose: TexturePurpose.ObjectIndex8,
						width: 4,
					},
				],
				nextPageGeneration: 2,
				pages: [],
				purpose: TexturePurpose.ObjectIndex8,
			},
		};

		const result = runAtlasLayoutWorkerJob(job);

		expect(result.plan.correlationId).toBe("reservation:17");
		expect(result.plan.pages[0]?.pageId).toBe(
			createAtlasPageId(TexturePurpose.ObjectIndex8, 2),
		);
	});
});

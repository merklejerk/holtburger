import { describe, expect, it } from "vitest";

import type { TextureBindingId } from "../../../../textures/identity";
import type { TexturePlacementUpdate } from "../../../../renderer/types";
import type { OpenWorldStreamingTextureCommit } from "./contracts";
import {
	applyOpenWorldStreamingTextureCommit,
	createTexturePlacementUpdate,
} from "./texture-commit-applier";

describe("open-world texture commit applier", () => {
	it("maps replacement texture commits to renderer texture placement updates", () => {
		const commit = createTextureCommit();

		expect(createTexturePlacementUpdate(commit, 7)).toMatchObject({
			bindingReadinessUpdates: [],
			placements: [
				{
					bindingId: bindingId("binding:terrain"),
					height: 2,
					pageVersion: {
						placementRevision: 7,
						textureRefId: "texture-ref:terrain",
					},
					textureRefId: "texture-ref:terrain",
					width: 2,
				},
			],
			removedTextureRefIds: ["texture-ref:old"],
			resolvedTexturePlacements: [
				{
					bindingId: bindingId("binding:terrain"),
					rect: [0, 0, 1, 1],
					textureRefId: "texture-ref:terrain",
				},
			],
			revision: 7,
		});
	});

	it("applies renderer updates through a narrow renderer port", () => {
		const updates: TexturePlacementUpdate[] = [];

		applyOpenWorldStreamingTextureCommit(
			{
				applyTexturePlacementUpdate(update): void {
					updates.push(update);
				},
			},
			createTextureCommit(),
			{ revision: 3 },
		);

		expect(updates).toHaveLength(1);
		expect(updates[0]?.revision).toBe(3);
	});

	it("maps non-resident readiness updates without requiring page uploads", () => {
		const commit: OpenWorldStreamingTextureCommit = {
			bindingRemovals: [],
			bindingUpdates: [
				{
					bindingId: bindingId("binding:pending"),
					readiness: {
						kind: "pending",
						reason: "page-building",
					},
				},
				{
					bindingId: bindingId("binding:failed"),
					readiness: {
						kind: "failed",
						message: "page build failed",
					},
				},
				{
					bindingId: bindingId("binding:missing"),
					readiness: {
						kind: "missing-not-in-flight",
						message: "binding was never scheduled",
					},
				},
			],
			bucketKey: "bucket:readiness",
			kind: "texture-commit",
			pageRemovals: [],
			pageUpdates: [],
		};

		expect(createTexturePlacementUpdate(commit, 11)).toMatchObject({
			bindingReadinessUpdates: [
				{
					bindingId: bindingId("binding:pending"),
					kind: "pending",
					reason: "page-building",
				},
				{
					bindingId: bindingId("binding:failed"),
					kind: "failed",
					reason: "page build failed",
				},
				{
					bindingId: bindingId("binding:missing"),
					kind: "missing-not-in-flight",
					reason: "binding was never scheduled",
				},
			],
			placements: [],
			resolvedTexturePlacements: [],
			revision: 11,
		});
	});
});

function createTextureCommit(): OpenWorldStreamingTextureCommit {
	return {
		bindingRemovals: [],
		bindingUpdates: [
			{
				bindingId: bindingId("binding:terrain"),
				readiness: {
					kind: "resident",
					pageVersion: {
						placementRevision: 0,
						textureRefId: "texture-ref:terrain",
					},
					rect: [0, 0, 1, 1],
					textureHeight: 2,
					textureRefId: "texture-ref:terrain",
					textureWidth: 2,
				},
			},
		],
		bucketKey: "bucket:terrain",
		kind: "texture-commit",
		pageRemovals: [
			{
				pageId: "page:old",
				reason: "reclaimed",
				textureRefId: "texture-ref:old",
			},
		],
		pageUpdates: [
			{
				anisotropy: 1,
				filteringMode: "nearest",
				format: "rgba8",
				height: 2,
				mipmapsGenerated: false,
				pageId: "page:terrain",
				pixels: new Uint8Array(16),
				reservationToken:
					"reservation:terrain" as OpenWorldStreamingTextureCommit["pageUpdates"][number]["reservationToken"],
				sampleClass: "rgba-color",
				samplerPolicyKey: "nearest:clamp",
				textureRefId: "texture-ref:terrain",
				uploadBindingId: bindingId("binding:terrain"),
				width: 2,
				wrapS: "clamp-to-edge",
				wrapT: "clamp-to-edge",
			},
		],
	};
}

function bindingId(value: string): TextureBindingId {
	return value as TextureBindingId;
}

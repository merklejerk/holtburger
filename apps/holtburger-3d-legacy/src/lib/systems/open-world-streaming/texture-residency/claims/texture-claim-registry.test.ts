import { describe, expect, it } from "vitest";

import type {
	TextureBindingId,
	TextureKey,
	TexturePageClass,
} from "../../../../textures/identity";
import {
	createOpenWorldTextureBucketKey,
	parseOpenWorldTextureBucketKey,
} from "./bucket-key";
import {
	OpenWorldTextureClaimRegistry,
	groupTextureBindingRequirementsByBucket,
	type OpenWorldTextureBindingRequirement,
} from "./texture-claim-registry";
import type { MaterializationOwnerId } from "../../owners/owner-id";

describe("OpenWorldTextureClaimRegistry", () => {
	it("parses texture bucket keys for replacement-native resource inspection", () => {
		const bucketKey = createOpenWorldTextureBucketKey({
			domain: "outdoor terrain",
			purpose: "terrain-color",
			scope: {
				kind: "static-owner",
				ownerId: "terrain owner",
			},
		});

		expect(parseOpenWorldTextureBucketKey(bucketKey)).toEqual({
			domain: "outdoor terrain",
			purpose: "terrain-color",
			scope: "static-owner:terrain owner",
		});
	});

	it("shares one texture entry across multiple owners", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const bucketKey = createBucketKey("terrain-color");
		const binding = createBinding("terrain-a", bucketKey);

		registry.retainTextureBindings(ownerId("owner:a"), bucketKey, [binding]);
		const snapshot = registry.retainTextureBindings(
			ownerId("owner:b"),
			bucketKey,
			[createBinding("terrain-b", bucketKey)],
		);

		expect(snapshot.entries).toHaveLength(1);
		expect(snapshot.entries[0]).toMatchObject({
			bindingIds: [
				bindingId("binding:terrain-a"),
				bindingId("binding:terrain-b"),
			],
			ownerIds: [ownerId("owner:a"), ownerId("owner:b")],
			state: "claimed",
		});
	});

	it("uses bucket and canonical texture key as texture entry identity", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const bucketKey = createBucketKey("terrain-color");

		registry.retainTextureBindings(ownerId("owner:a"), bucketKey, [
			createBinding("terrain-a", bucketKey, {
				bindingId: bindingId("binding:terrain-owner-a"),
				textureKey: textureKey("texture:shared-terrain"),
			}),
		]);
		const snapshot = registry.retainTextureBindings(ownerId("owner:b"), bucketKey, [
			createBinding("terrain-b", bucketKey, {
				bindingId: bindingId("binding:terrain-owner-b"),
				textureKey: textureKey("texture:shared-terrain"),
			}),
		]);

		expect(snapshot.entries).toEqual([
			expect.objectContaining({
				bindingIds: [
					bindingId("binding:terrain-owner-a"),
					bindingId("binding:terrain-owner-b"),
				],
				sourceKey: "source:shared",
				textureKey: textureKey("texture:shared-terrain"),
			}),
		]);
	});

	it("fails loudly when one canonical texture key maps to conflicting source facts", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const bucketKey = createBucketKey("terrain-color");

		registry.retainTextureBindings(ownerId("owner:a"), bucketKey, [
			createBinding("terrain-a", bucketKey, {
				sourceKey: "source:first",
				textureKey: textureKey("texture:shared-terrain"),
			}),
		]);

		expect(() =>
			registry.retainTextureBindings(ownerId("owner:b"), bucketKey, [
				createBinding("terrain-b", bucketKey, {
					sourceKey: "source:second",
					textureKey: textureKey("texture:shared-terrain"),
				}),
			]),
		).toThrow(
			"changed source key from source:first to source:second",
		);
	});

	it("fails loudly when one canonical texture key maps to a conflicting page class", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const bucketKey = createBucketKey("terrain-color");

		registry.retainTextureBindings(ownerId("owner:a"), bucketKey, [
			createBinding("terrain-a", bucketKey, {
				pageClass: pageClass("page-class:first"),
				textureKey: textureKey("texture:shared-terrain"),
			}),
		]);

		expect(() =>
			registry.retainTextureBindings(ownerId("owner:b"), bucketKey, [
				createBinding("terrain-b", bucketKey, {
					pageClass: pageClass("page-class:second"),
					textureKey: textureKey("texture:shared-terrain"),
				}),
			]),
		).toThrow(
			"changed page class from page-class:first to page-class:second",
		);
	});

	it("replaces an owner's full binding set for one bucket", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const bucketKey = createBucketKey("object-base-color");
		const owner = ownerId("owner:object");
		const first = createBinding("first", bucketKey);
		const second = createBinding("second", bucketKey);

		registry.retainTextureBindings(owner, bucketKey, [first]);
		const snapshot = registry.retainTextureBindings(owner, bucketKey, [second]);

		expect(snapshot.entries).toEqual([
			expect.objectContaining({
				bindingIds: [],
				ownerIds: [],
				state: "reclaimable",
				textureKey: textureKey("texture:first"),
			}),
			expect.objectContaining({
				bindingIds: [bindingId("binding:second")],
				ownerIds: [owner],
				state: "claimed",
				textureKey: textureKey("texture:second"),
			}),
		]);
	});

	it("releases all owner claims without deleting entries or pages", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const bucketKey = createBucketKey("terrain-detail");
		const owner = ownerId("owner:terrain");
		const entrySnapshot = registry.retainTextureBindings(owner, bucketKey, [
			createBinding("detail", bucketKey),
		]);
		const page = registry.createPage({
			bucketKey,
			entryIds: [entrySnapshot.entries[0].id],
			state: "resident",
		});

		registry.releaseTextureOwner(owner);
		const snapshot = registry.createBucketSnapshot(bucketKey);

		expect(snapshot.entries).toEqual([
			expect.objectContaining({
				id: entrySnapshot.entries[0].id,
				ownerIds: [],
				state: "reclaimable",
			}),
		]);
		expect(snapshot.pages).toEqual([
			expect.objectContaining({
				id: page.id,
				ownerlessRetainedState: "resident",
				state: "reclaimable",
			}),
		]);
		expect(registry.createSnapshot()).toMatchObject({
			claimCount: 0,
			ownerlessEntryCount: 1,
			ownerlessPageCountByRetainedState: {
				building: 0,
				planned: 0,
				resident: 1,
			},
			ownerlessPagePolicy: {
				pendingRendererRemovalPageCount: 0,
				rendererRemoval: {
					kind: "deferred-until-measured-pressure",
					pressureThresholdBytes: null,
				},
				residentDisposition: "cached-for-reuse",
			},
			pageCountByState: {
				reclaimable: 1,
			},
		});
	});

	it("creates deterministic snapshots for every retained bucket", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const objectBucketKey = createBucketKey("object-base-color");
		const terrainBucketKey = createBucketKey("terrain-color");
		const objectEntrySnapshot = registry.retainTextureBindings(
			ownerId("owner:object"),
			objectBucketKey,
			[createBinding("object", objectBucketKey)],
		);
		const terrainEntrySnapshot = registry.retainTextureBindings(
			ownerId("owner:terrain"),
			terrainBucketKey,
			[createBinding("terrain-color", terrainBucketKey)],
		);
		registry.createPage({
			bucketKey: terrainBucketKey,
			entryIds: [terrainEntrySnapshot.entries[0].id],
		});
		registry.createPage({
			bucketKey: objectBucketKey,
			entryIds: [objectEntrySnapshot.entries[0].id],
		});

		expect(registry.createBucketSnapshots()).toEqual([
			expect.objectContaining({
				bucketKey: objectBucketKey,
				entries: [
					expect.objectContaining({
						textureKey: textureKey("texture:object"),
					}),
				],
				pages: [expect.objectContaining({ bucketKey: objectBucketKey })],
			}),
			expect.objectContaining({
				bucketKey: terrainBucketKey,
				entries: [
					expect.objectContaining({
						textureKey: textureKey("texture:terrain-color"),
					}),
				],
				pages: [expect.objectContaining({ bucketKey: terrainBucketKey })],
			}),
		]);
	});

	it("keeps owner release idempotent and cheap for retained renderer pages", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const bucketKey = createBucketKey("terrain-detail");
		const owner = ownerId("owner:terrain");
		const entrySnapshot = registry.retainTextureBindings(owner, bucketKey, [
			createBinding("detail", bucketKey),
		]);
		registry.createPage({
			bucketKey,
			entryIds: [entrySnapshot.entries[0].id],
			state: "resident",
		});

		registry.releaseTextureOwner(owner);
		const afterFirstRelease = registry.createSnapshot();
		registry.releaseTextureOwner(owner);
		const afterSecondRelease = registry.createSnapshot();

		expect(afterSecondRelease).toEqual(afterFirstRelease);
	});

	it("restores reclaimable pages when their entries are claimed again", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const bucketKey = createBucketKey("terrain-color");
		const owner = ownerId("owner:terrain");
		const binding = createBinding("terrain-color", bucketKey);
		const entrySnapshot = registry.retainTextureBindings(owner, bucketKey, [
			binding,
		]);
		registry.createPage({
			bucketKey,
			entryIds: [entrySnapshot.entries[0].id],
			state: "resident",
		});

		registry.releaseTextureOwner(owner);
		registry.retainTextureBindings(owner, bucketKey, [binding]);

		expect(registry.createBucketSnapshot(bucketKey).pages).toEqual([
			expect.objectContaining({
				ownerlessRetainedState: null,
				state: "resident",
			}),
		]);
	});

	it("settles accepted page builds after owner release as reclaimable retained pages", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const bucketKey = createBucketKey("object-base-color");
		const owner = ownerId("owner:object");
		const snapshot = registry.retainTextureBindings(owner, bucketKey, [
			createBinding("base-color", bucketKey),
		]);
		const page = registry.createPage({
			bucketKey,
			entryIds: [snapshot.entries[0].id],
		});
		const token = registry.reservePageBuild(page.id);

		registry.releaseTextureOwner(owner);

		expect(registry.acceptPageBuild(page.id, token)).toBe("accepted");
		expect(registry.createBucketSnapshot(bucketKey).pages[0]).toMatchObject({
			ownerlessRetainedState: "resident",
			reservationToken: null,
			state: "reclaimable",
		});
		expect(registry.createSnapshot()).toMatchObject({
			pageBuildsInFlight: 0,
			ownerlessPageCountByRetainedState: {
				resident: 1,
			},
		});
	});

	it("keeps bucket page reservations independent", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const terrainBucketKey = createBucketKey("terrain-mask");
		const objectBucketKey = createBucketKey("object-index");
		const terrainSnapshot = registry.retainTextureBindings(
			ownerId("owner:terrain"),
			terrainBucketKey,
			[createBinding("terrain-mask", terrainBucketKey)],
		);
		const objectSnapshot = registry.retainTextureBindings(
			ownerId("owner:object"),
			objectBucketKey,
			[createBinding("object-index", objectBucketKey)],
		);
		const terrainPage = registry.createPage({
			bucketKey: terrainBucketKey,
			entryIds: [terrainSnapshot.entries[0].id],
		});
		const objectPage = registry.createPage({
			bucketKey: objectBucketKey,
			entryIds: [objectSnapshot.entries[0].id],
		});

		const terrainToken = registry.reservePageBuild(terrainPage.id);

		expect(registry.createBucketSnapshot(terrainBucketKey).pages).toEqual([
			expect.objectContaining({
				id: terrainPage.id,
				reservationToken: terrainToken,
				state: "building",
			}),
		]);
		expect(registry.createBucketSnapshot(objectBucketKey).pages).toEqual([
			expect.objectContaining({
				id: objectPage.id,
				reservationToken: null,
				state: "planned",
			}),
		]);
		expect(registry.createSnapshot()).toMatchObject({
			bucketCount: 2,
			claimCount: 2,
			entryCount: 2,
			ownerlessEntryCount: 0,
			ownerlessPageCountByRetainedState: {
				building: 0,
				planned: 0,
				resident: 0,
			},
			pageBuildsInFlight: 1,
			pageCount: 2,
			pageCountByState: {
				building: 1,
				planned: 1,
				reclaimable: 0,
				resident: 0,
			},
		});
	});

	it("rejects stale page build tokens without mutating resident state", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const bucketKey = createBucketKey("object-detail");
		const snapshot = registry.retainTextureBindings(
			ownerId("owner:object"),
			bucketKey,
			[createBinding("detail", bucketKey)],
		);
		const page = registry.createPage({
			bucketKey,
			entryIds: [snapshot.entries[0].id],
		});
		const staleToken = registry.reservePageBuild(page.id);
		const acceptedToken = registry.reservePageBuild(page.id);

		expect(registry.acceptPageBuild(page.id, staleToken)).toBe("stale");
		expect(registry.acceptPageBuild(page.id, acceptedToken)).toBe("accepted");
		expect(registry.createBucketSnapshot(bucketKey).pages[0]).toMatchObject({
			reservationToken: null,
			state: "resident",
		});
	});

	it("exposes reusable entry placement facts after page build reservation", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const bucketKey = createBucketKey("terrain-color");
		const snapshot = registry.retainTextureBindings(
			ownerId("owner:terrain"),
			bucketKey,
			[createBinding("terrain", bucketKey)],
		);
		const entryId = snapshot.entries[0].id;
		const page = registry.createPage({
			bucketKey,
			entryIds: [entryId],
			placements: [{ entryId, rect: [3, 5, 7, 11] }],
			textureHeight: 64,
			textureWidth: 128,
		});

		expect(registry.findReusableEntryPlacement(entryId)).toBeNull();
		const token = registry.reservePageBuild(page.id);

		expect(registry.findReusableEntryPlacement(entryId)).toEqual({
			entryId,
			pageId: page.id,
			pageState: "building",
			rect: [3, 5, 7, 11],
			textureHeight: 64,
			textureRefId: `${page.id}:texture`,
			textureWidth: 128,
		});
		registry.acceptPageBuild(page.id, token);

		expect(registry.findReusableEntryPlacement(entryId)).toEqual({
			entryId,
			pageId: page.id,
			pageState: "resident",
			rect: [3, 5, 7, 11],
			textureHeight: 64,
			textureRefId: `${page.id}:texture`,
			textureWidth: 128,
		});
	});

	it("reports assigned and total texture page pixel counts", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const bucketKey = createBucketKey("terrain-color");
		const snapshot = registry.retainTextureBindings(
			ownerId("owner:terrain"),
			bucketKey,
			[
				createBinding("terrain-a", bucketKey, {
					textureKey: textureKey("texture:terrain-a"),
				}),
				createBinding("terrain-b", bucketKey, {
					textureKey: textureKey("texture:terrain-b"),
				}),
			],
		);
		const [firstEntry, secondEntry] = snapshot.entries;
		if (!firstEntry || !secondEntry) {
			throw new Error("Expected two retained texture entries.");
		}

		registry.createPage({
			bucketKey,
			entryIds: [firstEntry.id, secondEntry.id],
			placements: [
				{ entryId: firstEntry.id, rect: [0, 0, 8, 4] },
				{ entryId: secondEntry.id, rect: [12, 0, 3, 5] },
			],
			textureHeight: 16,
			textureWidth: 32,
		});

		expect(registry.createBucketSnapshot(bucketKey).pages[0]).toMatchObject({
			assignedPixelCount: 47,
			texturePixelCount: 512,
		});
	});

	it("retires accepted noop page builds back to the pre-build state", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const bucketKey = createBucketKey("terrain-color");
		const snapshot = registry.retainTextureBindings(
			ownerId("owner:terrain"),
			bucketKey,
			[createBinding("terrain-color", bucketKey)],
		);
		const page = registry.createPage({
			bucketKey,
			entryIds: [snapshot.entries[0].id],
		});
		const token = registry.reservePageBuild(page.id);

		expect(registry.acceptPageBuildNoop(page.id, token)).toBe("accepted");
		expect(registry.createBucketSnapshot(bucketKey).pages[0]).toMatchObject({
			reservationToken: null,
			state: "planned",
		});
	});

	it("retires rejected page builds back to the pre-build state", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const bucketKey = createBucketKey("object-base-color");
		const snapshot = registry.retainTextureBindings(
			ownerId("owner:object"),
			bucketKey,
			[createBinding("base-color", bucketKey)],
		);
		const page = registry.createPage({
			bucketKey,
			entryIds: [snapshot.entries[0].id],
		});
		const token = registry.reservePageBuild(page.id);

		expect(registry.rejectPageBuild(page.id, token)).toBe("accepted");
		expect(registry.createBucketSnapshot(bucketKey).pages[0]).toMatchObject({
			reservationToken: null,
			state: "planned",
		});
		expect(registry.createSnapshot()).toMatchObject({
			pageBuildsInFlight: 0,
		});
	});

	it("groups pending binding requirements by replacement bucket", () => {
		const terrainBucketKey = createBucketKey("terrain-color");
		const objectBucketKey = createBucketKey("object-palette");
		const grouped = groupTextureBindingRequirementsByBucket([
			createBinding("terrain-a", terrainBucketKey),
			createBinding("object-a", objectBucketKey),
			createBinding("terrain-b", terrainBucketKey),
		]);

		expect([...grouped.keys()]).toEqual([terrainBucketKey, objectBucketKey]);
		expect(
			grouped.get(terrainBucketKey)?.map((binding) => binding.bindingId),
		).toEqual([bindingId("binding:terrain-a"), bindingId("binding:terrain-b")]);
	});

	it("fails loudly when retaining bindings into the wrong bucket", () => {
		const registry = new OpenWorldTextureClaimRegistry();
		const bucketKey = createBucketKey("terrain-color");
		const otherBucketKey = createBucketKey("terrain-detail");

		expect(() =>
			registry.retainTextureBindings(ownerId("owner:terrain"), bucketKey, [
				createBinding("wrong", otherBucketKey),
			]),
		).toThrow(
			"Texture binding binding:wrong belongs to bucket open-world-texture-bucket",
		);
	});
});

function createBucketKey(
	purpose: OpenWorldTextureBindingRequirement["purpose"],
) {
	return createOpenWorldTextureBucketKey({
		domain: "test-domain",
		purpose,
		scope: { kind: "static-domain" },
	});
}

function createBinding(
	name: string,
	bucketKey: ReturnType<typeof createBucketKey>,
	overrides: Partial<OpenWorldTextureBindingRequirement> = {},
): OpenWorldTextureBindingRequirement {
	return {
		bindingId: overrides.bindingId ?? bindingId(`binding:${name}`),
		bucketKey,
		pageClass: overrides.pageClass ?? pageClass(
			`page-class:${name.includes("terrain") ? "terrain" : "object"}`,
		),
		purpose: overrides.purpose ?? purposeFromBucketKey(bucketKey),
		sourceKey: overrides.sourceKey ?? "source:shared",
		textureKey: overrides.textureKey ?? textureKey(
			`texture:${name.replace("-a", "").replace("-b", "")}`,
		),
	};
}

function purposeFromBucketKey(
	bucketKey: ReturnType<typeof createBucketKey>,
): OpenWorldTextureBindingRequirement["purpose"] {
	const purposePart = bucketKey
		.split("|")
		.find((part) => part.startsWith("purpose="));
	if (!purposePart) {
		throw new Error(`Test bucket key is missing purpose: ${bucketKey}.`);
	}
	return purposePart.slice(
		"purpose=".length,
	) as OpenWorldTextureBindingRequirement["purpose"];
}

function bindingId(value: string): TextureBindingId {
	return value as TextureBindingId;
}

function ownerId(value: string): MaterializationOwnerId {
	return value as MaterializationOwnerId;
}

function pageClass(value: string): TexturePageClass {
	return value as TexturePageClass;
}

function textureKey(value: string): TextureKey {
	return value as TextureKey;
}

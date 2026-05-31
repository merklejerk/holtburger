import { describe, expect, it } from "vitest";

import {
	createEmptyAtlasStaticCompactionPlan,
	planAtlasStaticCompaction,
	type AtlasStaticCompactionCandidate,
} from "./atlas-static-compaction-planner";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import type { StagedWorldMaterialAtlasEligibility } from "./staged-world-material-strategy";

describe("atlas static compaction planner", () => {
	it("plans exterior opaque static direct-texture units into deterministic atlas slices", () => {
		const plan = planAtlasStaticCompaction({
			drawUnits: [
				createCandidate({ id: "static-b", entryKey: "entry-b" }),
				createCandidate({ id: "static-a", entryKey: "entry-a" }),
			],
			policy: {
				maxAtlasTextureSize: 32,
				maxAtlasTextureCount: 1,
				baseGutterPixels: 2,
				maxMaterialSlotsPerDraw: 4,
			},
		});

		expect(plan.compactableDrawUnitIds).toEqual(["static-b", "static-a"]);
		expect(plan.bypasses).toEqual([]);
		expect(
			plan.atlasTextures[0]?.placements.map((entry) => entry.atlasEntryKey),
		).toEqual(["entry-a", "entry-b"]);
		expect(plan.materialSlots.map((slot) => slot.key)).toEqual([
			"slot-entry-a",
			"slot-entry-b",
		]);
		expect(plan.drawSlices).toMatchObject([
			{
				atlasTextureIndex: 0,
				materialTableSlotStart: 0,
				materialTableSlotCount: 2,
				drawUnitIds: ["static-a", "static-b"],
			},
		]);
		expect(plan.staticPartCount).toBe(2);
		expect(plan.triangleCount).toBe(4);
		expect(plan.preparedTextureAssetIds).toEqual([
			"prepared-texture/entry-a",
			"prepared-texture/entry-b",
		]);
	});

	it("keeps unsupported first-slice materials on the staged path with reasons", () => {
		const plan = planAtlasStaticCompaction({
			drawUnits: [
				createCandidate({ id: "interior", sceneDomain: "interior" }),
				createCandidate({ id: "indexed", materialKind: "indexed-paletted" }),
				createCandidate({ id: "detail", hasDetailOverlay: true }),
				createCandidate({
					id: "clip",
					materialBehavior: { ...OPAQUE_BEHAVIOR, alphaTest: 0.5 },
				}),
				createCandidate({ id: "missing-entry", atlasEligibility: null }),
			],
			policy: {
				maxAtlasTextureSize: 32,
				maxAtlasTextureCount: 1,
				baseGutterPixels: 2,
				maxMaterialSlotsPerDraw: 4,
			},
		});

		expect(plan.compactableDrawUnitIds).toEqual([]);
		expect(plan.bypasses.map((bypass) => bypass.reason)).toEqual([
			"non-exterior-domain",
			"non-direct-texture",
			"detail-overlay",
			"non-opaque-material",
			"missing-atlas-eligibility",
		]);
	});

	it("reports source texture and material table overflow before GPU resources exist", () => {
		const plan = planAtlasStaticCompaction({
			drawUnits: [
				createCandidate({
					id: "too-big",
					entryKey: "too-big",
					width: 128,
					height: 8,
				}),
				createCandidate({ id: "slot-a", entryKey: "slot-a" }),
				createCandidate({ id: "slot-b", entryKey: "slot-b" }),
			],
			policy: {
				maxAtlasTextureSize: 64,
				maxAtlasTextureCount: 1,
				baseGutterPixels: 2,
				maxMaterialSlotsPerDraw: 1,
			},
		});

		expect(plan.compactableDrawUnitIds).toEqual(["slot-a"]);
		expect(plan.bypasses.map((bypass) => bypass.reason)).toEqual([
			"source-texture-too-large",
			"material-table-overflow",
		]);
	});

	it("creates an empty plan for store initialization", () => {
		expect(createEmptyAtlasStaticCompactionPlan()).toMatchObject({
			key: "atlas-static-compaction/empty",
			compactableDrawUnitIds: [],
			atlasTextures: [],
			drawSlices: [],
		});
	});
});

const OPAQUE_BEHAVIOR: LegacyMaterialBehaviorDto = {
	color: [1, 1, 1],
	emissive: [0, 0, 0],
	emissiveIntensity: 0,
	opacity: 1,
	transparent: false,
	alphaTest: 0,
	side: "front",
	blend: {
		mode: "opaque",
		enabled: false,
		srcFactor: null,
		dstFactor: null,
		depthWrite: true,
	},
	unsupportedSurfaceFlags: [],
};

function createCandidate(
	options: Partial<AtlasStaticCompactionCandidate> & {
		entryKey?: string;
		width?: number;
		height?: number;
	} = {},
): AtlasStaticCompactionCandidate {
	const entryKey = options.entryKey ?? "entry";
	return {
		id: options.id ?? "static",
		kind: options.kind ?? "static",
		owningLandblockId: options.owningLandblockId ?? 0x0102ffff,
		sceneDomain: options.sceneDomain ?? "exterior",
		materialKind: options.materialKind ?? "direct-texture",
		materialKey: options.materialKey ?? `material-${entryKey}`,
		materialBehavior: options.materialBehavior ?? OPAQUE_BEHAVIOR,
		hasUvBuffer: options.hasUvBuffer ?? true,
		hasDetailOverlay: options.hasDetailOverlay ?? false,
		atlasEligibility:
			options.atlasEligibility === undefined
				? createAtlasEligibility({
						entryKey,
						width: options.width ?? 8,
						height: options.height ?? 8,
					})
				: options.atlasEligibility,
		triangleCount: options.triangleCount ?? 2,
		staticPartCount: options.staticPartCount ?? 1,
		staticObjectKeys: options.staticObjectKeys ?? [`object-${entryKey}`],
	};
}

function createAtlasEligibility(options: {
	entryKey: string;
	width: number;
	height: number;
}): StagedWorldMaterialAtlasEligibility {
	return {
		materialSlotKey: `slot-${options.entryKey}`,
		atlasEntryKey: options.entryKey,
		renderStateKey:
			"shader=atlas-color;blend=opaque;depth=write;alphaTest=0;side=front",
		samplingKey:
			"wrap=vertex;filter=linear/linear/linear;color=linear;mips=atlas",
		atlasEntry: {
			renderSurfaceId: 0x06000001,
			preparedTextureAssetId: `prepared-texture/${options.entryKey}`,
			level: {
				level: 0,
				width: options.width,
				height: options.height,
				formatRaw: 0x15,
				format: "A8R8G8B8",
				byteLength: options.width * options.height * 4,
				bytes: new Uint8Array(options.width * options.height * 4),
			},
			sourceHash: options.entryKey,
			sourceFormatRaw: 0x3154_5844,
		},
	};
}

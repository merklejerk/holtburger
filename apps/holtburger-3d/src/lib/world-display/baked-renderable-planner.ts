import { planAtlasLayout, type AtlasTexturePage } from "./atlas-layout-planner";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import type { StagedWorldMaterialAtlasEligibility } from "./staged-world-material-strategy";
import type { TexturePageBinding } from "./texture-page-binding";
import type { Webgl2SceneDomain } from "./webgl2-scene-domain-targets";

export type BakedRenderableBypassReason =
	| "non-static"
	| "missing-landblock-origin"
	| "unsupported-baked-material-family"
	| "missing-uv-buffer"
	| "missing-atlas-eligibility"
	| "unsupported-alpha-test-material"
	| "unsupported-transparent-blended-material"
	| "unsupported-opacity-translucent-material"
	| "unsupported-constant-color-material"
	| "unsupported-indexed-paletted-material"
	| "unsupported-indexed-texture-page-policy"
	| "indexed-alpha-policy-unsupported"
	| "unsupported-terrain-material"
	| "debug-pipeline-material"
	| "unsupported-material-state"
	| "detail-overlay"
	| "missing-detail-atlas-entry"
	| "source-texture-too-large"
	| "atlas-full"
	| "detail-atlas-full"
	| "material-table-overflow";

export type BakeMaterialKind =
	| "flat"
	| "direct-texture"
	| "indexed-paletted"
	| "terrain-blend";

export type BakeMaterialFamily =
	| "flat-constant-color"
	| "textured-opaque"
	| "alpha-test"
	| "transparent-blended"
	| "opacity-translucent"
	| "indexed-paletted"
	| "terrain-blend"
	| "debug-pipeline"
	| "unknown-unsupported";

export type BakeAlphaPolicy =
	| "opaque"
	| "cutout"
	| "transparent-blend"
	| "opacity-translucent"
	| "unknown";

export type BakeMaterialBlocker =
	| "missing-base-texture-page"
	| "missing-indexed-texel-page"
	| "missing-indexed-palette-page"
	| "missing-atlas-eligibility"
	| "missing-baked-constant-color-family"
	| "missing-baked-indexed-paletted-family"
	| "indexed-alpha-policy-unsupported"
	| "missing-baked-alpha-test-family"
	| "missing-baked-transparent-blended-family"
	| "missing-baked-opacity-translucent-family"
	| "missing-baked-terrain-family"
	| "debug-pipeline-material"
	| "missing-detail-atlas-entry"
	| "unsupported-material-state"
	| "unsupported-texture-page-behavior";

export type BakeGeometryBlocker =
	| "non-static"
	| "missing-landblock-origin"
	| "missing-uv-buffer";

export interface BakeEligibility {
	decision: "baked" | "direct-draw";
	material: {
		family: BakeMaterialFamily;
		compatible: boolean;
		blockers: readonly BakeMaterialBlocker[];
		alphaPolicy: BakeAlphaPolicy;
		atlasEligibility: StagedWorldMaterialAtlasEligibility | null;
		detailAtlasEntry: BakedRenderableDetailEntry | null;
	};
	geometry: {
		compatible: boolean;
		blockers: readonly BakeGeometryBlocker[];
	};
}

export interface BakedRenderablePolicy {
	maxAtlasTextureSize: number;
	maxAtlasTextureCount: number;
	baseGutterPixels: number;
	maxMaterialSlotsPerDraw: number;
}

export interface BakedRenderableCandidate {
	id: string;
	kind: string;
	owningLandblockId: number | null;
	sceneDomain: Webgl2SceneDomain | null;
	materialKind: BakeMaterialKind;
	materialKey: string;
	detailAtlasEntry: BakedRenderableDetailEntry | null;
	bakeEligibility: BakeEligibility;
	triangleCount: number;
	staticPartCount: number;
	staticObjectKeys: readonly string[];
}

export interface BakedRenderableBypass {
	drawUnitId: string;
	reason: BakedRenderableBypassReason;
	detail: string;
}

export interface BakedRenderableMaterialSlot {
	key: string;
	sourceMaterialSlotKey: string;
	index: number;
	renderStateKey: string;
	samplingKey: string;
	samplingPolicy: StagedWorldMaterialAtlasEligibility["samplingPolicy"];
	atlasEntryKey: string;
	detailAtlasEntryKey: string | null;
	detailTiling: number;
}

export interface BakedRenderableDrawSlice {
	key: string;
	atlasTextureIndex: number;
	detailAtlasTextureIndex: number | null;
	renderStateKey: string;
	materialTableSlotStart: number;
	materialTableSlotCount: number;
	materialSlotKeys: readonly string[];
	drawUnitIds: readonly string[];
}

export interface BakedRenderableEntry {
	key: string;
	entry: StagedWorldMaterialAtlasEligibility["atlasEntry"];
}

export interface BakedRenderableDetailEntry {
	key: string;
	renderSurfaceId: number;
	sourceFormatRaw: number;
	width: number;
	height: number;
	bytes: Uint8Array;
	format: "rgba8";
	tiling: number;
	blendMode: "dst-color";
}

export interface BakedRenderablePlan {
	key: string;
	compactableDrawUnitIds: readonly string[];
	bypasses: readonly BakedRenderableBypass[];
	atlasEntryRecords: readonly BakedRenderableEntry[];
	atlasEntries: readonly StagedWorldMaterialAtlasEligibility["atlasEntry"][];
	atlasTextures: readonly AtlasTexturePage[];
	detailAtlasEntryRecords: readonly BakedRenderableDetailEntry[];
	detailAtlasTextures: readonly AtlasTexturePage[];
	materialSlots: readonly BakedRenderableMaterialSlot[];
	drawUnitMaterialSlots: readonly {
		drawUnitId: string;
		materialSlotKey: string;
	}[];
	drawSlices: readonly BakedRenderableDrawSlice[];
	staticObjectKeys: readonly string[];
	staticPartCount: number;
	triangleCount: number;
	preparedTextureAssetIds: readonly string[];
}

interface EligibleBakedRenderableCandidate {
	drawUnit: BakedRenderableCandidate;
	eligibility: StagedWorldMaterialAtlasEligibility;
}

interface BakedRenderableEntryRecord {
	key: string;
	entry: StagedWorldMaterialAtlasEligibility["atlasEntry"];
}

export function createEmptyBakedRenderablePlan(): BakedRenderablePlan {
	return {
		key: "baked-renderables/empty",
		compactableDrawUnitIds: [],
		bypasses: [],
		atlasEntryRecords: [],
		atlasEntries: [],
		atlasTextures: [],
		detailAtlasEntryRecords: [],
		detailAtlasTextures: [],
		materialSlots: [],
		drawUnitMaterialSlots: [],
		drawSlices: [],
		staticObjectKeys: [],
		staticPartCount: 0,
		triangleCount: 0,
		preparedTextureAssetIds: [],
	};
}

export function planBakedRenderables(options: {
	drawUnits: readonly BakedRenderableCandidate[];
	policy: BakedRenderablePolicy;
}): BakedRenderablePlan {
	const eligible: EligibleBakedRenderableCandidate[] = [];
	const bypasses: BakedRenderableBypass[] = [];
	for (const drawUnit of options.drawUnits) {
		const bypass = classifyBakedRenderableBypass(drawUnit);
		if (bypass) {
			bypasses.push(bypass);
			continue;
		}
		const atlasEligibility = drawUnit.bakeEligibility.material.atlasEligibility;
		if (!atlasEligibility) {
			throw new Error(
				`Baked geometry candidate ${drawUnit.id} was accepted without packed texture-page eligibility.`,
			);
		}
		eligible.push({ drawUnit, eligibility: atlasEligibility });
	}

	const atlasEntries = dedupeBakedRenderableEntries(eligible);
	const layout = planAtlasLayout({
		entries: atlasEntries.map((record) => ({
			key: record.key,
			width: record.entry.level.width,
			height: record.entry.level.height,
		})),
		policy: {
			maxTextureSize: options.policy.maxAtlasTextureSize,
			maxTextureCount: options.policy.maxAtlasTextureCount,
			gutterPixels: options.policy.baseGutterPixels,
		},
	});
	const placed = eligible.filter((candidate) =>
		layout.placementsByEntryKey.has(candidate.eligibility.atlasEntryKey),
	);
	for (const candidate of eligible) {
		const overflow = layout.overflowsByEntryKey.get(
			candidate.eligibility.atlasEntryKey,
		);
		if (!overflow) {
			continue;
		}
		bypasses.push({
			drawUnitId: candidate.drawUnit.id,
			reason:
				overflow.reason === "source-too-large"
					? "source-texture-too-large"
					: "atlas-full",
			detail: overflow.detail,
		});
	}

	const detailEntries = dedupeBakedRenderableDetailEntries(placed);
	const detailLayout = planAtlasLayout({
		entries: detailEntries.map((entry) => ({
			key: entry.key,
			width: entry.width,
			height: entry.height,
		})),
		policy: {
			maxTextureSize: options.policy.maxAtlasTextureSize,
			maxTextureCount: options.policy.maxAtlasTextureCount,
			gutterPixels: options.policy.baseGutterPixels,
		},
	});
	const detailPlaced = placed.filter((candidate) => {
		const detailEntryKey = candidate.drawUnit.detailAtlasEntry?.key ?? null;
		return (
			detailEntryKey === null ||
			detailLayout.placementsByEntryKey.has(detailEntryKey)
		);
	});
	for (const candidate of placed) {
		const detailEntryKey = candidate.drawUnit.detailAtlasEntry?.key ?? null;
		if (detailEntryKey === null) {
			continue;
		}
		const overflow = detailLayout.overflowsByEntryKey.get(detailEntryKey);
		if (!overflow) {
			continue;
		}
		bypasses.push({
			drawUnitId: candidate.drawUnit.id,
			reason: "detail-atlas-full",
			detail: overflow.detail,
		});
	}

	const materialSlots = assignBakedRenderableMaterialSlots(
		detailPlaced,
		options.policy,
	);
	const materialSlotByKey = new Map(
		materialSlots.map((slot) => [slot.key, slot] as const),
	);
	const compactable = detailPlaced.filter((candidate) => {
		if (materialSlotByKey.has(describeCompactionMaterialSlotKey(candidate))) {
			return true;
		}
		bypasses.push({
			drawUnitId: candidate.drawUnit.id,
			reason: "material-table-overflow",
			detail: `material table exceeded ${options.policy.maxMaterialSlotsPerDraw} slots`,
		});
		return false;
	});
	const drawSlices = createBakedRenderableDrawSlices(
		compactable,
		materialSlotByKey,
		layout.placementsByEntryKey,
		detailLayout.placementsByEntryKey,
	);
	const compactableDrawUnitIds = compactable.map(
		(candidate) => candidate.drawUnit.id,
	);
	const compactableEntryKeys = new Set(
		compactable.map((candidate) => candidate.eligibility.atlasEntryKey),
	);
	return {
		key: describeBakedRenderablePlanKey({
			policy: options.policy,
			atlasEntryKeys: [...compactableEntryKeys].sort(),
			detailAtlasEntryKeys: detailEntries
				.filter((entry) =>
					compactable.some(
						(candidate) =>
							candidate.drawUnit.detailAtlasEntry?.key === entry.key,
					),
				)
				.map((entry) => entry.key),
			materialSlotKeys: materialSlots.map((slot) => slot.key),
		}),
		compactableDrawUnitIds,
		bypasses,
		atlasEntryRecords: atlasEntries.filter((record) =>
			compactableEntryKeys.has(record.key),
		),
		atlasEntries: atlasEntries
			.filter((record) => compactableEntryKeys.has(record.key))
			.map((record) => record.entry),
		atlasTextures: layout.texturePages
			.map((page) => ({
				...page,
				placements: page.placements.filter((placement) =>
					compactableEntryKeys.has(placement.atlasEntryKey),
				),
			}))
			.filter((page) => page.placements.length > 0),
		detailAtlasEntryRecords: detailEntries.filter((entry) =>
			compactable.some(
				(candidate) => candidate.drawUnit.detailAtlasEntry?.key === entry.key,
			),
		),
		detailAtlasTextures: detailLayout.texturePages
			.map((page) => ({
				...page,
				placements: page.placements.filter((placement) =>
					compactable.some(
						(candidate) =>
							candidate.drawUnit.detailAtlasEntry?.key ===
							placement.atlasEntryKey,
					),
				),
			}))
			.filter((page) => page.placements.length > 0),
		materialSlots,
		drawUnitMaterialSlots: compactable.map((candidate) => ({
			drawUnitId: candidate.drawUnit.id,
			materialSlotKey: describeCompactionMaterialSlotKey(candidate),
		})),
		drawSlices,
		staticObjectKeys: uniqueSortedStrings(
			compactable.flatMap((candidate) => candidate.drawUnit.staticObjectKeys),
		),
		staticPartCount: compactable.reduce(
			(total, candidate) => total + candidate.drawUnit.staticPartCount,
			0,
		),
		triangleCount: compactable.reduce(
			(total, candidate) => total + candidate.drawUnit.triangleCount,
			0,
		),
		preparedTextureAssetIds: uniqueSortedStrings(
			compactable.map(
				(candidate) => candidate.eligibility.atlasEntry.preparedTextureAssetId,
			),
		),
	};
}

function classifyBakedRenderableBypass(
	drawUnit: BakedRenderableCandidate,
): BakedRenderableBypass | null {
	const geometryBlocker = drawUnit.bakeEligibility.geometry.blockers[0] ?? null;
	if (geometryBlocker) {
		return createGeometryBakeBypass(drawUnit, geometryBlocker);
	}
	const materialBlocker = drawUnit.bakeEligibility.material.blockers[0] ?? null;
	if (materialBlocker) {
		return createMaterialBakeBypass(drawUnit, materialBlocker);
	}
	return null;
}

export function createBakeEligibility(options: {
	kind: string;
	owningLandblockId: number | null;
	materialKind: BakeMaterialKind;
	hasUvBuffer: boolean;
	texturePageBindings: readonly TexturePageBinding[];
	materialBehavior: LegacyMaterialBehaviorDto | null;
	hasDetailOverlay: boolean;
	detailAtlasEntry: BakedRenderableDetailEntry | null;
	atlasEligibility: StagedWorldMaterialAtlasEligibility | null;
}): BakeEligibility {
	const geometryBlockers: BakeGeometryBlocker[] = [];
	if (options.kind !== "static" && options.kind !== "structured-interior") {
		geometryBlockers.push("non-static");
	}
	if (options.owningLandblockId === null) {
		geometryBlockers.push("missing-landblock-origin");
	}
	if (!options.hasUvBuffer) {
		geometryBlockers.push("missing-uv-buffer");
	}

	const materialFamily = classifyBakeMaterialFamily({
		drawUnitKind: options.kind,
		materialKind: options.materialKind,
		materialBehavior: options.materialBehavior,
	});
	const alphaPolicy = classifyBakeAlphaPolicy(options.materialBehavior);
	const materialBlockers: BakeMaterialBlocker[] = [];
	switch (materialFamily) {
		case "flat-constant-color":
			materialBlockers.push("missing-baked-constant-color-family");
			break;
		case "indexed-paletted":
			if (!hasIndexedTexelTexturePage(options.texturePageBindings)) {
				materialBlockers.push("missing-indexed-texel-page");
			}
			if (!hasIndexedPaletteTexturePage(options.texturePageBindings)) {
				materialBlockers.push("missing-indexed-palette-page");
			}
			if (
				!hasOnlySupportedIndexedTexturePageBehavior(options.texturePageBindings)
			) {
				materialBlockers.push("unsupported-texture-page-behavior");
			}
			materialBlockers.push("missing-baked-indexed-paletted-family");
			if (alphaPolicy !== "opaque") {
				materialBlockers.push("indexed-alpha-policy-unsupported");
			}
			break;
		case "terrain-blend":
			materialBlockers.push("missing-baked-terrain-family");
			break;
		case "debug-pipeline":
			materialBlockers.push("debug-pipeline-material");
			break;
		case "alpha-test":
			materialBlockers.push("missing-baked-alpha-test-family");
			break;
		case "transparent-blended":
			materialBlockers.push("missing-baked-transparent-blended-family");
			break;
		case "opacity-translucent":
			materialBlockers.push("missing-baked-opacity-translucent-family");
			break;
		case "unknown-unsupported":
			materialBlockers.push("unsupported-material-state");
			break;
		case "textured-opaque":
			if (!options.atlasEligibility) {
				materialBlockers.push("missing-atlas-eligibility");
			}
			if (!hasCompatibleBakedBaseTexturePage(options.texturePageBindings)) {
				materialBlockers.push("missing-base-texture-page");
			}
			if (options.hasDetailOverlay && !options.detailAtlasEntry) {
				materialBlockers.push("missing-detail-atlas-entry");
			}
			if (
				!hasOnlySupportedBakedTexturePageBehavior(options.texturePageBindings)
			) {
				materialBlockers.push("unsupported-texture-page-behavior");
			}
			break;
	}

	const geometryCompatible = geometryBlockers.length === 0;
	const materialCompatible = materialBlockers.length === 0;
	return {
		decision:
			geometryCompatible && materialCompatible ? "baked" : "direct-draw",
		material: {
			family: materialFamily,
			compatible: materialCompatible,
			blockers: materialBlockers,
			alphaPolicy,
			atlasEligibility: options.atlasEligibility,
			detailAtlasEntry: options.detailAtlasEntry,
		},
		geometry: {
			compatible: geometryCompatible,
			blockers: geometryBlockers,
		},
	};
}

function createGeometryBakeBypass(
	drawUnit: BakedRenderableCandidate,
	blocker: BakeGeometryBlocker,
): BakedRenderableBypass {
	switch (blocker) {
		case "non-static":
			return {
				drawUnitId: drawUnit.id,
				reason: "non-static",
				detail: `draw unit kind ${drawUnit.kind} is not baked geometry`,
			};
		case "missing-landblock-origin":
			return {
				drawUnitId: drawUnit.id,
				reason: "missing-landblock-origin",
				detail: "baked geometry draw unit has no owning landblock",
			};
		case "missing-uv-buffer":
			return {
				drawUnitId: drawUnit.id,
				reason: "missing-uv-buffer",
				detail: "baked geometry draw unit has no UV buffer",
			};
	}
}

function createMaterialBakeBypass(
	drawUnit: BakedRenderableCandidate,
	blocker: BakeMaterialBlocker,
): BakedRenderableBypass {
	switch (blocker) {
		case "missing-baked-constant-color-family":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-constant-color-material",
				detail: `flat/solid material ${drawUnit.materialKey} has no baked constant-color material family`,
			};
		case "missing-baked-indexed-paletted-family":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-indexed-paletted-material",
				detail: `indexed/paletted material ${drawUnit.materialKey} has no baked indexed material family`,
			};
		case "missing-indexed-texel-page":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-indexed-texture-page-policy",
				detail: `indexed/paletted material ${drawUnit.materialKey} has no indexed texel texture-page binding`,
			};
		case "missing-indexed-palette-page":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-indexed-texture-page-policy",
				detail: `indexed/paletted material ${drawUnit.materialKey} has no palette texture-page binding`,
			};
		case "indexed-alpha-policy-unsupported":
			return {
				drawUnitId: drawUnit.id,
				reason: "indexed-alpha-policy-unsupported",
				detail: `indexed/paletted material ${drawUnit.materialKey} has alpha policy that is not supported by the baked indexed path`,
			};
		case "missing-baked-alpha-test-family":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-alpha-test-material",
				detail: `alpha-test material ${drawUnit.materialKey} has no baked cutout material family`,
			};
		case "missing-baked-transparent-blended-family":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-transparent-blended-material",
				detail: `blended material ${drawUnit.materialKey} has no baked transparent material family`,
			};
		case "missing-baked-opacity-translucent-family":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-opacity-translucent-material",
				detail: `opacity/translucent material ${drawUnit.materialKey} has no baked translucent material family`,
			};
		case "missing-baked-terrain-family":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-terrain-material",
				detail: `terrain material ${drawUnit.materialKey} belongs to the terrain pipeline`,
			};
		case "debug-pipeline-material":
			return {
				drawUnitId: drawUnit.id,
				reason: "debug-pipeline-material",
				detail: `debug/portal material ${drawUnit.materialKey} is outside the production baked path`,
			};
		case "missing-base-texture-page":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-baked-material-family",
				detail: `draw unit material ${drawUnit.materialKey} has no baked-compatible base texture page`,
			};
		case "missing-atlas-eligibility":
			return {
				drawUnitId: drawUnit.id,
				reason: "missing-atlas-eligibility",
				detail: "baked geometry draw unit has no packed texture-page eligibility",
			};
		case "missing-detail-atlas-entry":
			return {
				drawUnitId: drawUnit.id,
				reason: "missing-detail-atlas-entry",
				detail: "detail overlay has no compactable RGBA8 detail atlas entry",
			};
		case "unsupported-material-state":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-material-state",
				detail: `material ${drawUnit.materialKey} is not supported by any current baked material family`,
			};
		case "unsupported-texture-page-behavior":
			return {
				drawUnitId: drawUnit.id,
				reason: "unsupported-baked-material-family",
				detail: "texture-page bindings require a baked shader family that is not implemented",
			};
	}
}

export function classifyBakeMaterialFamily(options: {
	drawUnitKind: string;
	materialKind: BakeMaterialKind;
	materialBehavior: LegacyMaterialBehaviorDto | null;
}): BakeMaterialFamily {
	if (options.drawUnitKind === "portal-mask") {
		return "debug-pipeline";
	}
	switch (options.materialKind) {
		case "flat":
			return "flat-constant-color";
		case "indexed-paletted":
			return "indexed-paletted";
		case "terrain-blend":
			return "terrain-blend";
		case "direct-texture":
			return classifyDirectTextureBakeMaterialFamily(
				options.materialBehavior,
			);
	}
}

function classifyDirectTextureBakeMaterialFamily(
	behavior: LegacyMaterialBehaviorDto | null,
): BakeMaterialFamily {
	const alphaPolicy = classifyBakeAlphaPolicy(behavior);
	switch (alphaPolicy) {
		case "cutout":
			return "alpha-test";
		case "transparent-blend":
			return "transparent-blended";
		case "opacity-translucent":
			return "opacity-translucent";
		case "unknown":
			return "unknown-unsupported";
		case "opaque":
			return "textured-opaque";
	}
}

export function classifyBakeAlphaPolicy(
	behavior: LegacyMaterialBehaviorDto | null,
): BakeAlphaPolicy {
	if (behavior === null) {
		return "unknown";
	}
	if (behavior.alphaTest > 0) {
		return "cutout";
	}
	if (behavior.blend.enabled) {
		return "transparent-blend";
	}
	if (behavior.transparent || behavior.opacity < 1) {
		return "opacity-translucent";
	}
	return "opaque";
}

function hasCompatibleBakedBaseTexturePage(
	texturePageBindings: readonly TexturePageBinding[],
): boolean {
	return texturePageBindings.some(
		(binding) =>
			binding.usageBucket === "base-color" &&
			binding.sampleClass === "rgba-color" &&
			binding.sampling.samplingDomain === "color" &&
			binding.sampling.lookup === "color-filtered",
	);
}

function hasIndexedTexelTexturePage(
	texturePageBindings: readonly TexturePageBinding[],
): boolean {
	return texturePageBindings.some(
		(binding) =>
			binding.usageBucket === "indexed-texels" &&
			binding.sampleClass === "indexed-data" &&
			hasExactDataTexturePageSampling(binding),
	);
}

function hasIndexedPaletteTexturePage(
	texturePageBindings: readonly TexturePageBinding[],
): boolean {
	return texturePageBindings.some(
		(binding) =>
			binding.usageBucket === "palette-lookup" &&
			binding.sampleClass === "palette-data" &&
			hasExactDataTexturePageSampling(binding),
	);
}

function hasOnlySupportedIndexedTexturePageBehavior(
	texturePageBindings: readonly TexturePageBinding[],
): boolean {
	return texturePageBindings.every((binding) => {
		if (
			binding.usageBucket === "indexed-texels" &&
			binding.sampleClass === "indexed-data"
		) {
			return hasExactDataTexturePageSampling(binding);
		}
		if (
			binding.usageBucket === "palette-lookup" &&
			binding.sampleClass === "palette-data"
		) {
			return hasExactDataTexturePageSampling(binding);
		}
		return false;
	});
}

function hasExactDataTexturePageSampling(binding: TexturePageBinding): boolean {
	return (
		binding.sampling.samplingDomain === "data" &&
		binding.sampling.lookup === "exact" &&
		binding.sampling.minFilter === "nearest" &&
		binding.sampling.magFilter === "nearest" &&
		binding.sampling.mip === "none"
	);
}

function hasOnlySupportedBakedTexturePageBehavior(
	texturePageBindings: readonly TexturePageBinding[],
): boolean {
	return texturePageBindings.every((binding) => {
		if (
			binding.usageBucket === "base-color" ||
			binding.usageBucket === "detail"
		) {
			return (
				binding.sampleClass === "rgba-color" &&
				binding.sampling.samplingDomain === "color" &&
				binding.sampling.lookup === "color-filtered"
			);
		}
		return false;
	});
}

function isOpaqueStaticCompactionMaterial(
	behavior: LegacyMaterialBehaviorDto | null,
): boolean {
	return (
		behavior !== null &&
		!behavior.transparent &&
		!behavior.blend.enabled &&
		behavior.alphaTest <= 0 &&
		behavior.opacity >= 1
	);
}

function dedupeBakedRenderableEntries(
	candidates: readonly EligibleBakedRenderableCandidate[],
): BakedRenderableEntryRecord[] {
	const entriesByKey = new Map<string, BakedRenderableEntryRecord>();
	for (const candidate of candidates) {
		entriesByKey.set(candidate.eligibility.atlasEntryKey, {
			key: candidate.eligibility.atlasEntryKey,
			entry: candidate.eligibility.atlasEntry,
		});
	}
	return [...entriesByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function dedupeBakedRenderableDetailEntries(
	candidates: readonly EligibleBakedRenderableCandidate[],
): BakedRenderableDetailEntry[] {
	const entriesByKey = new Map<string, BakedRenderableDetailEntry>();
	for (const candidate of candidates) {
		const detailEntry = candidate.drawUnit.detailAtlasEntry;
		if (detailEntry) {
			entriesByKey.set(detailEntry.key, detailEntry);
		}
	}
	return [...entriesByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function assignBakedRenderableMaterialSlots(
	candidates: readonly EligibleBakedRenderableCandidate[],
	policy: BakedRenderablePolicy,
): BakedRenderableMaterialSlot[] {
	return [
		...new Map(
			candidates.map(
				(candidate) =>
					[
						describeCompactionMaterialSlotKey(candidate),
						candidate.eligibility,
					] as const,
			),
		).entries(),
	]
		.sort(([left], [right]) => left.localeCompare(right))
		.slice(0, policy.maxMaterialSlotsPerDraw)
		.map(([key, eligibility], index) => ({
			key,
			sourceMaterialSlotKey: eligibility.materialSlotKey,
			index,
			renderStateKey: eligibility.renderStateKey,
			samplingKey: eligibility.samplingKey,
			samplingPolicy: eligibility.samplingPolicy,
			atlasEntryKey: eligibility.atlasEntryKey,
			...describeBakedRenderableDetailSlot(candidates, key),
		}));
}

function describeBakedRenderableDetailSlot(
	candidates: readonly EligibleBakedRenderableCandidate[],
	materialSlotKey: string,
): Pick<
	BakedRenderableMaterialSlot,
	"detailAtlasEntryKey" | "detailTiling"
> {
	const detailEntries = [
		...new Map(
			candidates
				.filter(
					(candidate) =>
						describeCompactionMaterialSlotKey(candidate) === materialSlotKey,
				)
				.map((candidate) => candidate.drawUnit.detailAtlasEntry)
				.filter(
					(entry): entry is BakedRenderableDetailEntry =>
						entry !== null && entry !== undefined,
				)
				.map((entry) => [entry.key, entry] as const),
		).values(),
	];
	if (detailEntries.length > 1) {
		throw new Error(
			`Baked geometry material slot ${materialSlotKey} has multiple detail atlas entries.`,
		);
	}
	const detailEntry = detailEntries[0] ?? null;
	return {
		detailAtlasEntryKey: detailEntry?.key ?? null,
		detailTiling: detailEntry?.tiling ?? 1,
	};
}

function describeCompactionMaterialSlotKey(
	candidate: EligibleBakedRenderableCandidate,
): string {
	return [
		candidate.eligibility.materialSlotKey,
		`wrap=${candidate.eligibility.samplingPolicy.wrapS}/${candidate.eligibility.samplingPolicy.wrapT}`,
		`detail=${candidate.drawUnit.detailAtlasEntry?.key ?? "none"}`,
	].join("|");
}

function createBakedRenderableDrawSlices(
	candidates: readonly EligibleBakedRenderableCandidate[],
	materialSlotByKey: ReadonlyMap<string, BakedRenderableMaterialSlot>,
	placementsByEntryKey: ReadonlyMap<string, { textureIndex: number }>,
	detailPlacementsByEntryKey: ReadonlyMap<string, { textureIndex: number }>,
): BakedRenderableDrawSlice[] {
	const groups = new Map<
		string,
		{
			atlasTextureIndex: number;
			detailAtlasTextureIndex: number | null;
			renderStateKey: string;
			slotIndices: number[];
			materialSlotKeys: Set<string>;
			drawUnitIds: string[];
		}
	>();
	for (const candidate of candidates) {
		const slot = materialSlotByKey.get(
			describeCompactionMaterialSlotKey(candidate),
		);
		if (!slot) {
			continue;
		}
		const atlasTextureIndex =
			placementsByEntryKey.get(candidate.eligibility.atlasEntryKey)
				?.textureIndex ?? 0;
		const detailAtlasTextureIndex = slot.detailAtlasEntryKey
			? (detailPlacementsByEntryKey.get(slot.detailAtlasEntryKey)
					?.textureIndex ?? null)
			: null;
		const key = [
			atlasTextureIndex,
			detailAtlasTextureIndex ?? "no-detail",
			slot.renderStateKey,
		].join("|");
		const group = groups.get(key) ?? {
			atlasTextureIndex,
			detailAtlasTextureIndex,
			renderStateKey: slot.renderStateKey,
			slotIndices: [],
			materialSlotKeys: new Set<string>(),
			drawUnitIds: [],
		};
		group.slotIndices.push(slot.index);
		group.materialSlotKeys.add(slot.key);
		group.drawUnitIds.push(candidate.drawUnit.id);
		groups.set(key, group);
	}
	return [...groups.values()]
		.sort(
			(left, right) =>
				left.atlasTextureIndex - right.atlasTextureIndex ||
				(left.detailAtlasTextureIndex ?? -1) -
					(right.detailAtlasTextureIndex ?? -1) ||
				left.renderStateKey.localeCompare(right.renderStateKey),
		)
		.map((group) => {
			const materialTableSlotStart = Math.min(...group.slotIndices);
			const materialTableSlotEnd = Math.max(...group.slotIndices);
			const materialSlotKeys = [...group.materialSlotKeys].sort();
			const drawUnitIds = [...group.drawUnitIds].sort();
			return {
				key: [
					"baked-draw-slice",
					`texture=${group.atlasTextureIndex}`,
					`detail=${group.detailAtlasTextureIndex ?? "none"}`,
					group.renderStateKey,
					`table=${materialTableSlotStart}-${materialTableSlotEnd}`,
				].join("|"),
				atlasTextureIndex: group.atlasTextureIndex,
				detailAtlasTextureIndex: group.detailAtlasTextureIndex,
				renderStateKey: group.renderStateKey,
				materialTableSlotStart,
				materialTableSlotCount:
					materialTableSlotEnd - materialTableSlotStart + 1,
				materialSlotKeys,
				drawUnitIds,
			};
		});
}

function describeBakedRenderablePlanKey(options: {
	policy: BakedRenderablePolicy;
	atlasEntryKeys: readonly string[];
	detailAtlasEntryKeys: readonly string[];
	materialSlotKeys: readonly string[];
}): string {
	return [
		"baked-renderables",
		`size=${options.policy.maxAtlasTextureSize}`,
		`textures=${options.policy.maxAtlasTextureCount}`,
		`gutter=${options.policy.baseGutterPixels}`,
		`slots=${options.policy.maxMaterialSlotsPerDraw}`,
		...options.atlasEntryKeys,
		...options.detailAtlasEntryKeys.map((key) => `detail=${key}`),
		...options.materialSlotKeys,
	].join("|");
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))].sort();
}

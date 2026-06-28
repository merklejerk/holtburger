import type {
	LandblockSourceIdentity,
	OutdoorStaticObjectsScopePayload,
	PaletteIdentity,
	MaterialTextureDataUseIdentity,
	PreparedIndexRenderSurfaceTextureUseIdentity,
	PreparedRgbaRenderSurfaceTextureUseIdentity,
	RegionDetailRoleFacts,
	RenderSurfaceIdentity,
	StaticMaterialSourceIdentity,
	StaticObjectMaterialSourceFacts,
	StaticObjectPaletteSourceFacts,
	StaticObjectPaletteViewFacts,
	StaticObjectTextureRefFacts,
	SurfaceTextureIdentity,
} from "../../contracts";
import {
	composeStaticMaterialDetailRole,
	planStaticMaterialDetailRoles,
	type StaticMaterialDetailRolePlan,
} from "../../bake/static-material-detail-roles";
import {
	createStaticMaterialBucketKey,
	createStaticMaterialFallbackReason,
	createStaticMaterialSourceKey,
	findStaticRenderSurfaceRef,
	findStaticSurfaceTextureRef,
} from "../../bake/static-material-plan-primitives";

const BYTE_MAX = 255;
const LEGACY_OPACITY_BYTE_SCALE = 255;
const SURFACE_TYPE_BASE1_CLIP_MAP = 0x4;
const SURFACE_TYPE_TRANSLUCENT = 0x10;
const SURFACE_TYPE_DIFFUSE = 0x20;
const SURFACE_TYPE_LUMINOUS = 0x40;
const SURFACE_TYPE_ALPHA = 0x100;
const SURFACE_TYPE_INV_ALPHA = 0x200;
const SURFACE_TYPE_ADDITIVE = 0x10000;
const SURFACE_TYPE_DETAIL = 0x20000;
const PIXEL_FORMAT_P8 = 0x29;
const PIXEL_FORMAT_INDEX16 = 0x65;
const DEFAULT_PALETTE_FIRST_INDEX = 0;
const DIRECT_CLIP_MAP_ALPHA_TEST = 200 / BYTE_MAX;
const INDEXED_CLIP_MAP_ALPHA_TEST = 100 / BYTE_MAX;
const INDEXED_CLIP_MAP_INDEX_THRESHOLD = 8;
const INDEXED_CLIP_MAP_INDEX_THRESHOLD_DISABLED = -1;

type StaticObjectMaterialFamily =
	| "flat-color"
	| "texture-rgba"
	| "indexed-paletted"
	| "unsupported";

type StaticObjectMaterialRenderCoverage =
	| "classified-render-candidate"
	| "classified-render-deferred"
	| "unsupported";

type StaticObjectMaterialPass =
	| "opaque"
	| "alpha-test"
	| "transparent"
	| "additive";

type PaletteDataUseIdentity = Extract<
	MaterialTextureDataUseIdentity,
	{ readonly kind: "palette-texture-use" }
>;

export interface StaticObjectMaterialPipelinePlan {
	readonly domain: StaticMaterialPlanningDomain;
	readonly materialPlans: readonly StaticMaterialPlan[];
	readonly detailRoles: readonly StaticMaterialDetailRolePlan[];
	readonly fallbackReasons: readonly StaticMaterialFallbackReason[];
}

export type StaticMaterialPlanningDomain =
	| OutdoorStaticObjectsScopePayload["domain"]
	| "landblock-env-cells"
	| "runtime-authored-dynamic-object-material";

export interface StaticMaterialPlanningPayload {
	readonly domain: StaticMaterialPlanningDomain;
	readonly landblock: LandblockSourceIdentity;
	readonly materialSources: OutdoorStaticObjectsScopePayload["materialSources"];
	readonly materialSlots: readonly StaticMaterialPlanningSlotFacts[];
	readonly paletteSources: readonly StaticObjectPaletteSourceFacts[];
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
	readonly regionRenderProfile: {
		readonly detailRoles: readonly RegionDetailRoleFacts[];
	};
}

/** Minimal material-slot projection consumed by static object material classification. */
export interface StaticMaterialPlanningSlotFacts {
	readonly material: StaticMaterialSourceIdentity;
	readonly paletteOverride: PaletteIdentity | null;
	readonly paletteViews: readonly StaticObjectPaletteViewFacts[];
}

export interface StaticMaterialPlan {
	readonly material: StaticMaterialSourceIdentity;
	readonly materialUseKey: string;
	readonly family: StaticObjectMaterialFamily;
	readonly renderCoverage: StaticObjectMaterialRenderCoverage;
	readonly pass: StaticObjectMaterialPass;
	readonly alphaPolicy: StaticObjectMaterialAlphaPolicy;
	readonly blend: StaticObjectMaterialBlendFacts;
	readonly color: readonly [number, number, number, number];
	readonly emissiveColor: readonly [number, number, number];
	readonly textureRoles: readonly StaticMaterialTextureUseRole[];
	readonly materialBucketKey: string;
	readonly fallbackReasons: readonly StaticMaterialFallbackReason[];
}

export type StaticMaterialTextureUseRole =
	| {
			readonly role: "base-color";
			readonly texture: SurfaceTextureIdentity;
			readonly renderSurface: RenderSurfaceIdentity;
			readonly dataUse: PreparedRgbaRenderSurfaceTextureUseIdentity;
	  }
	| {
			readonly role: "base-index";
			readonly texture: SurfaceTextureIdentity;
			readonly renderSurface: RenderSurfaceIdentity;
			readonly dataUse: PreparedIndexRenderSurfaceTextureUseIdentity;
			readonly indexedFormat: "p8" | "index16";
			readonly width: number;
			readonly height: number;
	  }
	| {
			readonly role: "palette-rgba";
			readonly palette: PaletteIdentity;
			readonly dataUse: PaletteDataUseIdentity;
	  }
	| {
			readonly role: "detail-overlay";
			readonly texture: SurfaceTextureIdentity;
			readonly renderSurface: RenderSurfaceIdentity;
			readonly dataUse: PreparedRgbaRenderSurfaceTextureUseIdentity;
			readonly tiling: number;
			readonly fadeNear: number;
			readonly fadeFar: number;
	  };

export interface StaticMaterialFallbackReason {
	readonly code:
		| "missing-detail-render-surface"
		| "missing-render-surface"
		| "missing-palette"
		| "detail-overlay-render-deferred"
		| "translucent-render-deferred"
		| "unsupported-surface-flag";
	readonly message: string;
	readonly material: StaticMaterialSourceIdentity | null;
	readonly texture: SurfaceTextureIdentity | null;
	readonly renderSurface: RenderSurfaceIdentity | null;
	readonly palette: PaletteIdentity | null;
}

interface StaticObjectMaterialAlphaPolicy {
	readonly mode:
		| "opaque"
		| "clip"
		| "translucent"
		| "alpha"
		| "inverse-alpha"
		| "additive";
	readonly alphaTest: number;
	readonly indexedClipThreshold: number;
	readonly opacity: number;
}

interface StaticObjectMaterialBlendFacts {
	readonly enabled: boolean;
	readonly mode:
		| "opaque"
		| "clipmap"
		| "translucent"
		| "alpha"
		| "alpha-additive"
		| "inverse-alpha"
		| "inverse-alpha-additive"
		| "additive";
	readonly srcFactor: "one" | "src-alpha" | "one-minus-src-alpha" | null;
	readonly dstFactor: "one" | "src-alpha" | "one-minus-src-alpha" | null;
	readonly depthWrite: boolean;
}

interface StaticObjectMaterialContext {
	readonly material: StaticObjectMaterialSourceFacts;
	readonly paletteOverride?: PaletteIdentity | null;
	readonly paletteViews?: readonly StaticObjectPaletteViewFacts[];
	readonly paletteSources: readonly StaticObjectPaletteSourceFacts[];
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
}

export function planStaticObjectMaterials(
	payload: StaticMaterialPlanningPayload,
): StaticObjectMaterialPipelinePlan {
	const materialById = new Map(
		payload.materialSources.map((material) => [
			createStaticMaterialSourceKey(material.identity),
			material,
		]),
	);
	const plannedMaterialKeys = new Set<string>();
	const rawMaterialPlans: StaticMaterialPlan[] = [];
	for (const slot of payload.materialSlots) {
		const material = materialById.get(
			createStaticMaterialSourceKey(slot.material),
		);
		if (!material) {
			continue;
		}
		const planKey = createStaticObjectMaterialUseKey(
			material.identity,
			slot.paletteOverride,
			slot.paletteViews,
		);
		if (plannedMaterialKeys.has(planKey)) {
			continue;
		}
		plannedMaterialKeys.add(planKey);
		rawMaterialPlans.push(
			classifyStaticObjectMaterial({
				material,
				paletteOverride: slot.paletteOverride,
				paletteViews: slot.paletteViews,
				paletteSources: payload.paletteSources,
				textureRefs: payload.textureRefs,
			}),
		);
	}
	for (const material of payload.materialSources) {
		const planKey = createStaticObjectMaterialUseKey(
			material.identity,
			null,
			[],
		);
		if (plannedMaterialKeys.has(planKey)) {
			continue;
		}
		plannedMaterialKeys.add(planKey);
		rawMaterialPlans.push(
			classifyStaticObjectMaterial({
				material,
				paletteOverride: null,
				paletteViews: [],
				paletteSources: payload.paletteSources,
				textureRefs: payload.textureRefs,
			}),
		);
	}
	const detailRoles = planStaticMaterialDetailRoles({
		detailRoles: payload.regionRenderProfile.detailRoles,
		textureRefs: payload.textureRefs,
	});
	const materialPlans = rawMaterialPlans.map((plan) =>
		composeStaticMaterialDetailRole({
			detailRoles,
			domain: payload.domain,
			plan,
		}),
	);
	const fallbackReasons = [
		...materialPlans.flatMap((plan) => plan.fallbackReasons),
		...detailRoles.flatMap((role) => role.fallbackReasons),
	];

	return {
		detailRoles,
		domain: payload.domain,
		fallbackReasons,
		materialPlans,
	};
}

export function classifyStaticObjectMaterial(
	context: StaticObjectMaterialContext,
): StaticMaterialPlan {
	const behavior = deriveMaterialBehavior(context.material);
	const basePlan = {
		alphaPolicy: behavior.alphaPolicy,
		blend: behavior.blend,
		color: resolveMaterialColor(context.material, behavior),
		emissiveColor: resolveMaterialEmissiveColor(behavior),
		material: context.material.identity,
		materialUseKey: createStaticObjectMaterialUseKey(
			context.material.identity,
			context.paletteOverride ?? null,
			context.paletteViews ?? [],
		),
		pass: resolveMaterialPass(behavior),
	};
	const unsupportedFlagReasons = behavior.unsupportedSurfaceFlags.map((flag) =>
		createStaticMaterialFallbackReason({
			code: "unsupported-surface-flag",
			material: context.material.identity,
			message: `Static material uses unsupported surface flag ${flag}.`,
		}),
	);

	if (context.material.source.kind === "solid-color") {
		return {
			...basePlan,
			fallbackReasons: unsupportedFlagReasons,
			family:
				unsupportedFlagReasons.length === 0 ? "flat-color" : "unsupported",
			materialBucketKey: createStaticMaterialBucketKey({
				alphaPolicy: behavior.alphaPolicy.mode,
				family:
					unsupportedFlagReasons.length === 0 ? "flat-color" : "unsupported",
				material: context.material.identity,
				pass: resolveMaterialPass(behavior),
				textureRoles: [],
			}),
			renderCoverage:
				unsupportedFlagReasons.length === 0
					? "classified-render-candidate"
					: "unsupported",
			textureRoles: [],
		};
	}

	const textureRef = findStaticSurfaceTextureRef(
		context.textureRefs,
		context.material.source.texture,
	);
	if (!textureRef?.renderSurface) {
		const reason = createStaticMaterialFallbackReason({
			code: "missing-render-surface",
			material: context.material.identity,
			message: "Static textured material has no selected render surface.",
			texture: context.material.source.texture,
		});
		return createUnsupportedPlan(basePlan, [reason, ...unsupportedFlagReasons]);
	}

	const renderSurfaceRef = findStaticRenderSurfaceRef(
		context.textureRefs,
		textureRef.renderSurface,
	);
	if (!renderSurfaceRef) {
		const reason = createStaticMaterialFallbackReason({
			code: "missing-render-surface",
			material: context.material.identity,
			message:
				"Static textured material references a render surface that was not resolved.",
			renderSurface: textureRef.renderSurface,
			texture: context.material.source.texture,
		});
		return createUnsupportedPlan(basePlan, [reason, ...unsupportedFlagReasons]);
	}

	const indexedFormat = indexedTextureFormat(renderSurfaceRef.formatRaw);
	if (indexedFormat) {
		const palette =
			context.paletteOverride ??
			context.material.source.palette ??
			renderSurfaceRef.palette;
		if (!palette) {
			const reason = createStaticMaterialFallbackReason({
				code: "missing-palette",
				material: context.material.identity,
				message:
					"Indexed static material requires a material or render-surface palette.",
				renderSurface: renderSurfaceRef.renderSurface,
				texture: context.material.source.texture,
			});
			return createUnsupportedPlan(basePlan, [
				reason,
				...unsupportedFlagReasons,
			]);
		}
		const paletteSource = findPaletteSource(context.paletteSources, palette);
		if (!paletteSource) {
			const reason = createStaticMaterialFallbackReason({
				code: "missing-palette",
				material: context.material.identity,
				message:
					"Indexed static material palette was selected but no palette source metadata was resolved.",
				palette,
				renderSurface: renderSurfaceRef.renderSurface,
				texture: context.material.source.texture,
			});
			return createUnsupportedPlan(basePlan, [
				reason,
				...unsupportedFlagReasons,
			]);
		}
		const indexedBehavior = deriveIndexedRenderSurfaceBehavior(behavior);
		const indexedDeferredReasons = isSupportedTransparentStaticBlend(
			indexedBehavior,
		)
			? []
			: [
					createStaticMaterialFallbackReason({
						code: "translucent-render-deferred",
						material: context.material.identity,
						message:
							"Indexed static material requires translucent/additive pass ordering; rendering is deferred until the static object renderer supports that pass.",
						palette,
						renderSurface: renderSurfaceRef.renderSurface,
						texture: context.material.source.texture,
					}),
				];
		const paletteView = resolvePaletteView(
			palette,
			paletteSource.colorCount,
			context.paletteViews ?? [],
		);
		return createTexturePlan({
			...basePlan,
			alphaPolicy: indexedBehavior.alphaPolicy,
			blend: indexedBehavior.blend,
			family:
				unsupportedFlagReasons.length === 0
					? "indexed-paletted"
					: "unsupported",
			fallbackReasons: [...indexedDeferredReasons, ...unsupportedFlagReasons],
			renderCoverage:
				unsupportedFlagReasons.length > 0
					? "unsupported"
					: indexedDeferredReasons.length > 0
						? "classified-render-deferred"
						: "classified-render-candidate",
			pass: resolveMaterialPass(indexedBehavior),
			textureRoles: [
				{
					dataUse: {
						kind: "prepared-render-surface-texture-use",
						renderSurface: renderSurfaceRef.renderSurface,
						usage: indexedFormat === "p8" ? "index8" : "index16",
					},
					height: renderSurfaceRef.height,
					indexedFormat,
					renderSurface: renderSurfaceRef.renderSurface,
					role: "base-index",
					texture: context.material.source.texture,
					width: renderSurfaceRef.width,
				},
				{
					dataUse: {
						firstIndex: paletteView.firstIndex,
						indexCount: paletteView.indexCount,
						kind: "palette-texture-use",
						palette: paletteView.palette,
						subPalettes: paletteView.subPalettes,
						usage: "palette-rgba",
					},
					palette: paletteView.palette,
					role: "palette-rgba",
				},
			],
		});
	}

	const translucentReasons = isSupportedTransparentStaticBlend(behavior)
		? []
		: [
				createStaticMaterialFallbackReason({
					code: "translucent-render-deferred",
					material: context.material.identity,
					message:
						"Static material requires translucent/additive pass ordering; rendering is deferred until the static object renderer supports that pass.",
					renderSurface: renderSurfaceRef.renderSurface,
					texture: context.material.source.texture,
				}),
			];
	return createTexturePlan({
		...basePlan,
		family:
			unsupportedFlagReasons.length === 0 ? "texture-rgba" : "unsupported",
		fallbackReasons: [...translucentReasons, ...unsupportedFlagReasons],
		renderCoverage:
			unsupportedFlagReasons.length > 0
				? "unsupported"
				: translucentReasons.length > 0
					? "classified-render-deferred"
					: "classified-render-candidate",
		textureRoles: [
			{
				dataUse: {
					kind: "prepared-render-surface-texture-use",
					renderSurface: renderSurfaceRef.renderSurface,
					usage: "rgba-color",
				},
				renderSurface: renderSurfaceRef.renderSurface,
				role: "base-color",
				texture: context.material.source.texture,
			},
		],
	});
}

function createTexturePlan(
	options: Pick<
		StaticMaterialPlan,
		| "alphaPolicy"
		| "blend"
		| "color"
		| "emissiveColor"
		| "family"
		| "fallbackReasons"
		| "material"
		| "materialUseKey"
		| "pass"
		| "renderCoverage"
		| "textureRoles"
	>,
): StaticMaterialPlan {
	return {
		...options,
		materialBucketKey: createStaticMaterialBucketKey({
			alphaPolicy: options.alphaPolicy.mode,
			family: options.family,
			material: options.material,
			pass: options.pass,
			textureRoles: options.textureRoles,
		}),
	};
}

function resolvePaletteView(
	basePalette: PaletteIdentity,
	colorCount: number,
	paletteViews: readonly StaticObjectPaletteViewFacts[],
): PaletteDataUseIdentity {
	return {
		firstIndex: DEFAULT_PALETTE_FIRST_INDEX,
		indexCount: colorCount,
		kind: "palette-texture-use",
		palette: basePalette,
		subPalettes: sortPaletteViews(paletteViews),
		usage: "palette-rgba",
	};
}

function findPaletteSource(
	paletteSources: readonly StaticObjectPaletteSourceFacts[],
	palette: PaletteIdentity,
): StaticObjectPaletteSourceFacts | null {
	return (
		paletteSources.find(
			(source) => source.palette.paletteId === palette.paletteId,
		) ?? null
	);
}

function deriveIndexedRenderSurfaceBehavior(
	behavior: ReturnType<typeof deriveMaterialBehavior>,
): ReturnType<typeof deriveMaterialBehavior> {
	if (behavior.alphaPolicy.mode !== "clip") {
		return behavior;
	}

	return {
		...behavior,
		alphaPolicy: {
			...behavior.alphaPolicy,
			alphaTest: INDEXED_CLIP_MAP_ALPHA_TEST,
			indexedClipThreshold: INDEXED_CLIP_MAP_INDEX_THRESHOLD,
		},
	};
}

export function createStaticObjectMaterialUseKey(
	material: StaticMaterialSourceIdentity,
	paletteOverride: PaletteIdentity | null,
	paletteViews: readonly StaticObjectPaletteViewFacts[],
): string {
	return [
		createStaticMaterialSourceKey(material),
		`palette-override:${paletteOverride ? formatHex32(paletteOverride.paletteId) : "base"}`,
		createStaticObjectPaletteViewsKey(paletteViews),
	].join("|");
}

function createStaticObjectPaletteViewsKey(
	paletteViews: readonly StaticObjectPaletteViewFacts[],
): string {
	if (paletteViews.length === 0) {
		return "palette-views:none";
	}

	return [
		"palette-views",
		...sortPaletteViews(paletteViews).map(
			(view) =>
				`${formatHex32(view.palette.paletteId)}:${view.firstIndex}-${view.indexCount}`,
		),
	].join(":");
}

function sortPaletteViews(
	paletteViews: readonly StaticObjectPaletteViewFacts[],
): readonly StaticObjectPaletteViewFacts[] {
	return [...paletteViews].sort(
		(left, right) =>
			left.firstIndex - right.firstIndex ||
			left.indexCount - right.indexCount ||
			left.palette.paletteId - right.palette.paletteId,
	);
}

function formatHex32(value: number): string {
	return value.toString(16).padStart(8, "0");
}

function createUnsupportedPlan(
	basePlan: Pick<
		StaticMaterialPlan,
		| "alphaPolicy"
		| "blend"
		| "color"
		| "emissiveColor"
		| "material"
		| "materialUseKey"
		| "pass"
	>,
	fallbackReasons: readonly StaticMaterialFallbackReason[],
): StaticMaterialPlan {
	return {
		...basePlan,
		fallbackReasons,
		family: "unsupported",
		materialBucketKey: createStaticMaterialBucketKey({
			alphaPolicy: basePlan.alphaPolicy.mode,
			family: "unsupported",
			material: basePlan.material,
			pass: basePlan.pass,
			textureRoles: [],
		}),
		renderCoverage: "unsupported",
		textureRoles: [],
	};
}

function deriveMaterialBehavior(material: StaticObjectMaterialSourceFacts): {
	readonly alphaPolicy: StaticObjectMaterialAlphaPolicy;
	readonly blend: StaticObjectMaterialBlendFacts;
	readonly diffuseScale: number;
	readonly emissiveScale: number;
	readonly unsupportedSurfaceFlags: readonly string[];
} {
	const opacity = normalizeLegacyOpacity(material.translucency);
	const diffuseScale = hasSurfaceFlag(
		material.surfaceType,
		SURFACE_TYPE_DIFFUSE,
	)
		? clampUnit(material.diffuse)
		: 1;
	const emissiveScale = hasSurfaceFlag(
		material.surfaceType,
		SURFACE_TYPE_LUMINOUS,
	)
		? Math.max(0, material.luminosity)
		: 0;
	const isClipMap = hasSurfaceFlag(
		material.surfaceType,
		SURFACE_TYPE_BASE1_CLIP_MAP,
	);
	const alphaTest =
		isClipMap && !hasSurfaceFlag(material.surfaceType, SURFACE_TYPE_TRANSLUCENT)
			? DIRECT_CLIP_MAP_ALPHA_TEST
			: 0;
	const blend = deriveBlendBehavior({
		isClipMap,
		opacity,
		surfaceType: material.surfaceType,
	});

	return {
		alphaPolicy: {
			alphaTest,
			indexedClipThreshold: INDEXED_CLIP_MAP_INDEX_THRESHOLD_DISABLED,
			mode: resolveAlphaMode(material.surfaceType, blend, opacity),
			opacity,
		},
		blend,
		diffuseScale,
		emissiveScale,
		unsupportedSurfaceFlags: hasSurfaceFlag(
			material.surfaceType,
			SURFACE_TYPE_DETAIL,
		)
			? ["detail"]
			: [],
	};
}

function deriveBlendBehavior(options: {
	readonly surfaceType: number;
	readonly opacity: number;
	readonly isClipMap: boolean;
}): StaticObjectMaterialBlendFacts {
	if (hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_TRANSLUCENT)) {
		return {
			depthWrite: false,
			dstFactor: "one-minus-src-alpha",
			enabled: true,
			mode: "translucent",
			srcFactor: "src-alpha",
		};
	}
	if (hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_ALPHA)) {
		return hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_ADDITIVE)
			? {
					depthWrite: false,
					dstFactor: "one",
					enabled: true,
					mode: "alpha-additive",
					srcFactor: "src-alpha",
				}
			: {
					depthWrite: false,
					dstFactor: "one-minus-src-alpha",
					enabled: true,
					mode: "alpha",
					srcFactor: "src-alpha",
				};
	}
	if (hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_INV_ALPHA)) {
		return hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_ADDITIVE)
			? {
					depthWrite: false,
					dstFactor: "one",
					enabled: true,
					mode: "inverse-alpha-additive",
					srcFactor: "one-minus-src-alpha",
				}
			: {
					depthWrite: false,
					dstFactor: "src-alpha",
					enabled: true,
					mode: "inverse-alpha",
					srcFactor: "one-minus-src-alpha",
				};
	}
	if (hasSurfaceFlag(options.surfaceType, SURFACE_TYPE_ADDITIVE)) {
		return {
			depthWrite: false,
			dstFactor: "one",
			enabled: true,
			mode: "additive",
			srcFactor: "one",
		};
	}
	if (options.isClipMap) {
		return {
			depthWrite: true,
			dstFactor: "one-minus-src-alpha",
			enabled: true,
			mode: "clipmap",
			srcFactor: "one",
		};
	}
	if (options.opacity < 1) {
		return {
			depthWrite: false,
			dstFactor: "one-minus-src-alpha",
			enabled: true,
			mode: "translucent",
			srcFactor: "src-alpha",
		};
	}
	return {
		depthWrite: true,
		dstFactor: null,
		enabled: false,
		mode: "opaque",
		srcFactor: null,
	};
}

function resolveAlphaMode(
	surfaceType: number,
	blend: StaticObjectMaterialBlendFacts,
	opacity: number,
): StaticObjectMaterialAlphaPolicy["mode"] {
	if (hasSurfaceFlag(surfaceType, SURFACE_TYPE_ALPHA)) {
		return "alpha";
	}
	if (hasSurfaceFlag(surfaceType, SURFACE_TYPE_INV_ALPHA)) {
		return "inverse-alpha";
	}
	if (hasSurfaceFlag(surfaceType, SURFACE_TYPE_ADDITIVE)) {
		return "additive";
	}
	if (blend.mode === "clipmap") {
		return "clip";
	}
	if (blend.mode === "translucent" || opacity < 1) {
		return "translucent";
	}
	return "opaque";
}

function resolveMaterialPass(
	behavior: ReturnType<typeof deriveMaterialBehavior>,
): StaticObjectMaterialPass {
	if (
		behavior.blend.mode === "additive" ||
		behavior.blend.mode.endsWith("additive")
	) {
		return "additive";
	}
	if (!behavior.blend.depthWrite) {
		return "transparent";
	}
	return behavior.alphaPolicy.alphaTest > 0 ? "alpha-test" : "opaque";
}

function isSupportedTransparentStaticBlend(
	behavior: ReturnType<typeof deriveMaterialBehavior>,
): boolean {
	return (
		behavior.blend.depthWrite ||
		behavior.blend.mode === "alpha" ||
		behavior.blend.mode === "translucent"
	);
}

function resolveMaterialColor(
	material: StaticObjectMaterialSourceFacts,
	behavior: ReturnType<typeof deriveMaterialBehavior>,
): readonly [number, number, number, number] {
	if (material.source.kind !== "solid-color") {
		return [
			behavior.diffuseScale,
			behavior.diffuseScale,
			behavior.diffuseScale,
			behavior.alphaPolicy.opacity,
		];
	}
	const color = decodeArgb(material.source.argb);
	return [
		color[0] * behavior.diffuseScale,
		color[1] * behavior.diffuseScale,
		color[2] * behavior.diffuseScale,
		color[3] * behavior.alphaPolicy.opacity,
	];
}

function resolveMaterialEmissiveColor(
	behavior: ReturnType<typeof deriveMaterialBehavior>,
): readonly [number, number, number] {
	return [
		behavior.emissiveScale,
		behavior.emissiveScale,
		behavior.emissiveScale,
	];
}

function indexedTextureFormat(formatRaw: number): "p8" | "index16" | null {
	switch (formatRaw) {
		case PIXEL_FORMAT_P8:
			return "p8";
		case PIXEL_FORMAT_INDEX16:
			return "index16";
		default:
			return null;
	}
}

function normalizeLegacyOpacity(translucency: number): number {
	const normalized =
		translucency > 1
			? 1 - Math.min(translucency, LEGACY_OPACITY_BYTE_SCALE) / BYTE_MAX
			: 1 - translucency;
	return clampUnit(normalized);
}

function hasSurfaceFlag(surfaceType: number, flag: number): boolean {
	return (surfaceType & flag) === flag;
}

function decodeArgb(argb: number): readonly [number, number, number, number] {
	return [
		((argb >>> 16) & 0xff) / BYTE_MAX,
		((argb >>> 8) & 0xff) / BYTE_MAX,
		(argb & 0xff) / BYTE_MAX,
		((argb >>> 24) & 0xff) / BYTE_MAX,
	];
}

function clampUnit(value: number): number {
	return Math.max(0, Math.min(1, value));
}

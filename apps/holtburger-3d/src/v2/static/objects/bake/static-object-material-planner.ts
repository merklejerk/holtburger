import type {
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
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly materialPlans: readonly StaticObjectMaterialPlan[];
	readonly detailRoles: readonly StaticObjectDetailRolePlan[];
	readonly fallbackReasons: readonly StaticObjectMaterialFallbackReason[];
}

export interface StaticObjectMaterialPlan {
	readonly material: StaticMaterialSourceIdentity;
	readonly materialUseKey: string;
	readonly family: StaticObjectMaterialFamily;
	readonly renderCoverage: StaticObjectMaterialRenderCoverage;
	readonly pass: StaticObjectMaterialPass;
	readonly alphaPolicy: StaticObjectMaterialAlphaPolicy;
	readonly blend: StaticObjectMaterialBlendFacts;
	readonly color: readonly [number, number, number, number];
	readonly emissiveColor: readonly [number, number, number];
	readonly textureRoles: readonly StaticObjectMaterialTextureUseRole[];
	readonly materialBucketKey: string;
	readonly fallbackReasons: readonly StaticObjectMaterialFallbackReason[];
}

export type StaticObjectMaterialTextureUseRole =
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

interface StaticObjectDetailRolePlan {
	readonly role: RegionDetailRoleFacts["role"];
	readonly texture: SurfaceTextureIdentity;
	readonly renderSurface: RenderSurfaceIdentity | null;
	readonly dataUse: PreparedRgbaRenderSurfaceTextureUseIdentity | null;
	readonly tiling: number;
	readonly fadeNear: number;
	readonly fadeFar: number;
	readonly renderCoverage:
		| "classified-render-candidate"
		| "classified-render-deferred";
	readonly fallbackReasons: readonly StaticObjectMaterialFallbackReason[];
}

export interface StaticObjectMaterialFallbackReason {
	readonly code:
		| "missing-material-texture"
		| "missing-detail-render-surface"
		| "missing-render-surface"
		| "missing-palette"
		| "palette-index-out-of-range"
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
	payload: OutdoorStaticObjectsScopePayload,
): StaticObjectMaterialPipelinePlan {
	const materialById = new Map(
		payload.materialSources.map((material) => [
			createStaticMaterialSourceKey(material.identity),
			material,
		]),
	);
	const plannedMaterialKeys = new Set<string>();
	const rawMaterialPlans: StaticObjectMaterialPlan[] = [];
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
	const detailRoles = payload.regionRenderProfile.detailRoles
		.filter((role) => role.role !== "landscape")
		.map((role) => createDetailRolePlan(role, payload.textureRefs));
	const materialPlans = rawMaterialPlans.map((plan) =>
		composeStaticDetailRoles(plan, payload.domain, detailRoles),
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
): StaticObjectMaterialPlan {
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
		createFallbackReason({
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
			materialBucketKey: createMaterialBucketKey({
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

	const textureRef = findSurfaceTextureRef(
		context.textureRefs,
		context.material.source.texture,
	);
	if (!textureRef?.renderSurface) {
		const reason = createFallbackReason({
			code: "missing-render-surface",
			material: context.material.identity,
			message: "Static textured material has no selected render surface.",
			texture: context.material.source.texture,
		});
		return createUnsupportedPlan(basePlan, [reason, ...unsupportedFlagReasons]);
	}

	const renderSurfaceRef = findRenderSurfaceRef(
		context.textureRefs,
		textureRef.renderSurface,
	);
	if (!renderSurfaceRef) {
		const reason = createFallbackReason({
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
			const reason = createFallbackReason({
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
			const reason = createFallbackReason({
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
		if (
			renderSurfaceRef.indexedMaxIndex !== null &&
			renderSurfaceRef.indexedMaxIndex >= paletteSource.colorCount
		) {
			const reason = createFallbackReason({
				code: "palette-index-out-of-range",
				material: context.material.identity,
				message: `Indexed static material references palette index ${renderSurfaceRef.indexedMaxIndex}, but palette ${formatHex32(palette.paletteId)} has ${paletteSource.colorCount} colors.`,
				palette,
				renderSurface: renderSurfaceRef.renderSurface,
				texture: context.material.source.texture,
			});
			return createUnsupportedPlan(basePlan, [
				reason,
				...unsupportedFlagReasons,
			]);
		}
		const indexedDeferredReasons = isSupportedTransparentStaticBlend(behavior)
			? []
			: [
					createFallbackReason({
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
				createFallbackReason({
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

function composeStaticDetailRoles(
	plan: StaticObjectMaterialPlan,
	domain: OutdoorStaticObjectsScopePayload["domain"],
	detailRoles: readonly StaticObjectDetailRolePlan[],
): StaticObjectMaterialPlan {
	const detailRole = resolveComposableDetailRole(domain, detailRoles);
	if (!detailRole) {
		return plan;
	}

	if (plan.renderCoverage !== "classified-render-candidate") {
		return {
			...plan,
			fallbackReasons: [
				...plan.fallbackReasons,
				createFallbackReason({
					code: "detail-overlay-render-deferred",
					material: plan.material,
					message:
						"Static object detail overlay is deferred until this material pass is renderable.",
					texture: detailRole.texture,
				}),
			],
		};
	}

	if (!detailRole.dataUse || !detailRole.renderSurface) {
		return plan;
	}

	const textureRoles: readonly StaticObjectMaterialTextureUseRole[] = [
		...plan.textureRoles,
		{
			dataUse: detailRole.dataUse,
			fadeFar: detailRole.fadeFar,
			fadeNear: detailRole.fadeNear,
			renderSurface: detailRole.renderSurface,
			role: "detail-overlay",
			texture: detailRole.texture,
			tiling: detailRole.tiling,
		},
	];

	return {
		...plan,
		materialBucketKey: createMaterialBucketKey({
			alphaPolicy: plan.alphaPolicy.mode,
			family: plan.family,
			material: plan.material,
			pass: plan.pass,
			textureRoles,
		}),
		textureRoles,
	};
}

function resolveComposableDetailRole(
	domain: OutdoorStaticObjectsScopePayload["domain"],
	detailRoles: readonly StaticObjectDetailRolePlan[],
): StaticObjectDetailRolePlan | null {
	if (domain !== "outdoor-buildings") {
		return null;
	}

	const detailRole =
		detailRoles.find((role) => role.role === "building") ?? null;
	return detailRole?.renderCoverage === "classified-render-candidate"
		? detailRole
		: null;
}

function createTexturePlan(
	options: Pick<
		StaticObjectMaterialPlan,
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
): StaticObjectMaterialPlan {
	return {
		...options,
		materialBucketKey: createMaterialBucketKey({
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

function createStaticMaterialSourceKey(
	material: StaticMaterialSourceIdentity,
): string {
	return formatHex32(material.materialId);
}

function formatHex32(value: number): string {
	return value.toString(16).padStart(8, "0");
}

function createUnsupportedPlan(
	basePlan: Pick<
		StaticObjectMaterialPlan,
		| "alphaPolicy"
		| "blend"
		| "color"
		| "emissiveColor"
		| "material"
		| "materialUseKey"
		| "pass"
	>,
	fallbackReasons: readonly StaticObjectMaterialFallbackReason[],
): StaticObjectMaterialPlan {
	return {
		...basePlan,
		fallbackReasons,
		family: "unsupported",
		materialBucketKey: createMaterialBucketKey({
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

function createDetailRolePlan(
	role: RegionDetailRoleFacts,
	textureRefs: readonly StaticObjectTextureRefFacts[],
): StaticObjectDetailRolePlan {
	if (role.role !== "building" && role.role !== "environment") {
		return {
			dataUse: null,
			fadeFar: role.fadeFar,
			fadeNear: role.fadeNear,
			fallbackReasons: [
				createFallbackReason({
					code: "detail-overlay-render-deferred",
					message:
						"Static object detail overlay role is not renderable for this static object family yet.",
					texture: role.texture,
				}),
			],
			renderCoverage: "classified-render-deferred",
			renderSurface: null,
			role: role.role,
			texture: role.texture,
			tiling: role.tiling,
		};
	}

	const textureRef = findSurfaceTextureRef(textureRefs, role.texture);
	const renderSurface = textureRef?.renderSurface ?? null;
	if (!renderSurface || !findRenderSurfaceRef(textureRefs, renderSurface)) {
		return {
			dataUse: null,
			fadeFar: role.fadeFar,
			fadeNear: role.fadeNear,
			fallbackReasons: [
				createFallbackReason({
					code: "missing-detail-render-surface",
					message:
						"Static object detail overlay texture has no resolved render surface.",
					texture: role.texture,
				}),
			],
			renderCoverage: "classified-render-deferred",
			renderSurface: null,
			role: role.role,
			texture: role.texture,
			tiling: role.tiling,
		};
	}

	return {
		dataUse: {
			kind: "prepared-render-surface-texture-use",
			renderSurface,
			usage: "rgba-detail",
		},
		fadeFar: role.fadeFar,
		fadeNear: role.fadeNear,
		fallbackReasons: [],
		renderCoverage: "classified-render-candidate",
		renderSurface,
		role: role.role,
		texture: role.texture,
		tiling: role.tiling,
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
	const usesIndexedClipDiscard =
		material.source.kind === "texture" && material.source.palette !== null;
	const alphaTest =
		isClipMap && !hasSurfaceFlag(material.surfaceType, SURFACE_TYPE_TRANSLUCENT)
			? usesIndexedClipDiscard
				? INDEXED_CLIP_MAP_ALPHA_TEST
				: DIRECT_CLIP_MAP_ALPHA_TEST
			: 0;
	const blend = deriveBlendBehavior({
		isClipMap,
		opacity,
		surfaceType: material.surfaceType,
	});

	return {
		alphaPolicy: {
			alphaTest,
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

function findSurfaceTextureRef(
	textureRefs: readonly StaticObjectTextureRefFacts[],
	texture: SurfaceTextureIdentity,
): Extract<
	StaticObjectTextureRefFacts,
	{ readonly role: "surface-texture" }
> | null {
	return (
		textureRefs.find(
			(
				ref,
			): ref is Extract<
				StaticObjectTextureRefFacts,
				{ readonly role: "surface-texture" }
			> =>
				ref.role === "surface-texture" &&
				ref.texture.surfaceTextureId === texture.surfaceTextureId,
		) ?? null
	);
}

function findRenderSurfaceRef(
	textureRefs: readonly StaticObjectTextureRefFacts[],
	renderSurface: RenderSurfaceIdentity,
): Extract<
	StaticObjectTextureRefFacts,
	{ readonly role: "render-surface" }
> | null {
	return (
		textureRefs.find(
			(
				ref,
			): ref is Extract<
				StaticObjectTextureRefFacts,
				{ readonly role: "render-surface" }
			> =>
				ref.role === "render-surface" &&
				ref.renderSurface.renderSurfaceId === renderSurface.renderSurfaceId,
		) ?? null
	);
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

function createMaterialBucketKey(options: {
	readonly family: StaticObjectMaterialFamily;
	readonly material: StaticMaterialSourceIdentity;
	readonly pass: StaticObjectMaterialPass;
	readonly alphaPolicy: StaticObjectMaterialAlphaPolicy["mode"];
	readonly textureRoles: readonly StaticObjectMaterialTextureUseRole[];
}): string {
	return [
		`family:${options.family}`,
		"domain:static-objects",
		`pass:${options.pass}`,
		`alpha:${options.alphaPolicy}`,
		`material:${options.material.materialId.toString(16).padStart(8, "0")}`,
		`roles:${createTextureRoleSignature(options.textureRoles)}`,
	].join("|");
}

function createTextureRoleSignature(
	roles: readonly StaticObjectMaterialTextureUseRole[],
): string {
	if (roles.length === 0) {
		return "none";
	}

	return roles
		.map((role) => `${role.role}:${createTextureRoleDataUseSignature(role)}`)
		.join(",");
}

function createTextureRoleDataUseSignature(
	role: StaticObjectMaterialTextureUseRole,
): string {
	const detailSuffix =
		role.role === "detail-overlay" ? `:tiling=${role.tiling}` : "";
	if (role.dataUse.kind === "palette-texture-use") {
		return (
			[
				formatHex32(role.dataUse.palette.paletteId),
				`${role.dataUse.firstIndex}-${role.dataUse.indexCount}`,
				role.dataUse.usage,
			].join(":") + detailSuffix
		);
	}

	return (
		[
			formatHex32(role.dataUse.renderSurface.renderSurfaceId),
			role.dataUse.usage,
		].join(":") + detailSuffix
	);
}

function createFallbackReason(options: {
	readonly code: StaticObjectMaterialFallbackReason["code"];
	readonly message: string;
	readonly material?: StaticMaterialSourceIdentity | null;
	readonly texture?: SurfaceTextureIdentity | null;
	readonly renderSurface?: RenderSurfaceIdentity | null;
	readonly palette?: PaletteIdentity | null;
}): StaticObjectMaterialFallbackReason {
	return {
		code: options.code,
		material: options.material ?? null,
		message: options.message,
		palette: options.palette ?? null,
		renderSurface: options.renderSurface ?? null,
		texture: options.texture ?? null,
	};
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

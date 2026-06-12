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
const DEFAULT_PALETTE_INDEX_COUNT = 256;
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
	  };

interface StaticObjectDetailRolePlan {
	readonly role: RegionDetailRoleFacts["role"];
	readonly texture: SurfaceTextureIdentity;
	readonly tiling: number;
	readonly fadeNear: number;
	readonly fadeFar: number;
	readonly renderCoverage: "classified-render-deferred";
	readonly fallbackReasons: readonly StaticObjectMaterialFallbackReason[];
}

export interface StaticObjectMaterialFallbackReason {
	readonly code:
		| "missing-material-texture"
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
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
}

export function planStaticObjectMaterials(
	payload: OutdoorStaticObjectsScopePayload,
): StaticObjectMaterialPipelinePlan {
	const materialPlans = payload.materialSources.map((material) =>
		classifyStaticObjectMaterial({
			material,
			textureRefs: payload.textureRefs,
		}),
	);
	const detailRoles = payload.regionRenderProfile.detailRoles
		.filter((role) => role.role !== "landscape")
		.map(createDetailRolePlan);
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
			message: "Static textured material references a render surface that was not resolved.",
			renderSurface: textureRef.renderSurface,
			texture: context.material.source.texture,
		});
		return createUnsupportedPlan(basePlan, [reason, ...unsupportedFlagReasons]);
	}

	const indexedFormat = indexedTextureFormat(renderSurfaceRef.formatRaw);
	if (indexedFormat) {
		const palette = context.material.source.palette ?? renderSurfaceRef.palette;
		if (!palette) {
			const reason = createFallbackReason({
				code: "missing-palette",
				material: context.material.identity,
				message: "Indexed static material requires a material or render-surface palette.",
				renderSurface: renderSurfaceRef.renderSurface,
				texture: context.material.source.texture,
			});
			return createUnsupportedPlan(basePlan, [reason, ...unsupportedFlagReasons]);
		}
		const indexedDeferredReasons = behavior.blend.depthWrite
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
						firstIndex: DEFAULT_PALETTE_FIRST_INDEX,
						indexCount: DEFAULT_PALETTE_INDEX_COUNT,
						kind: "palette-texture-use",
						palette,
						usage: "palette-rgba",
					},
					palette,
					role: "palette-rgba",
				},
			],
		});
	}

	const translucentReasons = behavior.blend.depthWrite
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
		}),
	};
}

function createUnsupportedPlan(
	basePlan: Pick<
		StaticObjectMaterialPlan,
		"alphaPolicy" | "blend" | "color" | "emissiveColor" | "material" | "pass"
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
		}),
		renderCoverage: "unsupported",
		textureRoles: [],
	};
}

function createDetailRolePlan(
	role: RegionDetailRoleFacts,
): StaticObjectDetailRolePlan {
	return {
		fadeFar: role.fadeFar,
		fadeNear: role.fadeNear,
		fallbackReasons: [
			createFallbackReason({
				code: "detail-overlay-render-deferred",
				message:
					"Static object detail overlay roles are classified but deferred until material-role composition lands.",
				texture: role.texture,
			}),
		],
		renderCoverage: "classified-render-deferred",
		role: role.role,
		texture: role.texture,
		tiling: role.tiling,
	};
}

function deriveMaterialBehavior(
	material: StaticObjectMaterialSourceFacts,
): {
	readonly alphaPolicy: StaticObjectMaterialAlphaPolicy;
	readonly blend: StaticObjectMaterialBlendFacts;
	readonly diffuseScale: number;
	readonly emissiveScale: number;
	readonly unsupportedSurfaceFlags: readonly string[];
} {
	const opacity = normalizeLegacyOpacity(material.translucency);
	const diffuseScale = hasSurfaceFlag(material.surfaceType, SURFACE_TYPE_DIFFUSE)
		? clampUnit(material.diffuse)
		: 1;
	const emissiveScale = hasSurfaceFlag(material.surfaceType, SURFACE_TYPE_LUMINOUS)
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
	if (behavior.blend.mode === "additive" || behavior.blend.mode.endsWith("additive")) {
		return "additive";
	}
	if (!behavior.blend.depthWrite) {
		return "transparent";
	}
	return behavior.alphaPolicy.alphaTest > 0 ? "alpha-test" : "opaque";
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
): Extract<StaticObjectTextureRefFacts, { readonly role: "surface-texture" }> | null {
	return (
		textureRefs.find(
			(ref): ref is Extract<
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
): Extract<StaticObjectTextureRefFacts, { readonly role: "render-surface" }> | null {
	return (
		textureRefs.find(
			(ref): ref is Extract<
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
}): string {
	return [
		`family:${options.family}`,
		"domain:static-objects",
		`pass:${options.pass}`,
		`alpha:${options.alphaPolicy}`,
		`material:${options.material.materialId.toString(16).padStart(8, "0")}`,
	].join("|");
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

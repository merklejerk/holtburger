import type {
	AssetErrorCode,
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	EnvCellPayloadDto,
	GfxObjPayloadDto,
	LandblockOutdoorPayloadDto,
	LandblockTopologyPayloadDto,
	MaterialRecipePayloadDto,
	PalettePayloadDto,
	PreparedTexturePayloadDto,
	RegionRenderProfilePayloadDto,
	RenderSurfacePayloadDto,
	SetupAppearancePayloadDto,
	SetupModelPayloadDto,
	SurfaceTexturePayloadDto,
	TerrainMaterialPayloadDto,
} from "../../lib/host/contracts";
import {
	assetProvenanceDtoSchema,
	envCellPayloadDtoSchema,
	genericAssetPayloadDtoSchema,
	gfxObjPayloadDtoSchema,
	landblockOutdoorPayloadDtoSchema,
	landblockTopologyPayloadDtoSchema,
	materialRecipePayloadDtoSchema,
	palettePayloadDtoSchema,
	preparedTexturePayloadDtoSchema,
	regionRenderProfilePayloadDtoSchema,
	renderSurfacePayloadDtoSchema,
	setupAppearancePayloadDtoSchema,
	setupModelPayloadDtoSchema,
	surfaceTexturePayloadDtoSchema,
	terrainMaterialPayloadDtoSchema,
} from "../../lib/host/contracts";
import { isSetupAppearanceAssetId } from "../../lib/assets/asset-hydration-policy";
import type {
	AssetResidencyKind,
	PreparedAssetPayload,
	PreparedAssetProvenance,
	PreparedAssetRecord,
} from "../../lib/assets/types";
import type { ZodIssue } from "zod";

export function prepareAssetPayload(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
): PreparedAssetRecord {
	const routeMatchedAsset = prepareRouteMatchedAssetPayload(request, response);
	if (routeMatchedAsset) {
		return routeMatchedAsset;
	}

	const landblockOutdoorPayload = landblockOutdoorPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (landblockOutdoorPayload.success) {
		return prepareTypedContentAsset(
			request,
			response,
			landblockOutdoorPayload.data,
		);
	}

	const landblockTopologyPayload = landblockTopologyPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (landblockTopologyPayload.success) {
		return prepareTypedContentAsset(
			request,
			response,
			landblockTopologyPayload.data,
		);
	}

	const envCellPayload = envCellPayloadDtoSchema.safeParse(response.payload);
	if (envCellPayload.success) {
		return prepareTypedContentAsset(request, response, envCellPayload.data);
	}

	const gfxObjPayload = gfxObjPayloadDtoSchema.safeParse(response.payload);
	if (gfxObjPayload.success) {
		return prepareGfxObj(request, response, gfxObjPayload.data);
	}

	const setupModelPayload = setupModelPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (setupModelPayload.success) {
		return prepareSetupModel(request, response, setupModelPayload.data);
	}

	const setupAppearancePayload = setupAppearancePayloadDtoSchema.safeParse(
		response.payload,
	);
	if (setupAppearancePayload.success) {
		return preparePassthroughAsset(
			request,
			response,
			setupAppearancePayload.data,
		);
	}

	const materialRecipePayload = materialRecipePayloadDtoSchema.safeParse(
		response.payload,
	);
	if (materialRecipePayload.success) {
		return preparePassthroughAsset(
			request,
			response,
			materialRecipePayload.data,
		);
	}

	const regionRenderProfilePayload =
		regionRenderProfilePayloadDtoSchema.safeParse(response.payload);
	if (regionRenderProfilePayload.success) {
		return preparePassthroughAsset(
			request,
			response,
			regionRenderProfilePayload.data,
		);
	}

	const surfaceTexturePayload = surfaceTexturePayloadDtoSchema.safeParse(
		response.payload,
	);
	if (surfaceTexturePayload.success) {
		return preparePassthroughAsset(
			request,
			response,
			surfaceTexturePayload.data,
		);
	}

	const renderSurfacePayload = renderSurfacePayloadDtoSchema.safeParse(
		response.payload,
	);
	if (renderSurfacePayload.success) {
		return preparePassthroughAsset(
			request,
			response,
			renderSurfacePayload.data,
		);
	}

	const palettePayload = palettePayloadDtoSchema.safeParse(response.payload);
	if (palettePayload.success) {
		return preparePassthroughAsset(request, response, palettePayload.data);
	}

	const payload = genericAssetPayloadDtoSchema.parse(response.payload);
	const assetKind = payload.kind;
	const provenance = parseProvenance(payload.provenance);
	const residencyKind = parseResidencyKind(payload.residencyKind);
	const debugPrimitive = payload.debugPrimitive ?? "json-manifest";
	const paletteKey = payload.paletteKey ?? "debug-default";

	return {
		request,
		response,
		payload:
			assetKind === "visual-asset-stub"
				? {
						kind: "visual-asset-stub",
						sourceAssetKind: provenance.sourceAssetKind,
						residencyKind,
						provenance,
						debugPresentation: {
							primitive: debugPrimitive,
							paletteKey,
						},
					}
				: createUnknownAssetPayload({
						rawKind: assetKind,
						sourceAssetKind: provenance.sourceAssetKind,
						residencyKind,
						debugPrimitive,
						paletteKey,
						provenance,
					}),
		preparedAt: new Date().toISOString(),
	};
}

function prepareRouteMatchedAssetPayload(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
): PreparedAssetRecord | null {
	if (/^landblock\/[0-9a-fA-F]{8}\/outdoor$/.test(request.assetId)) {
		const payload = parseExpectedRoutePayload(
			request.assetId,
			"landblock-outdoor",
			landblockOutdoorPayloadDtoSchema,
			response.payload,
		);
		return prepareTypedContentAsset(request, response, payload);
	}

	if (/^landblock\/[0-9a-fA-F]{8}\/topology$/.test(request.assetId)) {
		const payload = parseExpectedRoutePayload(
			request.assetId,
			"landblock-topology",
			landblockTopologyPayloadDtoSchema,
			response.payload,
		);
		return prepareTypedContentAsset(request, response, payload);
	}

	if (/^env-cell\/[0-9a-fA-F]{8}$/.test(request.assetId)) {
		const payload = parseExpectedRoutePayload(
			request.assetId,
			"env-cell",
			envCellPayloadDtoSchema,
			response.payload,
		);
		return prepareTypedContentAsset(request, response, payload);
	}

	if (/^gfx-obj\/[0-9a-fA-F]{8}$/.test(request.assetId)) {
		const payload = parseExpectedRoutePayload(
			request.assetId,
			"gfx-obj",
			gfxObjPayloadDtoSchema,
			response.payload,
		);
		return prepareGfxObj(request, response, payload);
	}

	if (/^setup-model\/[0-9a-fA-F]{8}$/.test(request.assetId)) {
		const payload = parseExpectedRoutePayload(
			request.assetId,
			"setup-model",
			setupModelPayloadDtoSchema,
			response.payload,
		);
		return prepareSetupModel(request, response, payload);
	}

	if (isSetupAppearanceAssetId(request.assetId)) {
		const payload = parseExpectedRoutePayload(
			request.assetId,
			"setup-appearance",
			setupAppearancePayloadDtoSchema,
			response.payload,
		);
		return preparePassthroughAsset(request, response, payload);
	}

	if (/^material\/[0-9a-fA-F]{8}$/.test(request.assetId)) {
		const payload = parseExpectedRoutePayload(
			request.assetId,
			"material-recipe",
			materialRecipePayloadDtoSchema,
			response.payload,
		);
		return preparePassthroughAsset(request, response, payload);
	}

	if (/^terrain-material\/[0-9]+$/.test(request.assetId)) {
		const payload = parseExpectedRoutePayload(
			request.assetId,
			"terrain-material",
			terrainMaterialPayloadDtoSchema,
			response.payload,
		);
		return preparePassthroughAsset(request, response, payload);
	}

	if (/^region-render-profile\/[0-9]+$/.test(request.assetId)) {
		const payload = parseExpectedRoutePayload(
			request.assetId,
			"region-render-profile",
			regionRenderProfilePayloadDtoSchema,
			response.payload,
		);
		return preparePassthroughAsset(request, response, payload);
	}

	if (/^surface-texture\/[0-9a-fA-F]{8}$/.test(request.assetId)) {
		const payload = parseExpectedRoutePayload(
			request.assetId,
			"surface-texture",
			surfaceTexturePayloadDtoSchema,
			response.payload,
		);
		return preparePassthroughAsset(request, response, payload);
	}

	if (/^render-surface\/[0-9a-fA-F]{8}$/.test(request.assetId)) {
		const payload = parseExpectedRoutePayload(
			request.assetId,
			"render-surface",
			renderSurfacePayloadDtoSchema,
			response.payload,
		);
		return preparePassthroughAsset(request, response, payload);
	}

	if (/^prepared-texture\/[0-9a-fA-F]{8}\?/.test(request.assetId)) {
		const payload = parseExpectedRoutePayload(
			request.assetId,
			"prepared-texture",
			preparedTexturePayloadDtoSchema,
			response.payload,
		);
		return preparePassthroughAsset(request, response, payload);
	}

	if (/^palette\/[0-9a-fA-F]{8}$/.test(request.assetId)) {
		const payload = parseExpectedRoutePayload(
			request.assetId,
			"palette",
			palettePayloadDtoSchema,
			response.payload,
		);
		return preparePassthroughAsset(request, response, payload);
	}

	return null;
}

function parseExpectedRoutePayload<T>(
	assetId: string,
	expectedKind: string,
	schema: {
		safeParse(
			value: unknown,
		):
			| { success: true; data: T }
			| { success: false; error: { issues: readonly ZodIssue[] } };
	},
	payload: unknown,
): T {
	const parsedPayload = schema.safeParse(payload);
	if (!parsedPayload.success) {
		throw new Error(
			formatTypedPayloadParseError(
				assetId,
				expectedKind,
				parsedPayload.error.issues,
				payload,
			),
		);
	}
	return parsedPayload.data;
}

function formatTypedPayloadParseError(
	assetId: string,
	expectedKind: string,
	issues: readonly ZodIssue[],
	payload: unknown,
): string {
	const issueText = issues
		.slice(0, 12)
		.map((issue) => {
			const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
			return `${path}: ${issue.message}`;
		})
		.join("; ");
	const suffix =
		issues.length > 12 ? `; ${issues.length - 12} more issue(s)` : "";
	return `Asset ${assetId} matched the ${expectedKind} route but its payload failed the ${expectedKind} contract: ${issueText}${suffix}. Payload summary: ${describeUnknownPayload(
		payload,
	)}`;
}

function describeUnknownPayload(payload: unknown): string {
	if (payload === undefined) {
		return "undefined";
	}
	if (payload === null) {
		return "null";
	}
	if (Array.isArray(payload)) {
		return `array(length=${payload.length})`;
	}
	if (typeof payload === "object") {
		const record = payload as Record<string, unknown>;
		return `object(keys=${Object.keys(record).slice(0, 24).join(",")})`;
	}
	return `${typeof payload}(${String(payload).slice(0, 120)})`;
}

function prepareGfxObj(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload: GfxObjPayloadDto,
): PreparedAssetRecord {
	return {
		request,
		response,
		payload: {
			kind: "gfx-obj",
			sourceAssetKind: payload.sourceAssetKind,
			residencyKind: payload.residencyKind,
			provenance: parseProvenance(payload.provenance),
			gfxObjId: payload.gfxObjId,
			flags: payload.flags,
			surfaceIds: payload.surfaceIds,
			vertexArray: payload.vertexArray,
			drawingPolygons: payload.drawingPolygons,
			drawingBsp: payload.drawingBsp,
			dependencies: payload.dependencies,
			physicsWitness: payload.physicsWitness,
			renderGeometry: payload.renderGeometry,
			sortCenter: payload.sortCenter,
			didDegrade: payload.didDegrade,
		},
		preparedAt: new Date().toISOString(),
	};
}

function prepareSetupModel(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload: SetupModelPayloadDto,
): PreparedAssetRecord {
	return {
		request,
		response,
		payload: {
			kind: "setup-model",
			sourceAssetKind: payload.sourceAssetKind,
			residencyKind: payload.residencyKind,
			provenance: parseProvenance(payload.provenance),
			setupModelId: payload.setupModelId,
			flags: payload.flags,
			parts: payload.parts,
			holdingLocations: payload.holdingLocations,
			connectionPoints: payload.connectionPoints,
			placementSets: payload.placementSets,
			collisionWitness: payload.collisionWitness,
			height: payload.height,
			radius: payload.radius,
			stepUp: payload.stepUp,
			stepDown: payload.stepDown,
			sortingSphere: payload.sortingSphere,
			selectionSphere: payload.selectionSphere,
			lights: payload.lights,
			defaultAnimation: payload.defaultAnimation,
			defaultScript: payload.defaultScript,
			defaultMotionTable: payload.defaultMotionTable,
			defaultSoundTable: payload.defaultSoundTable,
			defaultScriptTable: payload.defaultScriptTable,
			dependencies: payload.dependencies,
		},
		preparedAt: new Date().toISOString(),
	};
}

function preparePassthroughAsset(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload:
		| SetupAppearancePayloadDto
		| MaterialRecipePayloadDto
		| SurfaceTexturePayloadDto
		| RenderSurfacePayloadDto
		| PreparedTexturePayloadDto
		| PalettePayloadDto
		| TerrainMaterialPayloadDto
		| RegionRenderProfilePayloadDto,
): PreparedAssetRecord {
	return {
		request,
		response,
		payload: {
			...payload,
			provenance: parseProvenance(payload.provenance),
		} as PreparedAssetPayload,
		preparedAt: new Date().toISOString(),
	};
}

function prepareTypedContentAsset(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload:
		| LandblockOutdoorPayloadDto
		| LandblockTopologyPayloadDto
		| EnvCellPayloadDto,
): PreparedAssetRecord {
	return {
		request,
		response,
		payload: {
			...payload,
			provenance: parseProvenance(payload.provenance),
		} as PreparedAssetPayload,
		preparedAt: new Date().toISOString(),
	};
}

function createUnknownAssetPayload({
	rawKind,
	sourceAssetKind,
	residencyKind,
	debugPrimitive,
	paletteKey,
	provenance,
}: {
	rawKind: string;
	sourceAssetKind: string | null;
	residencyKind: AssetResidencyKind;
	debugPrimitive: string;
	paletteKey: string;
	provenance: PreparedAssetProvenance;
}): PreparedAssetPayload {
	return {
		kind: "unknown",
		rawKind,
		sourceAssetKind,
		residencyKind,
		provenance,
		debugPresentation: {
			primitive: debugPrimitive,
			paletteKey,
		},
	};
}

function parseProvenance(value: unknown): PreparedAssetProvenance {
	const provenance = assetProvenanceDtoSchema.safeParse(value);
	if (!provenance.success) {
		return {
			source: "unknown",
			sourceAssetKind: null,
			errorCode: null,
			detail: null,
		};
	}

	return {
		source: parseProvenanceSource(provenance.data.source),
		sourceAssetKind: provenance.data.sourceAssetKind,
		errorCode: parseErrorCode(provenance.data.errorCode),
		detail: provenance.data.detail,
	};
}

function parseResidencyKind(value: unknown): AssetResidencyKind {
	if (
		value === "landblock" ||
		value === "outdoor-landblock" ||
		value === "interior-cell" ||
		value === "unknown"
	) {
		return value;
	}

	return "unknown";
}

function parseProvenanceSource(
	value: unknown,
): PreparedAssetProvenance["source"] {
	if (
		value === "repo-local-hba" ||
		value === "generated-fallback" ||
		value === "app-local-stub" ||
		value === "unknown"
	) {
		return value;
	}

	return "unknown";
}

function parseErrorCode(value: unknown): AssetErrorCode | null {
	if (
		value === "asset-id-unknown" ||
		value === "asset-archive-open-failed" ||
		value === "asset-read-failed" ||
		value === "asset-decode-failed" ||
		value === "cell-landblock-unavailable"
	) {
		return value;
	}

	return null;
}

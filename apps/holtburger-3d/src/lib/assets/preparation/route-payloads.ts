import type { ZodIssue } from "zod";
import type {
	AssetLookupResponseDto,
	AnimationPayloadDto,
	GfxObjPayloadDto,
	LandblockSceneLodPayloadDto,
	MaterialRecipePayloadDto,
	PaletteMetadataPayloadDto,
	PalettePayloadDto,
	PreparedTexturePayloadDto,
	RegionRenderProfilePayloadDto,
	RenderSurfaceMetadataPayloadDto,
	RenderSurfacePayloadDto,
	SetupAppearancePayloadDto,
	SetupModelPayloadDto,
	SurfaceTexturePayloadDto,
	TerrainMaterialPayloadDto,
} from "../../../lib/host/contracts";
import {
	animationPayloadDtoSchema,
	gfxObjPayloadDtoSchema,
	landblockSceneLodPayloadDtoSchema,
	materialRecipePayloadDtoSchema,
	paletteMetadataPayloadDtoSchema,
	palettePayloadDtoSchema,
	preparedTexturePayloadDtoSchema,
	regionRenderProfilePayloadDtoSchema,
	renderSurfaceMetadataPayloadDtoSchema,
	renderSurfacePayloadDtoSchema,
	setupAppearancePayloadDtoSchema,
	setupModelPayloadDtoSchema,
	surfaceTexturePayloadDtoSchema,
	terrainMaterialPayloadDtoSchema,
} from "../../../lib/host/contracts";
import {
	requirePreparedGfxObjPayload,
	type PreparedGfxObjPayloadDto,
} from "./prepared-render-geometry";

export type V2PreparedAssetPayload =
	| LandblockSceneLodPayloadDto
	| AnimationPayloadDto
	| PreparedGfxObjPayloadDto
	| SetupModelPayloadDto
	| SetupAppearancePayloadDto
	| MaterialRecipePayloadDto
	| TerrainMaterialPayloadDto
	| RegionRenderProfilePayloadDto
	| SurfaceTexturePayloadDto
	| RenderSurfacePayloadDto
	| RenderSurfaceMetadataPayloadDto
	| PreparedTexturePayloadDto
	| PalettePayloadDto
	| PaletteMetadataPayloadDto;

interface PayloadSchema<TPayload> {
	safeParse(
		value: unknown,
	):
		| { success: true; data: TPayload }
		| { success: false; error: { issues: readonly ZodIssue[] } };
}

interface RoutePayloadParser {
	readonly route: RegExp;
	readonly expectedKind: string;
	readonly schema: PayloadSchema<unknown>;
}

const HEX32_ROUTE_SEGMENT = "[0-9a-fA-F]{8}";
const SETUP_APPEARANCE_ROUTE = new RegExp(
	`^setup-appearance/${HEX32_ROUTE_SEGMENT}(?:\\?.*)?$`,
);

const V2_PAYLOAD_PARSERS: readonly RoutePayloadParser[] = [
	{
		expectedKind: "landblock-scene-lod",
		route: /^landblock\/[0-9a-fA-F]{8}\/lod\/[0-4]$/,
		schema: landblockSceneLodPayloadDtoSchema,
	},
	{
		expectedKind: "animation",
		route: /^animation\/[0-9a-fA-F]{8}$/,
		schema: animationPayloadDtoSchema,
	},
	{
		expectedKind: "gfx-obj",
		route: /^gfx-obj\/[0-9a-fA-F]{8}$/,
		schema: gfxObjPayloadDtoSchema,
	},
	{
		expectedKind: "setup-model",
		route: /^setup-model\/[0-9a-fA-F]{8}$/,
		schema: setupModelPayloadDtoSchema,
	},
	{
		expectedKind: "setup-appearance",
		route: SETUP_APPEARANCE_ROUTE,
		schema: setupAppearancePayloadDtoSchema,
	},
	{
		expectedKind: "material-recipe",
		route: /^material\/[0-9a-fA-F]{8}$/,
		schema: materialRecipePayloadDtoSchema,
	},
	{
		expectedKind: "terrain-material",
		route: /^terrain-material\/[0-9]+$/,
		schema: terrainMaterialPayloadDtoSchema,
	},
	{
		expectedKind: "region-render-profile",
		route: /^region-render-profile\/[0-9]+$/,
		schema: regionRenderProfilePayloadDtoSchema,
	},
	{
		expectedKind: "surface-texture",
		route: /^surface-texture\/[0-9a-fA-F]{8}$/,
		schema: surfaceTexturePayloadDtoSchema,
	},
	{
		expectedKind: "render-surface",
		route: /^render-surface\/[0-9a-fA-F]{8}$/,
		schema: renderSurfacePayloadDtoSchema,
	},
	{
		expectedKind: "render-surface-metadata",
		route: /^render-surface-metadata\/[0-9a-fA-F]{8}$/,
		schema: renderSurfaceMetadataPayloadDtoSchema,
	},
	{
		expectedKind: "prepared-texture",
		route: /^prepared-texture\/[0-9a-fA-F]{8}(?:\?.*)?$/,
		schema: preparedTexturePayloadDtoSchema,
	},
	{
		expectedKind: "palette",
		route: /^palette\/[0-9a-fA-F]{8}$/,
		schema: palettePayloadDtoSchema,
	},
	{
		expectedKind: "palette-metadata",
		route: /^palette-metadata\/[0-9a-fA-F]{8}$/,
		schema: paletteMetadataPayloadDtoSchema,
	},
];

export function prepareV2AssetPayload(
	response: AssetLookupResponseDto,
): V2PreparedAssetPayload {
	const parser = V2_PAYLOAD_PARSERS.find((candidate) =>
		candidate.route.test(response.assetId),
	);

	if (!parser) {
		throw new Error(
			`asset preparation does not support host asset route ${response.assetId}.`,
		);
	}

	const payload = parseExpectedRoutePayload(
		response.assetId,
		parser.expectedKind,
		parser.schema,
		response.payload,
	);
	if (isGfxObjPayload(payload)) {
		return requirePreparedGfxObjPayload(
			payload,
			`Prepared gfx-obj ${response.assetId}.renderGeometry`,
		);
	}
	return payload as V2PreparedAssetPayload;
}

function parseExpectedRoutePayload<TPayload>(
	assetId: string,
	expectedKind: string,
	schema: PayloadSchema<TPayload>,
	payload: unknown,
): TPayload {
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

function isGfxObjPayload(payload: unknown): payload is GfxObjPayloadDto {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"kind" in payload &&
		payload.kind === "gfx-obj"
	);
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

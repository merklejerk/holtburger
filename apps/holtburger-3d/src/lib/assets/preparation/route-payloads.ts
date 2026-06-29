import type { ZodIssue } from "zod";
import type {
	AssetLookupResponseDto,
	AnimationPayloadDto,
	LandblockEnvCellsPayloadDto,
	LandblockOutdoorPayloadDto,
	GfxObjPayloadDto,
	MaterialRecipePayloadDto,
	PalettePayloadDto,
	PreparedTexturePayloadDto,
	RegionRenderProfilePayloadDto,
	RenderSurfacePayloadDto,
	SetupAppearancePayloadDto,
	SetupModelPayloadDto,
	SurfaceTexturePayloadDto,
	TerrainMaterialPayloadDto,
} from "../../../lib/host/contracts";
import {
	animationPayloadDtoSchema,
	gfxObjPayloadDtoSchema,
	landblockEnvCellsPayloadDtoSchema,
	landblockOutdoorPayloadDtoSchema,
	materialRecipePayloadDtoSchema,
	palettePayloadDtoSchema,
	preparedTexturePayloadDtoSchema,
	regionRenderProfilePayloadDtoSchema,
	renderSurfacePayloadDtoSchema,
	setupAppearancePayloadDtoSchema,
	setupModelPayloadDtoSchema,
	surfaceTexturePayloadDtoSchema,
	terrainMaterialPayloadDtoSchema,
} from "../../../lib/host/contracts";

export type V2PreparedAssetPayload =
	| LandblockOutdoorPayloadDto
	| LandblockEnvCellsPayloadDto
	| AnimationPayloadDto
	| GfxObjPayloadDto
	| SetupModelPayloadDto
	| SetupAppearancePayloadDto
	| MaterialRecipePayloadDto
	| TerrainMaterialPayloadDto
	| RegionRenderProfilePayloadDto
	| SurfaceTexturePayloadDto
	| RenderSurfacePayloadDto
	| PreparedTexturePayloadDto
	| PalettePayloadDto;

interface PayloadSchema<TPayload> {
	safeParse(
		value: unknown,
	):
		| { success: true; data: TPayload }
		| { success: false; error: { issues: readonly ZodIssue[] } };
}

interface RoutePayloadParser<TPayload extends V2PreparedAssetPayload> {
	readonly route: RegExp;
	readonly expectedKind: TPayload["kind"];
	readonly schema: PayloadSchema<TPayload>;
}

const HEX32_ROUTE_SEGMENT = "[0-9a-fA-F]{8}";
const RUNTIME_SETUP_APPEARANCE_ROUTE = new RegExp(
	`^runtime-setup-appearance/${HEX32_ROUTE_SEGMENT}(?:\\?.*)?$`,
);

const V2_PAYLOAD_PARSERS: readonly RoutePayloadParser<V2PreparedAssetPayload>[] =
	[
		{
			expectedKind: "landblock-outdoor",
			route: /^landblock\/[0-9a-fA-F]{8}\/outdoor$/,
			schema: landblockOutdoorPayloadDtoSchema,
		},
		{
			expectedKind: "landblock-env-cells",
			route: /^landblock\/[0-9a-fA-F]{8}\/env-cells$/,
			schema: landblockEnvCellsPayloadDtoSchema,
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
			route: /^setup-appearance\/[0-9a-fA-F]{8}$/,
			schema: setupAppearancePayloadDtoSchema,
		},
		{
			expectedKind: "setup-appearance",
			route: RUNTIME_SETUP_APPEARANCE_ROUTE,
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
			expectedKind: "prepared-texture",
			route: /^prepared-texture\/[0-9a-fA-F]{8}(?:\?.*)?$/,
			schema: preparedTexturePayloadDtoSchema,
		},
		{
			expectedKind: "palette",
			route: /^palette\/[0-9a-fA-F]{8}$/,
			schema: palettePayloadDtoSchema,
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

	return parseExpectedRoutePayload(
		response.assetId,
		parser.expectedKind,
		parser.schema,
		response.payload,
	);
}

function parseExpectedRoutePayload<TPayload extends V2PreparedAssetPayload>(
	assetId: string,
	expectedKind: TPayload["kind"],
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

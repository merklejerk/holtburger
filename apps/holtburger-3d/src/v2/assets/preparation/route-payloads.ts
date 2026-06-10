import type { ZodIssue } from "zod";
import type {
	AssetLookupResponseDto,
	LandblockOutdoorPayloadDto,
	LandblockTopologyPayloadDto,
	PalettePayloadDto,
	PreparedTexturePayloadDto,
	RegionRenderProfilePayloadDto,
	RenderSurfacePayloadDto,
	SurfaceTexturePayloadDto,
	TerrainMaterialPayloadDto,
} from "../../../lib/host/contracts";
import {
	landblockOutdoorPayloadDtoSchema,
	landblockTopologyPayloadDtoSchema,
	palettePayloadDtoSchema,
	preparedTexturePayloadDtoSchema,
	regionRenderProfilePayloadDtoSchema,
	renderSurfacePayloadDtoSchema,
	surfaceTexturePayloadDtoSchema,
	terrainMaterialPayloadDtoSchema,
} from "../../../lib/host/contracts";

export type V2PreparedAssetPayload =
	| LandblockOutdoorPayloadDto
	| LandblockTopologyPayloadDto
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

const TERRAIN_SLICE_PAYLOAD_PARSERS: readonly RoutePayloadParser<V2PreparedAssetPayload>[] =
	[
		{
			expectedKind: "landblock-outdoor",
			route: /^landblock\/[0-9a-fA-F]{8}\/outdoor$/,
			schema: landblockOutdoorPayloadDtoSchema,
		},
		{
			expectedKind: "landblock-topology",
			route: /^landblock\/[0-9a-fA-F]{8}\/topology$/,
			schema: landblockTopologyPayloadDtoSchema,
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

export function prepareTerrainSliceAssetPayload(
	response: AssetLookupResponseDto,
): V2PreparedAssetPayload {
	const parser = TERRAIN_SLICE_PAYLOAD_PARSERS.find((candidate) =>
		candidate.route.test(response.assetId),
	);

	if (!parser) {
		throw new Error(
			`V2 asset preparation does not support host asset route ${response.assetId}.`,
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

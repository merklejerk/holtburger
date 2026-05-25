import type {
	AssetErrorCode,
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	DependencyManifestPayloadDto,
	EnvCellPayloadDto,
	GfxObjPayloadDto,
	LandblockOutdoorPayloadDto,
	LandblockTopologyPayloadDto,
	MaterialRecipePayloadDto,
	PalettePayloadDto,
	RenderSurfacePayloadDto,
	RenderTexturePayloadDto,
	SetupAppearancePayloadDto,
	SetupModelPayloadDto,
	TerrainMaterialPayloadDto,
} from "../lib/host/contracts";
import {
	assetProvenanceDtoSchema,
	dependencyManifestPayloadDtoSchema,
	envCellPayloadDtoSchema,
	genericAssetPayloadDtoSchema,
	gfxObjPayloadDtoSchema,
	landblockOutdoorPayloadDtoSchema,
	landblockTopologyPayloadDtoSchema,
	materialRecipePayloadDtoSchema,
	palettePayloadDtoSchema,
	renderSurfacePayloadDtoSchema,
	renderTexturePayloadDtoSchema,
	setupAppearancePayloadDtoSchema,
	setupModelPayloadDtoSchema,
	terrainMaterialPayloadDtoSchema,
} from "../lib/host/contracts";
import { isSetupAppearanceAssetId } from "../lib/assets/asset-hydration-policy";
import { decodeBinaryAssetBatchEnvelope } from "../lib/host/binary-asset-envelope";
import type {
	AssetResidencyKind,
	PreparedAssetRecord,
	PreparedAssetProvenance,
	PreparedAssetPayload,
	PreparedPolygonSetRenderGeometry,
} from "../lib/assets/types";
import type { ZodIssue } from "zod";

export interface AssetWorkerPrepareBatchRequest {
	type: "prepare-assets";
	items: AssetWorkerPrepareBatchItem[];
}

export interface AssetWorkerPrepareBatchItem {
	request: AssetLookupRequestDto;
}

export interface AssetWorkerHostLookupBinaryCompleteMessage {
	type: "host-lookup-assets-binary-complete";
	requestId: string;
	envelopes: AssetWorkerHostBinaryEnvelope[];
}

export interface AssetWorkerHostLookupBinaryErrorMessage {
	type: "host-lookup-assets-binary-error";
	requestId: string;
	message: string;
}

export interface AssetWorkerHostBinaryEnvelope {
	payload: ArrayBuffer;
}

export interface AssetWorkerPreparedAssetMessage {
	type: "asset-ready";
	asset: PreparedAssetRecord;
}

export interface AssetWorkerErrorMessage {
	type: "asset-error";
	requestId: string;
	assetId: string;
	message: string;
}

export interface AssetWorkerPreparedBatchMessage {
	type: "assets-prepared";
	results: AssetWorkerPreparedResult[];
}

export interface AssetWorkerHostLookupBinaryRequestMessage {
	type: "host-lookup-assets-binary";
	requestId: string;
	requests: AssetLookupRequestDto[];
}

export type AssetWorkerRequestMessage =
	| AssetWorkerPrepareBatchRequest
	| AssetWorkerHostLookupBinaryCompleteMessage
	| AssetWorkerHostLookupBinaryErrorMessage;
export type AssetWorkerPreparedResult =
	| AssetWorkerPreparedAssetMessage
	| AssetWorkerErrorMessage;
export type AssetWorkerResponseMessage =
	| AssetWorkerPreparedBatchMessage
	| AssetWorkerHostLookupBinaryRequestMessage;

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

	const renderTexturePayload = renderTexturePayloadDtoSchema.safeParse(
		response.payload,
	);
	if (renderTexturePayload.success) {
		return preparePassthroughAsset(
			request,
			response,
			renderTexturePayload.data,
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

	const dependencyManifestPayload =
		dependencyManifestPayloadDtoSchema.safeParse(response.payload);
	if (dependencyManifestPayload.success) {
		return prepareDependencyManifest(
			request,
			response,
			dependencyManifestPayload.data,
		);
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

	if (/^render-texture\/[0-9a-fA-F]{8}$/.test(request.assetId)) {
		const payload = parseExpectedRoutePayload(
			request.assetId,
			"render-texture",
			renderTexturePayloadDtoSchema,
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
		| RenderTexturePayloadDto
		| RenderSurfacePayloadDto
		| PalettePayloadDto
		| TerrainMaterialPayloadDto,
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

function prepareDependencyManifest(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload: DependencyManifestPayloadDto,
): PreparedAssetRecord {
	return {
		request,
		response,
		payload: {
			kind: "dependency-manifest",
			sourceAssetKind: "dependency-manifest",
			residencyKind: parseResidencyKind(payload.residencyKind),
			provenance: parseProvenance(payload.provenance),
			dependencyAssetIds: parseDependencies(payload.dependencyAssetIds),
		},
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

function parseDependencies(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return [
		...new Set(
			value.filter(
				(assetId): assetId is string =>
					typeof assetId === "string" && assetId.length > 0,
			),
		),
	].sort();
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

type AssetWorkerRuntimeScope = typeof globalThis & {
	onmessage?: ((event: MessageEvent<AssetWorkerRequestMessage>) => void) | null;
	postMessage?: (
		message: AssetWorkerResponseMessage,
		transfer?: Transferable[],
	) => void;
	document?: unknown;
};

const workerScope = globalThis as AssetWorkerRuntimeScope;
const ASSET_WORKER_DIAGNOSTIC_BUILD = "asset-worker-diag-2026-05-24a";

class AssetWorkerHostBridge {
	private nextRequestIndex = 1;
	private readonly pendingLookups = new Map<
		string,
		{
			resolve: (envelopes: AssetWorkerHostBinaryEnvelope[]) => void;
			reject: (error: Error) => void;
		}
	>();

	constructor(private readonly workerScope: AssetWorkerRuntimeScope) {}

	async lookupBinaryAssets(
		requests: readonly AssetLookupRequestDto[],
	): Promise<AssetLookupResponseDto[]> {
		if (requests.length === 0) {
			return [];
		}

		const envelopes = await this.requestBinaryEnvelopes(requests);
		const responses = envelopes.flatMap((envelope) =>
			decodeBinaryAssetBatchEnvelope(envelope.payload),
		);
		const missingPayloadResponses = responses.filter(
			(response) => response.payload === undefined,
		);
		if (missingPayloadResponses.length > 0) {
			throw new Error(
				`Host binary lookup decoded ${missingPayloadResponses.length} response(s) without payload: ${JSON.stringify(
					missingPayloadResponses.map((response) => ({
						requestId: response.requestId,
						assetId: response.assetId,
						payloadKind: response.payloadKind,
						keys: Object.keys(response),
					})),
				)}.`,
			);
		}
		return responses;
	}

	resolve(message: AssetWorkerHostLookupBinaryCompleteMessage): void {
		const pending = this.pendingLookups.get(message.requestId);
		if (!pending) {
			return;
		}
		this.pendingLookups.delete(message.requestId);
		pending.resolve(message.envelopes);
	}

	reject(message: AssetWorkerHostLookupBinaryErrorMessage): void {
		const pending = this.pendingLookups.get(message.requestId);
		if (!pending) {
			return;
		}
		this.pendingLookups.delete(message.requestId);
		pending.reject(new Error(message.message));
	}

	private requestBinaryEnvelopes(
		requests: readonly AssetLookupRequestDto[],
	): Promise<AssetWorkerHostBinaryEnvelope[]> {
		const requestId = `asset-worker-host-${this.nextRequestIndex++}`;
		return new Promise((resolve, reject) => {
			this.pendingLookups.set(requestId, { resolve, reject });
			this.workerScope.postMessage?.({
				type: "host-lookup-assets-binary",
				requestId,
				requests: [...requests],
			});
		});
	}
}

class AssetWorkerPrepareScheduler {
	constructor(
		private readonly hostBridge: AssetWorkerHostBridge,
		private readonly workerScope: AssetWorkerRuntimeScope,
	) {}

	enqueue(items: readonly AssetWorkerPrepareBatchItem[]): void {
		if (items.length === 0) {
			return;
		}
		void this.processBatch(items.map((item) => ({ ...item })));
	}

	private async processBatch(
		items: readonly AssetWorkerPrepareBatchItem[],
	): Promise<void> {
		const results: AssetWorkerPreparedResult[] = [];
		const transferables: Transferable[] = [];
		let responses: AssetLookupResponseDto[];

		try {
			responses = await this.hostBridge.lookupBinaryAssets(
				items.map((item) => item.request),
			);
		} catch (error) {
			this.postBatchError(items, error);
			return;
		}

		const responsesByRequestId = new Map(
			responses.map((response) => [response.requestId, response]),
		);
		const preparedAssets: PreparedAssetRecord[] = [];

		for (const item of items) {
			try {
				const response = responsesByRequestId.get(item.request.requestId);
				if (!response) {
					throw new Error(
						`Host binary lookup did not return ${item.request.assetId}.`,
					);
				}
				const asset = prepareAssetPayload(item.request, response);
				transferables.push(...prepareAssetForPostMessage(asset));
				preparedAssets.push(asset);
			} catch (error) {
				results.push({
					type: "asset-error",
					requestId: item.request.requestId,
					assetId: item.request.assetId,
					message: formatWorkerDiagnosticError(error),
				});
			}
		}

		for (const asset of preparedAssets) {
			results.push({
				type: "asset-ready",
				asset,
			});
		}
		this.workerScope.postMessage?.(
			{
				type: "assets-prepared",
				results,
			},
			transferables,
		);
	}

	private postBatchError(
		items: readonly AssetWorkerPrepareBatchItem[],
		error: unknown,
	): void {
		this.workerScope.postMessage?.({
			type: "assets-prepared",
			results: items.map((item) => ({
				type: "asset-error",
				requestId: item.request.requestId,
				assetId: item.request.assetId,
				message: formatWorkerDiagnosticError(error),
			})),
		});
	}
}

function formatWorkerDiagnosticError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `[${ASSET_WORKER_DIAGNOSTIC_BUILD}] ${message}`;
}

if (
	typeof workerScope.postMessage === "function" &&
	typeof workerScope.document === "undefined"
) {
	const hostBridge = new AssetWorkerHostBridge(workerScope);
	const prepareScheduler = new AssetWorkerPrepareScheduler(
		hostBridge,
		workerScope,
	);
	workerScope.onmessage = async (
		event: MessageEvent<AssetWorkerRequestMessage>,
	) => {
		if (event.data.type === "host-lookup-assets-binary-complete") {
			hostBridge.resolve(event.data);
			return;
		}
		if (event.data.type === "host-lookup-assets-binary-error") {
			hostBridge.reject(event.data);
			return;
		}
		prepareScheduler.enqueue(event.data.items);
	};
}

function prepareAssetForPostMessage(
	asset: PreparedAssetRecord,
): Transferable[] {
	const transferables: Transferable[] = [];
	const transferredBuffers = new Set<ArrayBuffer>();
	asset.response = createPreparedResponseSummary(asset.response);
	collectPreparedAssetTransferables(asset, transferables, transferredBuffers);
	return transferables;
}

function createPreparedResponseSummary(
	response: AssetLookupResponseDto,
): AssetLookupResponseDto {
	return {
		requestId: response.requestId,
		assetId: response.assetId,
		payloadKind: response.payloadKind,
		payload: {
			kind: "prepared-response-summary",
		},
	};
}

function collectPreparedAssetTransferables(
	asset: PreparedAssetRecord,
	transferables: Transferable[],
	transferredBuffers: Set<ArrayBuffer>,
): void {
	if (asset.payload.kind === "gfx-obj") {
		normalizeRenderGeometryForTransfer(
			asset.payload.renderGeometry,
			transferables,
			transferredBuffers,
		);
		return;
	}

	if (asset.payload.kind === "env-cell") {
		normalizeRenderGeometryForTransfer(
			asset.payload.renderGeometry,
			transferables,
			transferredBuffers,
		);
		return;
	}

	if (asset.payload.kind === "render-surface") {
		asset.payload.sourceBytes = normalizeUint8ArrayForTransfer(
			asset.payload.sourceBytes,
			transferables,
			transferredBuffers,
		);
		return;
	}

	if (asset.payload.kind === "palette") {
		asset.payload.colorsArgb = normalizeUint32ArrayForTransfer(
			asset.payload.colorsArgb,
			transferables,
			transferredBuffers,
		);
		return;
	}
}

function normalizeRenderGeometryForTransfer(
	renderGeometry: PreparedPolygonSetRenderGeometry,
	transferables: Transferable[],
	transferredBuffers: Set<ArrayBuffer>,
): void {
	renderGeometry.positions = normalizeFloat32ArrayForTransfer(
		renderGeometry.positions,
		transferables,
		transferredBuffers,
	);
	renderGeometry.normals = normalizeFloat32ArrayForTransfer(
		renderGeometry.normals,
		transferables,
		transferredBuffers,
	);
	renderGeometry.uvs = normalizeFloat32ArrayForTransfer(
		renderGeometry.uvs,
		transferables,
		transferredBuffers,
	);
}

function normalizeFloat32ArrayForTransfer(
	values: number[] | Float32Array,
	transferables: Transferable[],
	transferredBuffers: Set<ArrayBuffer>,
): Float32Array {
	const typedValues = createTransferableFloat32Array(values);
	collectTransferableBuffer(typedValues, transferables, transferredBuffers);
	return typedValues;
}

function normalizeUint8ArrayForTransfer(
	values: Uint8Array,
	transferables: Transferable[],
	transferredBuffers: Set<ArrayBuffer>,
): Uint8Array {
	const typedValues = createTransferableUint8Array(values);
	collectTransferableBuffer(typedValues, transferables, transferredBuffers);
	return typedValues;
}

function createTransferableUint8Array(values: Uint8Array): Uint8Array {
	if (
		values.byteOffset === 0 &&
		values.byteLength === values.buffer.byteLength &&
		isTransferableArrayBuffer(values.buffer)
	) {
		return values;
	}

	return new Uint8Array(values);
}

function normalizeUint32ArrayForTransfer(
	values: Uint32Array,
	transferables: Transferable[],
	transferredBuffers: Set<ArrayBuffer>,
): Uint32Array {
	const typedValues = createTransferableUint32Array(values);
	collectTransferableBuffer(typedValues, transferables, transferredBuffers);
	return typedValues;
}

function createTransferableUint32Array(values: Uint32Array): Uint32Array {
	if (
		values.byteOffset === 0 &&
		values.byteLength === values.buffer.byteLength &&
		isTransferableArrayBuffer(values.buffer)
	) {
		return values;
	}

	return new Uint32Array(values);
}

function collectTransferableBuffer(
	values: ArrayBufferView,
	transferables: Transferable[],
	transferredBuffers: Set<ArrayBuffer>,
): void {
	const buffer = values.buffer;
	if (
		values.byteLength > 0 &&
		values.byteOffset === 0 &&
		values.byteLength === buffer.byteLength &&
		isTransferableArrayBuffer(buffer) &&
		!transferredBuffers.has(buffer)
	) {
		transferredBuffers.add(buffer);
		transferables.push(buffer);
	}
}

function createTransferableFloat32Array(
	values: number[] | Float32Array,
): Float32Array {
	if (!(values instanceof Float32Array)) {
		return new Float32Array(values);
	}

	if (
		values.byteOffset === 0 &&
		values.byteLength === values.buffer.byteLength &&
		isTransferableArrayBuffer(values.buffer)
	) {
		return values;
	}

	return new Float32Array(values);
}

function isTransferableArrayBuffer(
	buffer: ArrayBufferLike,
): buffer is ArrayBuffer {
	return Object.prototype.toString.call(buffer) === "[object ArrayBuffer]";
}

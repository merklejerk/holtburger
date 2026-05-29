import type { AssetChannelState } from "../assets/types";
import {
	createWebgl2ArrayBuffer,
	createWebgl2ElementArrayBuffer,
	createWebgl2Texture2D,
	createWebgl2VertexArray,
	type Webgl2BufferResource,
	type Webgl2Texture2DResource,
	type Webgl2VertexArrayResource,
} from "./webgl2-gl";
import {
	buildStagedWorldSceneAssembly,
	describeStagedWorldAssemblyGraphRecordSignature,
	uniqueSortedStrings,
	type StagedWorldAssemblyGraphRecord,
	type StagedWorldDrawUnitAssembly,
} from "./staged-world-assembly";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import type { RenderMat4, RenderVec4 } from "./render-math";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { RenderChunkTransform } from "./render-anchor";
import {
	materialDecisionGraphNodeKey,
	preparedAssetGraphNodeKey,
	sceneObjectGraphNodeKey,
	type RendererResourceGraph,
	type RendererResourceGraphDependencyReplacement,
	type RendererResourceGraphLease,
	type RendererResourceGraphNode,
} from "./renderer-resource-graph";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type {
	DirectRenderSurfaceUploadDataType,
	DirectRenderSurfaceUploadFormat,
	DirectRenderSurfaceUploadInternalFormat,
	RenderSurfaceTextureUploadPreparation,
} from "./render-surface-texture-data";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";
import type { TransitionPortalCandidateModel } from "./transition-portal-work-items";
import {
	describeTextureSamplingPolicy,
	type TextureSamplingPolicy,
} from "./texture-sampling-policy";

export interface Webgl2WorldDrawUnit {
	id: string;
	kind: StagedWorldDrawUnitAssembly["kind"];
	geometrySignature: string;
	vertexArray: Webgl2VertexArrayResource;
	vertexBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource | null;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	vertexCount: number;
	triangleCount: number;
	color: RenderVec4;
	materialKind: StagedWorldDrawUnitAssembly["material"]["kind"];
	materialKey: string;
	materialFallbackReason: string | null;
	materialBehavior: LegacyMaterialBehaviorDto | null;
	textureSamplingPolicy: string | null;
	textureUploadSample: string | null;
	textureKey: string | null;
	texture: Webgl2Texture2DResource | null;
	modelMatrix: RenderMat4;
	bvhItemKeys: readonly RenderBvhItemKey[];
	bvhFallbackReason: string | null;
	staticPartCount: number;
	staticObjectKeys: readonly string[];
}

export interface Webgl2WorldResourceStore {
	drawUnits: Webgl2WorldDrawUnit[];
	drawUnitsById: Map<string, Webgl2WorldDrawUnit>;
	graphLeasesByDrawUnitId: Map<string, RendererResourceGraphLease>;
	graphSignaturesByDrawUnitId: Map<string, string>;
	boundGraph: RendererResourceGraph | null;
	terrainDrawUnitCount: number;
	structuredInteriorDrawUnitCount: number;
	staticDrawUnitCount: number;
	stagedStaticObjectCount: number;
	stagedStaticPartCount: number;
	staticInstanceCount: number;
	materialCount: number;
	directTextureDrawUnitCount: number;
	materialFallbackReasonCount: number;
	materialFallbackReasonSamples: readonly string[];
	textureSamplingPolicyCounts: Record<string, number>;
	textureSamplingPolicySamples: readonly string[];
	textureUploadSamples: readonly string[];
	textureCount: number;
	preparedTextureUploadCount: number;
	preparedTextureGeneratedByteLength: number;
	triangleCount: number;
	texturesByKey: Map<string, Webgl2Texture2DResource>;
}

export function createWebgl2WorldResourceStore(): Webgl2WorldResourceStore {
	return {
		drawUnits: [],
		drawUnitsById: new Map(),
		graphLeasesByDrawUnitId: new Map(),
		graphSignaturesByDrawUnitId: new Map(),
		boundGraph: null,
		terrainDrawUnitCount: 0,
		structuredInteriorDrawUnitCount: 0,
		staticDrawUnitCount: 0,
		stagedStaticObjectCount: 0,
		stagedStaticPartCount: 0,
		staticInstanceCount: 0,
		materialCount: 0,
		directTextureDrawUnitCount: 0,
		materialFallbackReasonCount: 0,
		materialFallbackReasonSamples: [],
		textureSamplingPolicyCounts: {},
		textureSamplingPolicySamples: [],
		textureUploadSamples: [],
		textureCount: 0,
		preparedTextureUploadCount: 0,
		preparedTextureGeneratedByteLength: 0,
		triangleCount: 0,
		texturesByKey: new Map(),
	};
}

export function syncWebgl2WorldResources({
	gl,
	store,
	assetState,
	terrainScene,
	staticRenderableScene,
	structuredInteriorScene,
	transitionPortalModel,
	renderChunkTransforms,
	rendererResourceGraph,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	transitionPortalModel: TransitionPortalCandidateModel;
	renderChunkTransforms: readonly RenderChunkTransform[];
	rendererResourceGraph?: RendererResourceGraph;
}): void {
	// ELEMENT_ARRAY_BUFFER binding is VAO state in WebGL2. Resource sync creates
	// and clears index buffers, so start from the default VAO to avoid stripping
	// the index buffer from whichever draw-unit VAO the previous frame left bound.
	gl.bindVertexArray(null);
	const assembly = buildStagedWorldSceneAssembly({
		assetState,
		terrainScene,
		staticRenderableScene,
		structuredInteriorScene,
		transitionPortalModel,
		renderChunkTransforms,
	});
	const nextDrawUnits: Webgl2WorldDrawUnit[] = [];
	const retainedDrawUnitIds = new Set<string>();
	const retainedTextureKeys = new Set<string>();
	for (const drawUnit of assembly.drawUnits) {
		const webgl2DrawUnit = createOrReuseWebgl2DrawUnit({
			gl,
			store,
			drawUnit,
			retainedDrawUnitIds,
		});
		nextDrawUnits.push(webgl2DrawUnit);
		if (webgl2DrawUnit.textureKey) {
			retainedTextureKeys.add(webgl2DrawUnit.textureKey);
		}
	}

	for (const [drawUnitId, drawUnit] of store.drawUnitsById) {
		if (!retainedDrawUnitIds.has(drawUnitId)) {
			destroyWebgl2DrawUnit(drawUnit);
			store.drawUnitsById.delete(drawUnitId);
		}
	}

	store.drawUnits = nextDrawUnits;
	store.terrainDrawUnitCount = store.drawUnits.filter(
		(drawUnit) => drawUnit.kind === "terrain",
	).length;
	store.structuredInteriorDrawUnitCount = store.drawUnits.filter(
		(drawUnit) => drawUnit.kind === "structured-interior",
	).length;
	store.staticDrawUnitCount = store.drawUnits.filter(
		(drawUnit) => drawUnit.kind === "static",
	).length;
	store.stagedStaticObjectCount = countUniqueStaticObjectKeys(store.drawUnits);
	store.stagedStaticPartCount = countUniqueBvhItemKeys(
		store.drawUnits.filter((drawUnit) => drawUnit.id.startsWith("static-staged/")),
	);
	store.staticInstanceCount = countUniqueBvhItemKeys(
		store.drawUnits.filter((drawUnit) => drawUnit.kind === "static"),
	);
	store.materialCount = new Set(
		store.drawUnits.map((drawUnit) => drawUnit.materialKey),
	).size;
	store.directTextureDrawUnitCount = store.drawUnits.filter(
		(drawUnit) => drawUnit.materialKind === "direct-texture",
	).length;
	const materialFallbackReasons = store.drawUnits.flatMap((drawUnit) =>
		drawUnit.materialFallbackReason ? [drawUnit.materialFallbackReason] : [],
	);
	store.materialFallbackReasonCount = materialFallbackReasons.length;
	store.materialFallbackReasonSamples = [
		...new Set(materialFallbackReasons),
	].slice(0, 8);
	const textureSamplingPolicies = store.drawUnits.flatMap((drawUnit) =>
		drawUnit.textureSamplingPolicy ? [drawUnit.textureSamplingPolicy] : [],
	);
	store.textureSamplingPolicyCounts = countStringOccurrences(
		textureSamplingPolicies,
	);
	store.textureSamplingPolicySamples = [
		...new Set(textureSamplingPolicies),
	].slice(0, 8);
	store.textureUploadSamples = [...collectTextureUploadSamples(store.drawUnits)];
	for (const [textureKey, texture] of store.texturesByKey) {
		if (!retainedTextureKeys.has(textureKey)) {
			texture.dispose();
			store.texturesByKey.delete(textureKey);
		}
	}
	store.textureCount = store.texturesByKey.size;
	store.preparedTextureUploadCount = countPreparedTextureUploads(store.drawUnits);
	store.preparedTextureGeneratedByteLength = 0;
	store.triangleCount = store.drawUnits.reduce(
		(total, drawUnit) => total + drawUnit.triangleCount,
		0,
	);
	syncWebgl2AssemblyGraph({
		graph: rendererResourceGraph,
		store,
		records: assembly.graphRecords,
		retainedDrawUnitIds,
	});
}

export function destroyWebgl2WorldResources(
	store: Webgl2WorldResourceStore,
): void {
	if (store.boundGraph) {
		for (const lease of store.graphLeasesByDrawUnitId.values()) {
			store.boundGraph.releaseLease(lease);
		}
	}
	for (const drawUnit of store.drawUnits) {
		destroyWebgl2DrawUnit(drawUnit);
	}
	store.drawUnits = [];
	store.drawUnitsById.clear();
	store.graphLeasesByDrawUnitId.clear();
	store.graphSignaturesByDrawUnitId.clear();
	store.boundGraph = null;
	store.terrainDrawUnitCount = 0;
	store.structuredInteriorDrawUnitCount = 0;
	store.staticDrawUnitCount = 0;
	store.stagedStaticObjectCount = 0;
	store.stagedStaticPartCount = 0;
	store.staticInstanceCount = 0;
	store.materialCount = 0;
	store.directTextureDrawUnitCount = 0;
	store.materialFallbackReasonCount = 0;
	store.materialFallbackReasonSamples = [];
	store.textureSamplingPolicyCounts = {};
	store.textureSamplingPolicySamples = [];
	store.textureUploadSamples = [];
	for (const texture of store.texturesByKey.values()) {
		texture.dispose();
	}
	store.texturesByKey.clear();
	store.textureCount = 0;
	store.preparedTextureUploadCount = 0;
	store.preparedTextureGeneratedByteLength = 0;
	store.triangleCount = 0;
}

function createOrReuseWebgl2DrawUnit({
	gl,
	store,
	drawUnit,
	retainedDrawUnitIds,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	drawUnit: StagedWorldDrawUnitAssembly;
	retainedDrawUnitIds: Set<string>;
}): Webgl2WorldDrawUnit {
	const geometrySignature = createGeometrySignature(drawUnit);
	const previous = store.drawUnitsById.get(drawUnit.id);
	if (previous && previous.geometrySignature === geometrySignature) {
		previous.color = drawUnit.material.color;
		previous.materialKind = drawUnit.material.kind;
		previous.materialKey = drawUnit.material.key;
		previous.materialFallbackReason = resolveWebgl2MaterialFallbackReason(drawUnit);
		previous.materialBehavior = drawUnit.material.behavior;
		previous.textureSamplingPolicy =
			resolveWebgl2DrawUnitTextureSamplingPolicy(drawUnit);
		previous.textureUploadSample = resolveWebgl2DrawUnitTextureUploadSample(
			drawUnit,
		);
		previous.textureKey =
			drawUnit.material.kind === "direct-texture"
				? drawUnit.material.textureKey
				: null;
		previous.texture = resolveWebgl2DrawUnitTexture({ gl, store, drawUnit });
		previous.modelMatrix = drawUnit.modelMatrix;
		previous.bvhItemKeys = drawUnit.bvhBinding.itemKeys;
		previous.bvhFallbackReason = drawUnit.bvhBinding.fallbackReason;
		previous.staticPartCount = drawUnit.staticPartCount;
		previous.staticObjectKeys = [...drawUnit.staticObjectKeys];
		retainedDrawUnitIds.add(drawUnit.id);
		return previous;
	}
	if (previous) {
		destroyWebgl2DrawUnit(previous);
	}

	const vertexBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${drawUnit.id}/positions`,
		data: drawUnit.geometry.positions,
	});
	const indexBuffer = createWebgl2ElementArrayBuffer(gl, {
		label: `${drawUnit.id}/indices`,
		data: drawUnit.geometry.indices,
	});
	const uvBuffer =
		drawUnit.material.kind === "direct-texture" && drawUnit.geometry.uvs
			? createWebgl2ArrayBuffer(gl, {
					label: `${drawUnit.id}/uvs`,
					data: drawUnit.geometry.uvs,
				})
			: null;
	const vertexArray = createWebgl2VertexArray(gl, {
		label: `${drawUnit.id}/vertex-array`,
		configure() {
			gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer.buffer);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
			if (uvBuffer) {
				gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer.buffer);
				gl.enableVertexAttribArray(1);
				gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
			}
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		},
	});
	const texture = resolveWebgl2DrawUnitTexture({ gl, store, drawUnit });
	const webgl2DrawUnit = {
		id: drawUnit.id,
		kind: drawUnit.kind,
		geometrySignature,
		vertexArray,
		vertexBuffer,
		uvBuffer,
		indexBuffer,
		indexType:
			drawUnit.geometry.indices instanceof Uint32Array
				? gl.UNSIGNED_INT
				: gl.UNSIGNED_SHORT,
		vertexCount: drawUnit.geometry.indices.length,
		triangleCount: drawUnit.geometry.triangleCount,
		color: drawUnit.material.color,
		materialKind: drawUnit.material.kind,
		materialKey: drawUnit.material.key,
		materialFallbackReason: resolveWebgl2MaterialFallbackReason(drawUnit),
		materialBehavior: drawUnit.material.behavior,
		textureSamplingPolicy: resolveWebgl2DrawUnitTextureSamplingPolicy(drawUnit),
		textureUploadSample: resolveWebgl2DrawUnitTextureUploadSample(drawUnit),
		textureKey:
			drawUnit.material.kind === "direct-texture"
				? drawUnit.material.textureKey
				: null,
		texture,
		modelMatrix: drawUnit.modelMatrix,
		bvhItemKeys: drawUnit.bvhBinding.itemKeys,
		bvhFallbackReason: drawUnit.bvhBinding.fallbackReason,
		staticPartCount: drawUnit.staticPartCount,
		staticObjectKeys: [...drawUnit.staticObjectKeys],
	} satisfies Webgl2WorldDrawUnit;
	store.drawUnitsById.set(drawUnit.id, webgl2DrawUnit);
	retainedDrawUnitIds.add(drawUnit.id);
	return webgl2DrawUnit;
}

function destroyWebgl2DrawUnit(drawUnit: Webgl2WorldDrawUnit): void {
	drawUnit.vertexArray.dispose();
	drawUnit.vertexBuffer.dispose();
	drawUnit.uvBuffer?.dispose();
	drawUnit.indexBuffer.dispose();
}

function resolveWebgl2MaterialFallbackReason(
	drawUnit: StagedWorldDrawUnitAssembly,
): string | null {
	if (drawUnit.material.kind === "direct-texture") {
		if (!drawUnit.geometry.uvs) {
			return `webgl2 direct texture ${drawUnit.material.key} has no UV buffer`;
		}
		return drawUnit.material.fallbackReason;
	}
	return drawUnit.material.fallbackReason;
}

function resolveWebgl2DrawUnitTextureSamplingPolicy(
	drawUnit: StagedWorldDrawUnitAssembly,
): string | null {
	return drawUnit.material.kind === "direct-texture"
		? describeTextureSamplingPolicy(
				drawUnit.material.textureUpload.upload.samplingPolicy,
			)
		: null;
}

function resolveWebgl2DrawUnitTextureUploadSample(
	drawUnit: StagedWorldDrawUnitAssembly,
): string | null {
	if (drawUnit.material.kind !== "direct-texture") {
		return null;
	}
	const upload = drawUnit.material.textureUpload.upload;
	if (upload.kind !== "direct") {
		return null;
	}
	const stats = sampleDirectTextureBytes(upload.data, upload.format);
	return [
		drawUnit.material.textureKey,
		`${upload.width}x${upload.height}`,
		upload.format,
		upload.dataType,
		`mips=${upload.samplingPolicy.generateMipmaps ? "on" : "off"}`,
		`first=${stats.firstPixel}`,
		`firstAlpha=${stats.firstAlphaPixel}`,
		`nonZeroRgb=${stats.nonZeroRgbSampleCount}/${stats.sampleCount}`,
		`nonZeroAlpha=${stats.nonZeroAlphaSampleCount}/${stats.sampleCount}`,
	].join(" ");
}

function resolveWebgl2DrawUnitTexture({
	gl,
	store,
	drawUnit,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	drawUnit: StagedWorldDrawUnitAssembly;
}): Webgl2Texture2DResource | null {
	if (drawUnit.material.kind !== "direct-texture" || !drawUnit.geometry.uvs) {
		return null;
	}
	const cached = store.texturesByKey.get(drawUnit.material.textureKey);
	if (cached) {
		return cached;
	}
	const uploadErrorBefore = gl.getError();
	const texture = createWebgl2Texture2D(gl, {
		label: drawUnit.material.textureKey,
		upload: toWebgl2TextureUpload(gl, drawUnit.material.textureUpload),
		sampler: toWebgl2SamplerParameters(
			gl,
			drawUnit.material.textureUpload.upload.samplingPolicy,
		),
	});
	const uploadErrorAfter = gl.getError();
	if (uploadErrorBefore !== gl.NO_ERROR || uploadErrorAfter !== gl.NO_ERROR) {
		store.materialFallbackReasonSamples = [
			...store.materialFallbackReasonSamples,
			`webgl2 texture upload ${drawUnit.material.textureKey} gl errors before=${uploadErrorBefore} after=${uploadErrorAfter}`,
		].slice(0, 8);
	}
	store.texturesByKey.set(drawUnit.material.textureKey, texture);
	return texture;
}

function toWebgl2TextureUpload(
	gl: WebGL2RenderingContext,
	textureUpload: RenderSurfaceTextureUploadPreparation & { status: "ready" },
) {
	const upload = textureUpload.upload;
	if (upload.kind !== "direct") {
		throw new Error(
			`WebGL2 direct material upload does not support compressed texture ${upload.renderSurfaceId}.`,
		);
	}
	const format = toWebgl2TextureFormat(gl, upload.format);
	return {
		width: upload.width,
		height: upload.height,
		internalFormat: toWebgl2TextureInternalFormat(
			gl,
			upload.format,
			upload.dataType,
			upload.internalFormat,
		),
		format,
		type: toWebgl2TextureType(gl, upload.dataType),
		data: upload.data,
		generateMipmaps: upload.samplingPolicy.generateMipmaps,
	};
}

function toWebgl2TextureFormat(
	gl: WebGL2RenderingContext,
	format: DirectRenderSurfaceUploadFormat,
): GLenum {
	switch (format) {
		case "red":
			return gl.RED;
		case "rgb":
			return gl.RGB;
		case "rgba":
			return gl.RGBA;
	}
}

function toWebgl2TextureInternalFormat(
	gl: WebGL2RenderingContext,
	format: DirectRenderSurfaceUploadFormat,
	dataType: DirectRenderSurfaceUploadDataType,
	internalFormat: DirectRenderSurfaceUploadInternalFormat | null,
): GLenum {
	if (internalFormat === "r8") {
		return gl.R8;
	}
	if (internalFormat === "rgb8") {
		return gl.RGB8;
	}
	if (dataType === "uint16-rgba4444") {
		return gl.RGBA4;
	}
	if (format === "rgb") {
		return gl.RGB8;
	}
	if (format === "red") {
		return gl.R8;
	}
	return gl.RGBA8;
}

function toWebgl2TextureType(
	gl: WebGL2RenderingContext,
	dataType: DirectRenderSurfaceUploadDataType,
): GLenum {
	switch (dataType) {
		case "uint8":
			return gl.UNSIGNED_BYTE;
		case "uint16-rgba4444":
			return gl.UNSIGNED_SHORT_4_4_4_4;
	}
}

function toWebgl2SamplerParameters(
	gl: WebGL2RenderingContext,
	policy: TextureSamplingPolicy,
) {
	return {
		wrapS: policy.wrapS === "repeat" ? gl.REPEAT : gl.CLAMP_TO_EDGE,
		wrapT: policy.wrapT === "repeat" ? gl.REPEAT : gl.CLAMP_TO_EDGE,
		minFilter: toWebgl2MinFilter(gl, policy),
		magFilter: policy.magFilter === "nearest" ? gl.NEAREST : gl.LINEAR,
		maxAnisotropy: policy.anisotropy,
	};
}

function toWebgl2MinFilter(
	gl: WebGL2RenderingContext,
	policy: TextureSamplingPolicy,
): GLenum {
	if (policy.mipFilter === "none") {
		return policy.minFilter === "nearest" ? gl.NEAREST : gl.LINEAR;
	}
	if (policy.minFilter === "nearest") {
		return policy.mipFilter === "nearest"
			? gl.NEAREST_MIPMAP_NEAREST
			: gl.NEAREST_MIPMAP_LINEAR;
	}
	return policy.mipFilter === "nearest"
		? gl.LINEAR_MIPMAP_NEAREST
		: gl.LINEAR_MIPMAP_LINEAR;
}

function countPreparedTextureUploads(
	drawUnits: readonly Webgl2WorldDrawUnit[],
): number {
	return new Set(
		drawUnits.flatMap((drawUnit) =>
			drawUnit.textureKey ? [drawUnit.textureKey] : [],
		),
	).size;
}

function countStringOccurrences(values: readonly string[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const value of values) {
		counts[value] = (counts[value] ?? 0) + 1;
	}
	return counts;
}

function collectTextureUploadSamples(
	drawUnits: readonly Webgl2WorldDrawUnit[],
): readonly string[] {
	const samples = new Map<string, string>();
	for (const drawUnit of drawUnits) {
		if (
			drawUnit.materialKind !== "direct-texture" ||
			!drawUnit.textureKey ||
			samples.has(drawUnit.textureKey)
		) {
			continue;
		}
		samples.set(drawUnit.textureKey, describeDrawUnitTextureUpload(drawUnit));
		if (samples.size >= 8) {
			break;
		}
	}
	return [...samples.values()];
}

function describeDrawUnitTextureUpload(drawUnit: Webgl2WorldDrawUnit): string {
	return drawUnit.textureUploadSample ?? `${drawUnit.textureKey ?? drawUnit.id}: unavailable`;
}

function sampleDirectTextureBytes(
	data: Uint8Array | Uint16Array,
	format: DirectRenderSurfaceUploadFormat,
): {
	firstPixel: string;
	firstAlphaPixel: string;
	nonZeroRgbSampleCount: number;
	nonZeroAlphaSampleCount: number;
	sampleCount: number;
} {
	const channelCount = format === "red" ? 1 : format === "rgb" ? 3 : 4;
	const pixelCount = Math.floor(data.length / channelCount);
	const sampleCount = Math.min(pixelCount, 256);
	let firstPixel = "none";
	let firstAlphaPixel = "none";
	let nonZeroRgbSampleCount = 0;
	let nonZeroAlphaSampleCount = 0;
	for (let pixelIndex = 0; pixelIndex < sampleCount; pixelIndex += 1) {
		const offset = pixelIndex * channelCount;
		const red = data[offset] ?? 0;
		const green = channelCount > 1 ? (data[offset + 1] ?? 0) : red;
		const blue = channelCount > 2 ? (data[offset + 2] ?? 0) : red;
		const alpha = channelCount > 3 ? (data[offset + 3] ?? 255) : 255;
		const pixel = `${red},${green},${blue},${alpha}`;
		if (pixelIndex === 0) {
			firstPixel = pixel;
		}
		if (firstAlphaPixel === "none" && alpha > 0) {
			firstAlphaPixel = pixel;
		}
		if (red > 0 || green > 0 || blue > 0) {
			nonZeroRgbSampleCount += 1;
		}
		if (alpha > 0) {
			nonZeroAlphaSampleCount += 1;
		}
	}
	return {
		firstPixel,
		firstAlphaPixel,
		nonZeroRgbSampleCount,
		nonZeroAlphaSampleCount,
		sampleCount,
	};
}

function createGeometrySignature(drawUnit: StagedWorldDrawUnitAssembly): string {
	return [
		drawUnit.kind,
		drawUnit.material.kind,
		drawUnit.material.key,
		`v${drawUnit.geometry.vertexCount}`,
		`t${drawUnit.geometry.triangleCount}`,
		`p${hashFloat32Array(drawUnit.geometry.positions)}`,
		`u${drawUnit.geometry.uvs ? hashFloat32Array(drawUnit.geometry.uvs) : "none"}`,
		`i${hashIndexArray(drawUnit.geometry.indices)}`,
	].join(":");
}

function countUniqueStaticObjectKeys(
	drawUnits: readonly Webgl2WorldDrawUnit[],
): number {
	return new Set(drawUnits.flatMap((drawUnit) => drawUnit.staticObjectKeys)).size;
}

function countUniqueBvhItemKeys(
	drawUnits: readonly Webgl2WorldDrawUnit[],
): number {
	return new Set(drawUnits.flatMap((drawUnit) => drawUnit.bvhItemKeys)).size;
}

function syncWebgl2AssemblyGraph({
	graph,
	store,
	records,
	retainedDrawUnitIds,
}: {
	graph: RendererResourceGraph | undefined;
	store: Webgl2WorldResourceStore;
	records: readonly StagedWorldAssemblyGraphRecord[];
	retainedDrawUnitIds: ReadonlySet<string>;
}): void {
	if (!graph) {
		if (store.boundGraph) {
			for (const lease of store.graphLeasesByDrawUnitId.values()) {
				store.boundGraph.releaseLease(lease);
			}
		}
		store.graphLeasesByDrawUnitId.clear();
		store.graphSignaturesByDrawUnitId.clear();
		store.boundGraph = null;
		return;
	}
	if (store.boundGraph && store.boundGraph !== graph) {
		for (const lease of store.graphLeasesByDrawUnitId.values()) {
			store.boundGraph.releaseLease(lease);
		}
		store.graphLeasesByDrawUnitId.clear();
		store.graphSignaturesByDrawUnitId.clear();
	}
	store.boundGraph = graph;

	const changedRecords = records.filter((record) => {
		const signature = describeStagedWorldAssemblyGraphRecordSignature(record);
		return store.graphSignaturesByDrawUnitId.get(record.drawUnitId) !== signature;
	});
	if (changedRecords.length > 0) {
		const nodes: RendererResourceGraphNode[] = [];
		const dependencyReplacements: RendererResourceGraphDependencyReplacement[] =
			[];
		for (const record of changedRecords) {
			const sceneNodeKey = sceneObjectGraphNodeKey(record.drawUnitId);
			const materialNodeKey = materialDecisionGraphNodeKey(
				`${record.drawUnitId}/${record.material.key}`,
			);
			const assetIds = uniqueSortedStrings(record.preparedAssetIds);
			const preparedNodeKeys = assetIds.map(preparedAssetGraphNodeKey);
			nodes.push(
				{
					key: sceneNodeKey,
					kind: "scene-object",
					label: record.label,
					metadata: {
						drawUnitId: record.drawUnitId,
						materialKind: record.material.kind,
					},
				},
				{
					key: materialNodeKey,
					kind: "material-decision",
					label: record.material.key,
					metadata: {
						materialKind: record.material.kind,
						fallback: record.material.fallbackReason ?? null,
					},
				},
				...assetIds.map((assetId, index) => ({
					key: preparedNodeKeys[index],
					kind: "prepared-asset" as const,
					label: assetId,
				})),
			);
			dependencyReplacements.push(
				{
					nodeKey: sceneNodeKey,
					dependencyKeys: [materialNodeKey, ...preparedNodeKeys],
				},
				{
					nodeKey: materialNodeKey,
					dependencyKeys: preparedNodeKeys,
				},
			);
		}
		graph.applyBatchUpdate({ nodes, dependencyReplacements });
		for (const record of changedRecords) {
			const sceneNodeKey = sceneObjectGraphNodeKey(record.drawUnitId);
			if (!store.graphLeasesByDrawUnitId.has(record.drawUnitId)) {
				store.graphLeasesByDrawUnitId.set(
					record.drawUnitId,
					graph.leaseNode(sceneNodeKey, "webgl2 scene assembly"),
				);
			}
			store.graphSignaturesByDrawUnitId.set(
				record.drawUnitId,
				describeStagedWorldAssemblyGraphRecordSignature(record),
			);
		}
	}

	for (const [drawUnitId, lease] of store.graphLeasesByDrawUnitId) {
		if (retainedDrawUnitIds.has(drawUnitId)) {
			continue;
		}
		graph.releaseLease(lease);
		store.graphLeasesByDrawUnitId.delete(drawUnitId);
		store.graphSignaturesByDrawUnitId.delete(drawUnitId);
	}
}

function hashFloat32Array(values: Float32Array): string {
	let hash = 0x811c9dc5;
	const view = new DataView(
		values.buffer,
		values.byteOffset,
		values.byteLength,
	);
	for (let byteOffset = 0; byteOffset < view.byteLength; byteOffset += 1) {
		hash ^= view.getUint8(byteOffset);
		hash = Math.imul(hash, 0x01000193);
	}
	return toUnsignedHex(hash);
}

function hashIndexArray(values: Uint16Array | Uint32Array): string {
	let hash = 0x811c9dc5;
	for (const value of values) {
		hash ^= value;
		hash = Math.imul(hash, 0x01000193);
	}
	return toUnsignedHex(hash);
}

function toUnsignedHex(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}

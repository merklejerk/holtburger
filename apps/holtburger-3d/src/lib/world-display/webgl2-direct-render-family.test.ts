import { describe, expect, it } from "vitest";
import {
	deriveDirectGeometrySubmissionLayout,
	directVertexArrayKey,
	mapWebgl2DrawUnitToDirectRenderFamilySubmission,
	type GeometrySubmissionLayout,
} from "./webgl2/families/direct-render-family";
import type {
	Webgl2IndexedMaterialDescriptor,
	Webgl2IndexedMaterialResources,
	Webgl2WorldDrawUnit,
} from "./webgl2-world-resources";
import type { Webgl2BufferResource, Webgl2Texture2DResource } from "./webgl2-gl";

describe("webgl2 direct render family views", () => {
	it("derives direct geometry layout from the actual VAO inputs", () => {
		expect(deriveDirectGeometrySubmissionLayout({ uvBuffer: null })).toBe(
			"position",
		);
		expect(
			deriveDirectGeometrySubmissionLayout({ uvBuffer: createBuffer() }),
		).toBe("position-uv");
	});

	it("maps flat draw units to single-slot direct geometry submissions", () => {
		const drawUnit = createDrawUnit({ id: "flat-a" });
		const submission = mapWebgl2DrawUnitToDirectRenderFamilySubmission(drawUnit);

		expect(submission.geometry).toMatchObject({
			mode: "direct",
			drawUnitId: "flat-a",
			drawUnitKind: "static",
			layout: "position",
			vertexArrayKey: directVertexArrayKey("flat-a"),
			firstIndex: 0,
			indexCount: 3,
			materialSlotIndex: 0,
			triangleCount: 1,
		});
		expect(submission.material.family).toBe("flat-constant-color");
	});

	it("maps RGBA texture-page draw units without adding compacted material-slot attributes", () => {
		const drawUnit = createDrawUnit({
			id: "texture-a",
			materialKind: "direct-texture",
			texture: createTexture(),
			layout: "position-uv",
		});
		const submission = mapWebgl2DrawUnitToDirectRenderFamilySubmission(drawUnit);

		expect(submission.geometry.layout).toBe("position-uv");
		expect(submission.geometry.materialSlotIndex).toBe(0);
		expect(submission.material.family).toBe("rgba-texture-page");
		if (submission.material.family !== "rgba-texture-page") {
			throw new Error("Expected RGBA texture-page payload.");
		}
		expect(submission.material.texture).toBe(drawUnit.texture);
		expect(submission.material.texturePageBindings).toBe(
			drawUnit.texturePageBindings,
		);
	});

	it("maps indexed/paletted draw units to the indexed family", () => {
		const indexedMaterial = createIndexedMaterial();
		const drawUnit = createDrawUnit({
			id: "indexed-a",
			materialKind: "indexed-paletted",
			indexedMaterial,
			layout: "position-uv",
		});
		const submission = mapWebgl2DrawUnitToDirectRenderFamilySubmission(drawUnit);

		expect(submission.geometry.layout).toBe("position-uv");
		expect(submission.material.family).toBe("indexed-paletted");
		if (submission.material.family !== "indexed-paletted") {
			throw new Error("Expected indexed/paletted payload.");
		}
		expect(submission.material.indexedMaterial).toBe(indexedMaterial);
	});

	it("keeps portal masks in the debug direct family", () => {
		const mask = mapWebgl2DrawUnitToDirectRenderFamilySubmission(
			createDrawUnit({ id: "mask-a", kind: "portal-mask" }),
		);

		expect(mask.material.family).toBe("debug-pipeline");
	});
});

function createDrawUnit({
	id,
	kind = "static",
	materialKind = "flat",
	texture = null,
	indexedMaterial = null,
	layout = "position",
}: {
	id: string;
	kind?: Webgl2WorldDrawUnit["kind"];
	materialKind?: Webgl2WorldDrawUnit["materialKind"];
	texture?: Webgl2WorldDrawUnit["texture"];
	indexedMaterial?: Webgl2WorldDrawUnit["indexedMaterial"];
	layout?: GeometrySubmissionLayout;
}): Webgl2WorldDrawUnit {
	const uvBuffer = layout === "position" ? null : createBuffer();
	return {
		id,
		kind,
		owningLandblockId: kind === "static" ? 0x0102ffff : null,
		geometrySignature: `${id}/geometry`,
		submitOrderKey: id,
		vertexArray: {
			vertexArray: {} as WebGLVertexArrayObject,
			dispose() {
				return;
			},
		},
		vertexBuffer: createBuffer(),
		uvBuffer,
		directGeometryLayout: deriveDirectGeometrySubmissionLayout({ uvBuffer }),
		indexBuffer: createBuffer(),
		indexType: 5123,
		vertexCount: 3,
		triangleCount: 1,
		color: new Float32Array([1, 1, 1, 1]),
		materialKind,
		materialKey: `${id}/material`,
		materialFallbackReason: null,
		materialBehavior: null,
		directTextureSamplingPolicy: null,
		textureUploadSample: null,
		texturePageReadiness: null,
		compactionEligibility: {
			decision: "direct-draw",
			material: {
				family:
					materialKind === "indexed-paletted"
						? "indexed-paletted"
						: materialKind === "direct-texture"
								? "textured-opaque"
								: "flat-constant-color",
				compatible: false,
				blockers: [],
				alphaPolicy: "opaque",
				texturePageReadiness: null,
				detailAtlasEntry: null,
			},
			geometry: {
				compatible: false,
				blockers: [],
			},
		},
		textureKey: texture ? `${id}/texture` : null,
		texture,
		indexedMaterialDescriptor: indexedMaterial
			? createIndexedMaterialDescriptor(indexedMaterial)
			: null,
		indexedMaterial,
		detailOverlay: null,
		texturePageBindings: [],
		texturePageBindingFallbackSamples: [],
		sceneDomain: null,
		modelMatrix: createIdentityMat4(),
		bvhItemKeys: [],
		bvhFallbackReason: null,
		staticPartCount: 1,
		staticObjectKeys: [id],
	};
}

function createBuffer(): Webgl2BufferResource {
	return {
		buffer: {} as WebGLBuffer,
		dispose() {
			return;
		},
	};
}

function createTexture(): Webgl2Texture2DResource {
	return {
		texture: {} as WebGLTexture,
		width: 1,
		height: 1,
		dispose() {
			return;
		},
	};
}

function createIndexedMaterial(): Webgl2IndexedMaterialResources {
	const indexTexture = createTexture();
	const paletteTexture = createTexture();
	const descriptor = createIndexedMaterialDescriptor();
	return {
		...descriptor,
		indexTexture,
		paletteTexture,
	};
}

function createIndexedMaterialDescriptor(
	material?: Webgl2IndexedMaterialResources,
): Webgl2IndexedMaterialDescriptor {
	return {
		key: material?.key ?? "indexed/material",
		indexFormat: material?.indexFormat ?? "index16",
		indexTextureKey: material?.indexTextureKey ?? "indexed/texels",
		paletteTextureKey: material?.paletteTextureKey ?? "indexed/palette",
		width: material?.width ?? 1,
		height: material?.height ?? 1,
		indexSourceBytes: material?.indexSourceBytes ?? Uint8Array.from([0, 1]),
		paletteColorCount: material?.paletteColorCount ?? 256,
		paletteRgbaBytes: material?.paletteRgbaBytes ?? new Uint8Array(256 * 4),
		wrapS: material?.wrapS ?? "repeat",
		wrapT: material?.wrapT ?? "repeat",
		clipThreshold: material?.clipThreshold ?? -1,
	};
}

function createIdentityMat4(): Float32Array {
	return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

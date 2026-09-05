import type { ObjectGeometryKey } from "../geometry/types";
import { Mat4, Vec3 } from "../math/types";
import type { SceneNodeId } from "../scene";
import type { DynamicLayout } from "../geometry/dynamic-layout";
import type { DynamicAppearance } from "../systems/dynamic-appearance";
import { TextureWrapMode } from "../textures/types";
import { WebGL2DynamicAppearances } from "./webgl2-dynamic-appearances";
import { WebGL2DynamicPosePages } from "./webgl2-dynamic-pose-pages";
import { DynamicDepthPreparations } from "./dynamic-depth-preparation";
import {
	DEFAULT_COLOR_GRADE_PARAMETERS,
	type ColorGradeSettings,
} from "./color-grade-policy";
import { WebGL2EntitySelectionPass } from "./webgl2-entity-selection-pass";
import { WebGL2FlatScenePresentation } from "./webgl2-flat-scene-presentation";
import { WebGL2FlatSceneTarget } from "./webgl2-flat-scene-target";
import type { PortalWarpDriveTuning } from "./portal-warp-drive-tuning";
import type { EntitySelectionOutlineSettings } from "./entity-selection-outline-policy";
import type { WebGL2GeometryBinding } from "./webgl2-resource-manager";
import type { EntitySelectionTarget } from "./renderer";

const GEOMETRY_KEY = "object-geometry:selection-fixture" as ObjectGeometryKey;
const NODE_ID = "scene-node:selection-fixture" as SceneNodeId;
const PADDING_NODE_ID = "scene-node:selection-pose-padding" as SceneNodeId;
const LAYOUT: DynamicLayout = {
	key: GEOMETRY_KEY,
	geometry: {
		kind: "dynamic-parts",
		partCount: 1,
		materialCount: 1,
		positions: new Float32Array([-0.55, -0.55, 0, 0.55, -0.55, 0, 0, 0.55, 0]),
		normals: new Float32Array(9),
		textureCoordinates: new Float32Array(6),
		indices: new Uint32Array([0, 1, 2]),
		partSelectors: new Uint32Array(3),
		materialSelectors: new Uint32Array(3),
	},
	parts: [{ partIndex: 0, indexStart: 0, indexCount: 3 }],
};
const APPEARANCE: DynamicAppearance = {
	materials: [
		{
			source: {
				id: "material:selection-fixture",
				kind: "solid-color",
				color: [1, 1, 1, 1],
				rawSurfaceFlags: 0,
				translucency: 0,
				luminosity: 0,
				diffuseScale: 1,
			},
			detailRole: null,
			textures: { base: null, palette: null },
			sampler: { wrap: TextureWrapMode.Clamp },
			palettedClipMap: false,
		},
	],
	ranges: [
		{
			transparentSort: { key: "fixture-order", center: Vec3.zero() },
			partSelector: 0,
			materialSelector: 0,
			indexStart: 0,
			indexCount: 3,
			ordering: "opaque",
			polygon: { cullFace: "back", stippled: false },
			retailVisibility: "normally-visible",
		},
	],
};
const INITIAL_SIZE = 64;
const RESIZED_SIZE = 32;
const DISABLED_COLOR_GRADE: ColorGradeSettings = {
	enabled: false,
	parameters: DEFAULT_COLOR_GRADE_PARAMETERS,
};
const FIXTURE_OUTLINE_SETTINGS = {
	color: { red: 0.1, green: 0.9, blue: 0.4, alpha: 1 },
	widthCssPixels: 3,
} as const satisfies EntitySelectionOutlineSettings;

/** Real-browser mask, compositor, resize, and teardown evidence. */
export interface WebGL2EntitySelectionFixtureResult {
	readonly currentTransformFollowed: boolean;
	readonly depthIndependentMaskPixel: number;
	readonly initialActiveMaskBytes: number;
	readonly interiorPreserved: boolean;
	readonly outlinePixelCount: number;
	readonly sphereProxyMaskPixel: number;
	readonly sphereProxyWorkExact: boolean;
	readonly portalWarpOutlinePixelCount: number;
	readonly resizedActiveMaskBytes: number;
	readonly resizedTargetReplaced: boolean;
	readonly sameSizeTargetReused: boolean;
	readonly targetGenerationsAllocated: number;
	readonly targetGenerationsDisposedAfterDestroy: number;
	readonly targetInvalidAfterDestroy: boolean;
}

/** Exercise the production pass and presenter directly against one browser WebGL2 context. */
export function runWebGL2EntitySelectionFixture(
	gl: WebGL2RenderingContext,
	warpDriveTuning: PortalWarpDriveTuning,
): WebGL2EntitySelectionFixtureResult {
	requireNoWebGL2Error(gl, "before entity selection fixture");
	const geometry = createTriangleGeometry(gl);
	const poses = new WebGL2DynamicPosePages<SceneNodeId>(gl);
	const appearances = new WebGL2DynamicAppearances(gl, () => ({
		material: { kind: "solid-color", color: [1, 1, 1, 1] },
		alphaTest: 0,
		luminosity: 0,
		palettedClipMap: false,
		wrapRepeat: false,
	}));
	const releaseAppearance = appearances.retain(LAYOUT, APPEARANCE);
	const pass = new WebGL2EntitySelectionPass(gl, {
		getPose: (nodeId) => poses.get(nodeId),
		getGeometry: (key) => {
			if (key !== GEOMETRY_KEY) {
				throw new Error(`Unexpected selection fixture geometry ${key}.`);
			}
			return geometry.binding;
		},
	});
	const sceneTarget = new WebGL2FlatSceneTarget(gl);
	const presenter = new WebGL2FlatScenePresentation(gl, warpDriveTuning);
	let resizedTexture: WebGLTexture;
	try {
		// An inherited NEVER depth function would reject every fragment if the pass consulted scene
		// depth. The center mask sample proves the production pass disables that state.
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.NEVER);
		const initial = pass.render(
			selectionInput(pass, poses, appearances, INITIAL_SIZE, INITIAL_SIZE),
		);
		const depthIndependentMaskPixel = readTexturePixel(
			gl,
			initial.mask.texture,
			INITIAL_SIZE,
			INITIAL_SIZE,
			INITIAL_SIZE / 2,
			INITIAL_SIZE / 3,
		);
		const initialPositionMaskPixel = readTexturePixel(
			gl,
			initial.mask.texture,
			INITIAL_SIZE,
			INITIAL_SIZE,
			24,
			21,
		);
		const initialDiagnostics = pass.getDiagnostics();
		const sameSize = pass.render(
			selectionInput(pass, poses, appearances, INITIAL_SIZE, INITIAL_SIZE, 0.4),
		);
		const previousPositionMaskPixel = readTexturePixel(
			gl,
			sameSize.mask.texture,
			INITIAL_SIZE,
			INITIAL_SIZE,
			24,
			21,
		);
		const currentPositionMaskPixel = readTexturePixel(
			gl,
			sameSize.mask.texture,
			INITIAL_SIZE,
			INITIAL_SIZE,
			48,
			21,
		);
		const target = sceneTarget.resizeDimensions(INITIAL_SIZE, INITIAL_SIZE);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer);
		gl.viewport(0, 0, INITIAL_SIZE, INITIAL_SIZE);
		gl.clearColor(0, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		presenter.present(
			target,
			DISABLED_COLOR_GRADE,
			{ kind: "scene-only" },
			FIXTURE_OUTLINE_SETTINGS,
			1,
			initial.mask,
		);
		const scenePixels = readDefaultPixels(gl, INITIAL_SIZE, INITIAL_SIZE);
		const outlinePixelCount = countOutlinePixels(scenePixels);
		const interiorPreserved = pixelIsBlack(
			scenePixels,
			INITIAL_SIZE,
			INITIAL_SIZE / 2,
			INITIAL_SIZE / 3,
		);

		presenter.present(
			target,
			DISABLED_COLOR_GRADE,
			{
				kind: "origin-to-tunnel",
				origin: target.color,
				progress: 0.35,
				tunnel: target.color,
			},
			FIXTURE_OUTLINE_SETTINGS,
			1,
			initial.mask,
		);
		const portalWarpOutlinePixelCount = countOutlinePixels(
			readDefaultPixels(gl, INITIAL_SIZE, INITIAL_SIZE),
		);
		const sphereProxy = pass.render(
			selectionInput(pass, poses, appearances, INITIAL_SIZE, INITIAL_SIZE, 0, {
				kind: "sphere-proxy",
				placement: {
					envCellId: null,
					landblockId: "0x0000ffff",
					localToLandblock: Mat4.identity(),
					scope: { kind: "outdoor" },
				},
				sphere: { center: new Vec3(0, 0, 0), radius: 0.4 },
			}),
		);
		const sphereProxyMaskPixel = readTexturePixel(
			gl,
			sphereProxy.mask.texture,
			INITIAL_SIZE,
			INITIAL_SIZE,
			INITIAL_SIZE / 2,
			INITIAL_SIZE / 2,
		);

		const resized = pass.render(
			selectionInput(pass, poses, appearances, RESIZED_SIZE, RESIZED_SIZE),
		);
		resizedTexture = resized.mask.texture;
		const resizedDiagnostics = pass.getDiagnostics();
		requireNoWebGL2Error(gl, "after entity selection fixture draws");
		pass.destroy();
		const destroyedDiagnostics = pass.getDiagnostics();
		return {
			currentTransformFollowed:
				initialPositionMaskPixel === 255 &&
				previousPositionMaskPixel === 0 &&
				currentPositionMaskPixel === 255,
			depthIndependentMaskPixel,
			initialActiveMaskBytes: initialDiagnostics.activeMaskBytes,
			interiorPreserved,
			outlinePixelCount,
			sphereProxyMaskPixel,
			sphereProxyWorkExact:
				sphereProxy.work.maskDrawCount === 1 &&
				sphereProxy.work.selectedSphereProxyCount === 1 &&
				sphereProxy.work.selectedPartCount === 0 &&
				sphereProxy.work.selectedTriangleCount === 0,
			portalWarpOutlinePixelCount,
			resizedActiveMaskBytes: resizedDiagnostics.activeMaskBytes,
			resizedTargetReplaced: resized.mask.texture !== initial.mask.texture,
			sameSizeTargetReused: sameSize.mask.texture === initial.mask.texture,
			targetGenerationsAllocated:
				resizedDiagnostics.allocatedTargetGenerationCount,
			targetGenerationsDisposedAfterDestroy:
				destroyedDiagnostics.disposedTargetGenerationCount,
			targetInvalidAfterDestroy: !gl.isTexture(resizedTexture),
		};
	} finally {
		pass.destroy();
		presenter.destroy();
		sceneTarget.destroy();
		destroyTriangleGeometry(gl, geometry);
		releaseAppearance();
		appearances.destroy();
		poses.destroy();
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
		gl.depthFunc(gl.LEQUAL);
	}
}

function selectionInput(
	pass: WebGL2EntitySelectionPass,
	poses: WebGL2DynamicPosePages<SceneNodeId>,
	appearances: WebGL2DynamicAppearances,
	width: number,
	height: number,
	translationX = 0,
	shape: EntitySelectionTarget["shape"] = { kind: "rigid" },
) {
	const sourceToLandblock = Mat4.identity();
	sourceToLandblock.m41 = translationX;
	const parts = [
		{ frameInstance: { color: { a: 1, b: 1, g: 1, r: 1 }, sourceToLandblock } },
	];
	const depths = new DynamicDepthPreparations(
		() => ({
			landblockId: "0x0000ffff",
			renderScopes: [{ kind: "outdoor" }],
			visual: { layout: LAYOUT, appearance: APPEARANCE, parts },
		}),
		(appearance) => appearances.get(appearance),
	);
	const selection = pass.prepare(
		{ nodeId: NODE_ID, shape },
		depths.prepare(NODE_ID, false),
	);
	// Place the selected entity after another root to exercise the nonzero base-row contract.
	poses.upload(
		new Map([
			[PADDING_NODE_ID, parts],
			[NODE_ID, parts],
		]),
	);
	if (selection === null)
		throw new Error("Selection fixture produced no geometry.");
	return {
		anchorCoordinates: { x: 0, y: 0 },
		clipFromAnchor: Mat4.identity(),
		selection,
		height,
		width,
	};
}

function createTriangleGeometry(gl: WebGL2RenderingContext): {
	readonly binding: WebGL2GeometryBinding;
	readonly indexBuffer: WebGLBuffer;
	readonly positionBuffer: WebGLBuffer;
} {
	const vertexArray = gl.createVertexArray();
	const positionBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (!vertexArray || !positionBuffer || !indexBuffer) {
		if (vertexArray) gl.deleteVertexArray(vertexArray);
		if (positionBuffer) gl.deleteBuffer(positionBuffer);
		if (indexBuffer) gl.deleteBuffer(indexBuffer);
		throw new Error("Failed to allocate entity selection fixture geometry.");
	}
	gl.bindVertexArray(vertexArray);
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		new Float32Array([-0.55, -0.55, 0, 0.55, -0.55, 0, 0, 0.55, 0]),
		gl.STATIC_DRAW,
	);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
	gl.disableVertexAttribArray(3);
	gl.vertexAttribI4ui(3, 0, 0, 0, 0);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(
		gl.ELEMENT_ARRAY_BUFFER,
		new Uint16Array([0, 1, 2]),
		gl.STATIC_DRAW,
	);
	return {
		binding: {
			indexCount: 3,
			indexElementBytes: Uint16Array.BYTES_PER_ELEMENT,
			indexType: gl.UNSIGNED_SHORT,
			vertexArray,
		},
		indexBuffer,
		positionBuffer,
	};
}

function destroyTriangleGeometry(
	gl: WebGL2RenderingContext,
	geometry: ReturnType<typeof createTriangleGeometry>,
): void {
	gl.deleteBuffer(geometry.indexBuffer);
	gl.deleteBuffer(geometry.positionBuffer);
	gl.deleteVertexArray(geometry.binding.vertexArray);
}

function readTexturePixel(
	gl: WebGL2RenderingContext,
	texture: WebGLTexture,
	width: number,
	height: number,
	x: number,
	y: number,
): number {
	const framebuffer = gl.createFramebuffer();
	if (!framebuffer)
		throw new Error("Failed to allocate selection readback target.");
	try {
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(
			gl.READ_FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			texture,
			0,
		);
		if (
			gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
		) {
			throw new Error(
				`Selection readback target ${width}x${height} is incomplete.`,
			);
		}
		const pixel = new Uint8Array(1);
		gl.readPixels(x, y, 1, 1, gl.RED, gl.UNSIGNED_BYTE, pixel);
		return pixel[0] ?? 0;
	} finally {
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
		gl.deleteFramebuffer(framebuffer);
	}
}

function readDefaultPixels(
	gl: WebGL2RenderingContext,
	width: number,
	height: number,
): Uint8Array {
	gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
	const pixels = new Uint8Array(width * height * 4);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
	return pixels;
}

function countOutlinePixels(pixels: Uint8Array): number {
	let count = 0;
	for (let offset = 0; offset < pixels.length; offset += 4) {
		if (
			(pixels[offset] ?? 255) < 60 &&
			(pixels[offset + 1] ?? 0) > 200 &&
			(pixels[offset + 2] ?? 0) > 80
		) {
			count += 1;
		}
	}
	return count;
}

function pixelIsBlack(
	pixels: Uint8Array,
	width: number,
	x: number,
	y: number,
): boolean {
	const offset = (Math.floor(y) * width + Math.floor(x)) * 4;
	return (
		pixels[offset] === 0 && pixels[offset + 1] === 0 && pixels[offset + 2] === 0
	);
}

function requireNoWebGL2Error(
	gl: WebGL2RenderingContext,
	checkpoint: string,
): void {
	const error = gl.getError();
	if (error !== gl.NO_ERROR) {
		throw new Error(`WebGL2 error ${error} observed ${checkpoint}.`);
	}
}

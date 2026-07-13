import { createLandblockOffset } from "../landblocks";
import {
	createPerspectiveMat4,
	createViewMat4,
	getMat4Translation,
	mat4ToFloat32Array,
	multiplyMat4,
} from "../math/matrices";
import { Mat4, Vec3 } from "../math/types";
import type { FrameInput, FrameViewInput, Renderer } from "./renderer";
import type {
	FrameViewScene,
	ObjectFrameAttachment,
	ObjectMaterialPass,
	ObjectRenderDrawUnit,
} from "./render-world";
import type { GeometryResourceKey } from "./resource-manager";
import {
	WebGL2ResourceManager,
	type WebGL2GeometryBinding,
} from "./webgl2-resource-manager";
import {
	createWebGL2FlatColorProgram,
	type WebGL2FlatColorProgram,
} from "./webgl2-flat-color-program";

const CLEAR_COLOR = {
	red: 0.15,
	green: 0.05,
	blue: 0.05,
	alpha: 1,
} as const;

type SurfaceColor = readonly [number, number, number, number];

const TERRAIN_COLOR: SurfaceColor = [0.22, 0.72, 0.42, 1];
const OBJECT_PASS_COLORS: Readonly<Record<ObjectMaterialPass, SurfaceColor>> = {
	additive: [0.35, 0.65, 1, 0.65],
	"alpha-test": [0.92, 0.72, 0.24, 1],
	opaque: [0.72, 0.72, 0.76, 1],
	transparent: [0.45, 0.75, 0.95, 0.45],
};
const OBJECT_PASS_ORDER: readonly ObjectMaterialPass[] = [
	"opaque",
	"alpha-test",
	"transparent",
	"additive",
];

/** Anchor-relative matrices and content reused by all passes for one view. */
interface PreparedView {
	/** Anchor-relative camera position used to sort transparent draws. */
	readonly cameraPosition: Vec3;
	/** Projection matrix derived from the current drawing-buffer aspect ratio. */
	readonly projection: Mat4;
	/** Persistent scene attachments selected by visibility. */
	readonly scene: FrameViewScene;
	/** Anchor-relative camera view transform. */
	readonly view: Mat4;
	/** Landblock defining the view's render-world origin. */
	readonly anchorLandblockId: FrameInput["anchorLandblockId"];
}

interface ObjectDraw {
	/** Visible occurrence carrying scene placement and object pose. */
	readonly frameAttachment: ObjectFrameAttachment;
	/** Compatible material/index range within the occurrence's resource. */
	readonly drawUnit: ObjectRenderDrawUnit;
}

export class WebGL2Renderer implements Renderer {
	readonly #canvas: HTMLCanvasElement;
	readonly #gl: WebGL2RenderingContext;
	readonly #resources: WebGL2ResourceManager;
	readonly #flatColorProgram: WebGL2FlatColorProgram;
	#frameWidth = 0;
	#frameHeight = 0;

	public static async build(
		canvas: HTMLCanvasElement,
		gl: WebGL2RenderingContext,
		resources: WebGL2ResourceManager,
	): Promise<WebGL2Renderer> {
		return new WebGL2Renderer(canvas, gl, resources);
	}

	protected constructor(
		canvas: HTMLCanvasElement,
		gl: WebGL2RenderingContext,
		resources: WebGL2ResourceManager,
	) {
		this.#canvas = canvas;
		this.#gl = gl;
		this.#resources = resources;
		this.#flatColorProgram = createWebGL2FlatColorProgram(gl);
		gl.clearColor(
			CLEAR_COLOR.red,
			CLEAR_COLOR.green,
			CLEAR_COLOR.blue,
			CLEAR_COLOR.alpha,
		);
		gl.enable(gl.DEPTH_TEST);
	}

	drawFrame(input: FrameInput): void {
		this.#resizeCanvasForDpr();
		this.#beginFrame();
		for (const view of input.views) {
			this.#drawView(this.#prepareView(input.anchorLandblockId, view));
		}
		void input.timeSeconds;
	}

	async destroy(): Promise<void> {
		this.#gl.deleteProgram(this.#flatColorProgram.program);
		const loseContext = this.#gl.getExtension("WEBGL_lose_context");
		loseContext?.loseContext();
	}

	#beginFrame(): void {
		const gl = this.#gl;
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
	}

	#prepareView(
		anchorLandblockId: FrameInput["anchorLandblockId"],
		input: FrameViewInput,
	): PreparedView {
		const camera = input.camera;
		const cameraOffset = createLandblockOffset(
			camera.placement.landblockId,
			anchorLandblockId,
		);
		const cameraPosition = cameraOffset.add(camera.placement.position);
		const aspectRatio = this.#frameWidth / Math.max(1, this.#frameHeight);
		return {
			anchorLandblockId,
			cameraPosition,
			projection: createPerspectiveMat4(
				camera.fov,
				aspectRatio,
				camera.near,
				camera.far,
			),
			scene: input.scene,
			view: createViewMat4(cameraPosition, camera.placement.rotation),
		};
	}

	#drawView(view: PreparedView): void {
		const gl = this.#gl;
		gl.useProgram(this.#flatColorProgram.program);
		gl.uniformMatrix4fv(
			this.#flatColorProgram.uniforms.projection,
			false,
			mat4ToFloat32Array(view.projection),
		);
		gl.uniformMatrix4fv(
			this.#flatColorProgram.uniforms.view,
			false,
			mat4ToFloat32Array(view.view),
		);
		this.#drawTerrain(view);
		for (const pass of OBJECT_PASS_ORDER) this.#drawObjectPass(view, pass);
		gl.bindVertexArray(null);
	}

	#drawTerrain(view: PreparedView): void {
		const gl = this.#gl;
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		this.#setSurfaceColor(TERRAIN_COLOR);
		for (const frameAttachment of view.scene.terrain) {
			const landblockOffset = createLandblockOffset(
				frameAttachment.placement.landblockId,
				view.anchorLandblockId,
			);
			for (const drawUnit of frameAttachment.resource.drawUnits) {
				this.#drawGeometry(
					frameAttachment.resource.geometryKey,
					drawUnit.indexStart,
					drawUnit.indexCount,
					frameAttachment.placement.localToLandblock,
					landblockOffset,
				);
			}
		}
	}

	#drawObjectPass(view: PreparedView, pass: ObjectMaterialPass): void {
		const draws = collectObjectDraws(view.scene, pass);
		if (pass === "transparent") {
			draws.sort(
				(left, right) =>
					this.#objectDistanceSquared(view, right) -
					this.#objectDistanceSquared(view, left),
			);
		}
		this.#applyObjectPassState(pass);
		this.#setSurfaceColor(OBJECT_PASS_COLORS[pass]);
		for (const draw of draws) {
			const placement = draw.frameAttachment.placement;
			this.#gl.depthMask(draw.drawUnit.material.depthWrite);
			this.#drawGeometry(
				draw.frameAttachment.resource.geometryKey,
				draw.drawUnit.indexStart,
				draw.drawUnit.indexCount,
				resolveObjectLocalToLandblock(draw),
				createLandblockOffset(placement.landblockId, view.anchorLandblockId),
			);
		}
	}

	#drawGeometry(
		geometryKey: GeometryResourceKey,
		indexStart: number,
		indexCount: number,
		localToLandblock: Mat4,
		landblockOffset: Vec3,
	): void {
		const binding = this.#resources.getGeometry(geometryKey);
		validateDrawRange(binding, indexStart, indexCount);
		const gl = this.#gl;
		gl.uniformMatrix4fv(
			this.#flatColorProgram.uniforms.localToLandblock,
			false,
			mat4ToFloat32Array(localToLandblock),
		);
		gl.uniform3f(
			this.#flatColorProgram.uniforms.landblockOffset,
			landblockOffset.x,
			landblockOffset.y,
			landblockOffset.z,
		);
		gl.bindVertexArray(binding.vertexArray);
		gl.drawElements(
			gl.TRIANGLES,
			indexCount,
			binding.indexType,
			indexStart * binding.indexElementBytes,
		);
	}

	#applyObjectPassState(pass: ObjectMaterialPass): void {
		const gl = this.#gl;
		switch (pass) {
			case "opaque":
			case "alpha-test":
				gl.disable(gl.BLEND);
				return;
			case "transparent":
				gl.enable(gl.BLEND);
				gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
				return;
			case "additive":
				gl.enable(gl.BLEND);
				gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
		}
	}

	#setSurfaceColor(color: SurfaceColor): void {
		this.#gl.uniform4f(this.#flatColorProgram.uniforms.color, ...color);
	}

	#objectDistanceSquared(view: PreparedView, draw: ObjectDraw): number {
		const placement = draw.frameAttachment.placement;
		const offset = createLandblockOffset(
			placement.landblockId,
			view.anchorLandblockId,
		);
		const translation = getMat4Translation(resolveObjectLocalToLandblock(draw));
		const position = offset.add(translation);
		return position.distanceSquaredTo(view.cameraPosition);
	}

	#resizeCanvasForDpr(): void {
		const dpr = window.devicePixelRatio ?? 1;
		const width = Math.max(1, Math.floor(this.#canvas.clientWidth * dpr));
		const height = Math.max(1, Math.floor(this.#canvas.clientHeight * dpr));
		if (width === this.#frameWidth && height === this.#frameHeight) return;

		this.#frameWidth = width;
		this.#frameHeight = height;
		this.#canvas.width = width;
		this.#canvas.height = height;
		this.#gl.viewport(0, 0, width, height);
	}
}

function collectObjectDraws(
	scene: FrameViewScene,
	pass: ObjectMaterialPass,
): ObjectDraw[] {
	return scene.objects.flatMap((frameAttachment) =>
		frameAttachment.resource.drawUnits
			.filter((drawUnit) => drawUnit.material.pass === pass)
			.map((drawUnit) => ({ drawUnit, frameAttachment })),
	);
}

function resolveObjectLocalToLandblock(draw: ObjectDraw): Mat4 {
	const placement = draw.frameAttachment.placement.localToLandblock;
	const pose = draw.frameAttachment.attachment.pose;
	if (pose.kind === "baked") {
		requireNoPoseIndex(draw.drawUnit, pose.kind);
		return placement;
	}
	if (pose.kind === "rigid") {
		requireNoPoseIndex(draw.drawUnit, pose.kind);
		return multiplyMat4(placement, pose.resourceTransform);
	}
	const poseIndex = draw.drawUnit.poseIndex;
	if (poseIndex === null) return placement;
	const partTransform = pose.partTransforms[poseIndex];
	if (!partTransform) {
		throw new Error(`Articulated pose does not contain part ${poseIndex}.`);
	}
	return multiplyMat4(placement, partTransform);
}

function requireNoPoseIndex(
	drawUnit: ObjectRenderDrawUnit,
	poseKind: "baked" | "rigid",
): void {
	if (drawUnit.poseIndex !== null) {
		throw new Error(`${poseKind} object draw unit cannot select a part pose.`);
	}
}

function validateDrawRange(
	binding: WebGL2GeometryBinding,
	indexStart: number,
	indexCount: number,
): void {
	if (
		!Number.isInteger(indexStart) ||
		!Number.isInteger(indexCount) ||
		indexStart < 0 ||
		indexCount < 0 ||
		indexStart + indexCount > binding.indexCount
	) {
		throw new Error(
			`Invalid geometry draw range ${indexStart}+${indexCount}/${binding.indexCount}.`,
		);
	}
}

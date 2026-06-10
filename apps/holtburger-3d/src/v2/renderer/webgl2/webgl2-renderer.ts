import type {
	FrameState,
	Renderer,
	RendererSnapshot,
	RendererSnapshotListener,
	StaticResidencyDelta,
	TexturePlacementUpdate,
} from "../types";
import type { TerrainGeometryStaticDrawUnit } from "../../static/contracts";

const defaultFrameState: FrameState = {
	camera: {
		position: [96, 120, 260],
		yawRadians: 0,
		pitchRadians: -0.45,
	},
	timeSeconds: 0,
};

const TERRAIN_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec2 texCoord;

uniform mat4 uModelViewProjection;

out vec2 vTexCoord;

void main() {
	vTexCoord = texCoord;
	gl_Position = uModelViewProjection * vec4(position, 1.0);
}
`;

const TERRAIN_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec4 uColor;
uniform sampler2D uTexture;
uniform bool uUseTexture;

in vec2 vTexCoord;

out vec4 fragColor;

void main() {
	vec4 textureColor = texture(uTexture, vTexCoord);
	fragColor = uUseTexture ? textureColor : uColor;
}
`;

export function createWebgl2Renderer(canvas: HTMLCanvasElement): Renderer {
	const gl = canvas.getContext("webgl2", {
		alpha: false,
		antialias: true,
		depth: true,
		stencil: false,
	});

	if (!gl) {
		throw new Error("WebGL2 is not available in this browser.");
	}

	return new Webgl2Renderer(canvas, gl);
}

class Webgl2Renderer implements Renderer {
	readonly #canvas: HTMLCanvasElement;
	readonly #gl: WebGL2RenderingContext;
	readonly #listeners = new Set<RendererSnapshotListener>();
	readonly #terrainResources = new Map<string, TerrainGeometryResource>();
	readonly #textures = new Map<string, WebGLTexture>();
	readonly #terrainTextureBindings = new Map<string, string>();
	readonly #terrainProgram: TerrainGeometryProgram;
	#animationFrameId: number | null = null;
	#disposed = false;
	#frameCount = 0;
	#frameState = defaultFrameState;
	#error: string | null = null;

	constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
		this.#canvas = canvas;
		this.#gl = gl;
		this.#terrainProgram = createTerrainGeometryProgram(gl);
		this.#startFrameLoop();
	}

	applyStaticDelta(delta: StaticResidencyDelta): void {
		for (const drawUnitId of delta.removedDrawUnitIds) {
			const resource = this.#terrainResources.get(drawUnitId);
			if (!resource) {
				continue;
			}
			resource.dispose();
			this.#terrainResources.delete(drawUnitId);
		}

		for (const placement of delta.addedDrawUnitPlacements) {
			const { drawUnit } = placement;
			if (drawUnit.kind !== "terrain-geometry") {
				continue;
			}

			this.#terrainResources
				.get(drawUnit.drawUnitId)
				?.dispose();
			this.#terrainResources.set(
				drawUnit.drawUnitId,
				createTerrainGeometryResource(
					this.#gl,
					drawUnit,
					placement.translation,
				),
			);
		}

		this.#emit();
	}

	applyDynamicDelta(): void {
		// Dynamic renderer residency starts after static pipeline contracts are proven.
	}

	applyTexturePlacementUpdate(update: TexturePlacementUpdate): void {
		const gl = this.#gl;
		for (const textureRefId of update.removedTextureRefIds) {
			const texture = this.#textures.get(textureRefId);
			if (!texture) {
				continue;
			}
			gl.deleteTexture(texture);
			this.#textures.delete(textureRefId);
		}

		for (const placement of update.placements) {
			const texture = createDirectTexture(gl, placement);
			const previousTexture = this.#textures.get(placement.textureRefId);
			if (previousTexture) {
				gl.deleteTexture(previousTexture);
			}
			this.#textures.set(placement.textureRefId, texture);
		}

		for (const binding of update.drawUnitBindings) {
			this.#terrainTextureBindings.set(binding.drawUnitId, binding.textureRefId);
		}
	}

	applySamplerPolicyUpdate(): void {
		// Sampler policy changes are part of the renderer contract, not Phase 1 behavior.
	}

	updateFrameState(state: FrameState): void {
		this.#frameState = state;
	}

	subscribe(listener: RendererSnapshotListener): () => void {
		this.#listeners.add(listener);
		listener(this.#createSnapshot());

		return () => {
			this.#listeners.delete(listener);
		};
	}

	dispose(): void {
		this.#disposed = true;

		if (this.#animationFrameId !== null) {
			cancelAnimationFrame(this.#animationFrameId);
			this.#animationFrameId = null;
		}

		for (const resource of this.#terrainResources.values()) {
			resource.dispose();
		}
		for (const texture of this.#textures.values()) {
			this.#gl.deleteTexture(texture);
		}
		this.#terrainResources.clear();
		this.#textures.clear();
		this.#terrainTextureBindings.clear();
		this.#terrainProgram.dispose();
		this.#listeners.clear();
	}

	#startFrameLoop(): void {
		const renderFrame = (timestampMilliseconds: number): void => {
			if (this.#disposed) {
				return;
			}

			try {
				this.#render(timestampMilliseconds / 1000);
			} catch (error) {
				this.#error = error instanceof Error ? error.message : String(error);
				this.#emit();
				this.dispose();
				return;
			}

			this.#animationFrameId = requestAnimationFrame(renderFrame);
		};

		this.#animationFrameId = requestAnimationFrame(renderFrame);
	}

	#render(timeSeconds: number): void {
		this.#resizeToDisplaySize();

		const gl = this.#gl;
		const frameTime = this.#frameState.timeSeconds || timeSeconds;
		const pulse = 0.5 + Math.sin(frameTime * 0.7) * 0.5;

		gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
		gl.enable(gl.DEPTH_TEST);
		gl.clearColor(0.025 + pulse * 0.015, 0.045, 0.065 + pulse * 0.025, 1);
		gl.clearDepth(1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		this.#drawTerrain();

		this.#frameCount += 1;
		this.#emit();
	}

	#drawTerrain(): void {
		if (this.#terrainResources.size === 0) {
			return;
		}

		const gl = this.#gl;
		const mvp = createModelViewProjectionMatrix(
			this.#frameState,
			gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight),
		);

		gl.useProgram(this.#terrainProgram.program);
		gl.uniformMatrix4fv(this.#terrainProgram.uniforms.uModelViewProjection, false, mvp);
		gl.uniform4f(this.#terrainProgram.uniforms.uColor, 0.22, 0.72, 0.42, 1);

		for (const resource of this.#terrainResources.values()) {
			const textureRefId = this.#terrainTextureBindings.get(resource.drawUnitId);
			const texture = textureRefId
				? (this.#textures.get(textureRefId) ?? null)
				: null;
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.uniform1i(this.#terrainProgram.uniforms.uTexture, 0);
			gl.uniform1i(this.#terrainProgram.uniforms.uUseTexture, texture ? 1 : 0);
			gl.bindVertexArray(resource.vertexArray);
			gl.drawElements(gl.TRIANGLES, resource.indexCount, resource.indexType, 0);
		}

		gl.bindVertexArray(null);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	#resizeToDisplaySize(): void {
		const devicePixelRatio = window.devicePixelRatio || 1;
		const width = Math.max(
			1,
			Math.floor(this.#canvas.clientWidth * devicePixelRatio),
		);
		const height = Math.max(
			1,
			Math.floor(this.#canvas.clientHeight * devicePixelRatio),
		);

		if (this.#canvas.width !== width || this.#canvas.height !== height) {
			this.#canvas.width = width;
			this.#canvas.height = height;
		}
	}

	#createSnapshot(): RendererSnapshot {
		return {
			backend: "webgl2",
			canvasWidth: this.#canvas.width,
			canvasHeight: this.#canvas.height,
			error: this.#error,
			frameCount: this.#frameCount,
			isRunning: !this.#disposed,
			renderedTriangles: Array.from(this.#terrainResources.values()).reduce(
				(total, resource) => total + resource.triangleCount,
				0,
			),
			staticDrawUnits: this.#terrainResources.size,
			terrainDrawUnits: this.#terrainResources.size,
		};
	}

	#emit(): void {
		const snapshot = this.#createSnapshot();

		for (const listener of this.#listeners) {
			listener(snapshot);
		}
	}
}

interface TerrainGeometryProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly uColor: WebGLUniformLocation;
		readonly uModelViewProjection: WebGLUniformLocation;
		readonly uTexture: WebGLUniformLocation;
		readonly uUseTexture: WebGLUniformLocation;
	};
	dispose(): void;
}

interface TerrainGeometryResource {
	readonly vertexArray: WebGLVertexArrayObject;
	readonly positionBuffer: WebGLBuffer;
	readonly texCoordBuffer: WebGLBuffer;
	readonly indexBuffer: WebGLBuffer;
	readonly drawUnitId: string;
	readonly indexCount: number;
	readonly indexType: GLenum;
	readonly triangleCount: number;
	dispose(): void;
}

function createTerrainGeometryProgram(
	gl: WebGL2RenderingContext,
): TerrainGeometryProgram {
	const vertexShader = compileShader(gl, gl.VERTEX_SHADER, TERRAIN_VERTEX_SHADER);
	const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, TERRAIN_FRAGMENT_SHADER);
	const program = gl.createProgram();
	if (!program) {
		throw new Error("Failed to create V2 terrain geometry shader program.");
	}

	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(program) ?? "unknown link error";
		gl.deleteProgram(program);
		throw new Error(`Failed to link V2 terrain geometry shader: ${message}`);
	}

	return {
		program,
		uniforms: {
			uColor: requireUniform(gl, program, "uColor"),
			uModelViewProjection: requireUniform(gl, program, "uModelViewProjection"),
			uTexture: requireUniform(gl, program, "uTexture"),
			uUseTexture: requireUniform(gl, program, "uUseTexture"),
		},
		dispose() {
			gl.deleteProgram(program);
		},
	};
}

function createTerrainGeometryResource(
	gl: WebGL2RenderingContext,
	drawUnit: TerrainGeometryStaticDrawUnit,
	translation: readonly [number, number, number],
): TerrainGeometryResource {
	const vertexArray = gl.createVertexArray();
	const positionBuffer = gl.createBuffer();
	const texCoordBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (!vertexArray || !positionBuffer || !texCoordBuffer || !indexBuffer) {
		if (vertexArray) {
			gl.deleteVertexArray(vertexArray);
		}
		if (positionBuffer) {
			gl.deleteBuffer(positionBuffer);
		}
		if (texCoordBuffer) {
			gl.deleteBuffer(texCoordBuffer);
		}
		if (indexBuffer) {
			gl.deleteBuffer(indexBuffer);
		}
		throw new Error(`Failed to create GPU buffers for ${drawUnit.drawUnitId}.`);
	}

	gl.bindVertexArray(vertexArray);
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		translateTerrainPositions(
			drawUnit.positions,
			translation,
		),
		gl.STATIC_DRAW,
	);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, drawUnit.texCoords, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(1);
	gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, drawUnit.indices, gl.STATIC_DRAW);
	gl.bindVertexArray(null);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

	return {
		drawUnitId: drawUnit.drawUnitId,
		indexBuffer,
		indexCount: drawUnit.indices.length,
		indexType: drawUnit.indexType === "uint16" ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
		positionBuffer,
		texCoordBuffer,
		triangleCount: drawUnit.triangleCount,
		vertexArray,
		dispose() {
			gl.deleteBuffer(positionBuffer);
			gl.deleteBuffer(texCoordBuffer);
			gl.deleteBuffer(indexBuffer);
			gl.deleteVertexArray(vertexArray);
		},
	};
}

function translateTerrainPositions(
	positions: Float32Array,
	translation: readonly [number, number, number],
): Float32Array {
	if (translation[0] === 0 && translation[1] === 0 && translation[2] === 0) {
		return positions;
	}

	const translated = new Float32Array(positions);
	for (let index = 0; index < translated.length; index += 3) {
		translated[index] += translation[0];
		translated[index + 1] += translation[1];
		translated[index + 2] += translation[2];
	}

	return translated;
}

function createDirectTexture(
	gl: WebGL2RenderingContext,
	placement: TexturePlacementUpdate["placements"][number],
): WebGLTexture {
	if (placement.format !== "rgba8") {
		throw new Error(
			`V2 WebGL2 renderer only supports rgba8 direct textures. Received ${placement.format}.`,
		);
	}

	const texture = gl.createTexture();
	if (!texture) {
		throw new Error(`Failed to create texture ${placement.textureRefId}.`);
	}

	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA,
		placement.width,
		placement.height,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		placement.pixels,
	);
	gl.bindTexture(gl.TEXTURE_2D, null);

	return texture;
}

function compileShader(
	gl: WebGL2RenderingContext,
	shaderType: GLenum,
	source: string,
): WebGLShader {
	const shader = gl.createShader(shaderType);
	if (!shader) {
		throw new Error("Failed to create V2 terrain geometry shader.");
	}
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const message = gl.getShaderInfoLog(shader) ?? "unknown compile error";
		gl.deleteShader(shader);
		throw new Error(`Failed to compile V2 terrain geometry shader: ${message}`);
	}

	return shader;
}

function requireUniform(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	name: string,
): WebGLUniformLocation {
	const uniform = gl.getUniformLocation(program, name);
	if (!uniform) {
		throw new Error(`V2 terrain geometry shader is missing uniform ${name}.`);
	}

	return uniform;
}

function createModelViewProjectionMatrix(
	frameState: FrameState,
	aspectRatio: number,
): Float32Array {
	const projection = createPerspectiveMatrix(Math.PI / 3, aspectRatio, 1, 5000);
	const view = createViewMatrix(frameState);
	return multiplyMat4(projection, view);
}

function createPerspectiveMatrix(
	fovyRadians: number,
	aspectRatio: number,
	near: number,
	far: number,
): Float32Array {
	const f = 1 / Math.tan(fovyRadians / 2);
	const rangeInv = 1 / (near - far);

	return new Float32Array([
		f / aspectRatio, 0, 0, 0,
		0, f, 0, 0,
		0, 0, (near + far) * rangeInv, -1,
		0, 0, near * far * rangeInv * 2, 0,
	]);
}

function createViewMatrix(frameState: FrameState): Float32Array {
	const [cameraX, cameraY, cameraZ] = frameState.camera.position;
	const pitch = frameState.camera.pitchRadians;
	const yaw = frameState.camera.yawRadians;
	const cosPitch = Math.cos(pitch);
	const forward = normalizeVec3([
		Math.sin(yaw) * cosPitch,
		Math.sin(pitch),
		-Math.cos(yaw) * cosPitch,
	]);
	const target = [
		cameraX + forward[0],
		cameraY + forward[1],
		cameraZ + forward[2],
	] as const;

	return createLookAtMatrix([cameraX, cameraY, cameraZ], target, [0, 1, 0]);
}

function createLookAtMatrix(
	eye: readonly [number, number, number],
	target: readonly [number, number, number],
	up: readonly [number, number, number],
): Float32Array {
	const zAxis = normalizeVec3([
		eye[0] - target[0],
		eye[1] - target[1],
		eye[2] - target[2],
	]);
	const xAxis = normalizeVec3(crossVec3(up, zAxis));
	const yAxis = crossVec3(zAxis, xAxis);

	return new Float32Array([
		xAxis[0], yAxis[0], zAxis[0], 0,
		xAxis[1], yAxis[1], zAxis[1], 0,
		xAxis[2], yAxis[2], zAxis[2], 0,
		-dotVec3(xAxis, eye), -dotVec3(yAxis, eye), -dotVec3(zAxis, eye), 1,
	]);
}

function multiplyMat4(left: Float32Array, right: Float32Array): Float32Array {
	const result = new Float32Array(16);

	for (let column = 0; column < 4; column += 1) {
		for (let row = 0; row < 4; row += 1) {
			result[column * 4 + row] =
				left[0 * 4 + row] * right[column * 4 + 0] +
				left[1 * 4 + row] * right[column * 4 + 1] +
				left[2 * 4 + row] * right[column * 4 + 2] +
				left[3 * 4 + row] * right[column * 4 + 3];
		}
	}

	return result;
}

function normalizeVec3(
	value: readonly [number, number, number],
): readonly [number, number, number] {
	const length = Math.hypot(value[0], value[1], value[2]);
	if (length === 0) {
		return [0, 0, 0];
	}

	return [value[0] / length, value[1] / length, value[2] / length];
}

function crossVec3(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): readonly [number, number, number] {
	return [
		left[1] * right[2] - left[2] * right[1],
		left[2] * right[0] - left[0] * right[2],
		left[0] * right[1] - left[1] * right[0],
	];
}

function dotVec3(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): number {
	return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

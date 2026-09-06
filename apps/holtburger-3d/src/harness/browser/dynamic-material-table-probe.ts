import {
	createObjectFragmentShader,
	createObjectVertexShader,
	createWebGL2ObjectProgram,
	OBJECT_TEXTURE_UNITS,
} from "../../lib/game/renderer/webgl2-object-program";
import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../../lib/game/webgl/shader-program";
import { WebGL2GpuFrameProfiler } from "../../lib/game/renderer/webgl2-gpu-frame-profiler";
import {
	createObjectMaterialTable,
	OBJECT_MATERIAL_TEXELS,
} from "../../lib/game/renderer/object-material-table";
import type { PreparedObjectMaterial } from "../../lib/game/renderer/object-rendering-policy";
import { compileDynamicIndexBatches } from "../../lib/game/renderer/dynamic-index-batches";
import { WebGL2DynamicPosePages } from "../../lib/game/renderer/webgl2-dynamic-pose-pages";
import { Mat4, Vec3 } from "../../lib/game/math/types";
import { mat4ToFloat32Array } from "../../lib/game/math/matrices";
import type { PreparedObjectSurface } from "../../lib/game/renderer/object-rendering-policy";
import type { DynamicAppearance } from "../../lib/game/systems/dynamic-appearance";
import {
	createAssetTextureKey,
	TexturePurpose,
	TextureWrapMode,
} from "../../lib/game/textures/types";

/** Logical fixtures for the two physical probe materials; no source flag changes blend state. */
function probeAppearance(
	surfaces: readonly PreparedObjectSurface<number, null>[],
): DynamicAppearance {
	return {
		materials: surfaces.map(({ material, wrapRepeat, palettedClipMap }) => {
			const facts = {
				id: "material:probe" as const,
				rawSurfaceFlags: 0,
				translucency: 0,
				luminosity: 0,
				diffuseScale: 1,
			};
			return {
				source:
					material.kind === "solid-color"
						? { ...facts, kind: "solid-color", color: material.color }
						: {
								...facts,
								kind: "texture",
								colorTextureId: "0x05000001",
								renderSurfaceId: "0x06000001",
								paletteTextureId:
									material.kind === "direct-color" ? null : "0x04000001",
								paletteComposite: null,
								textureEncoding: material.kind,
							},
				detailRole: null,
				textures: {
					base:
						material.kind === "solid-color"
							? null
							: createAssetTextureKey(
									material.kind === "direct-color"
										? TexturePurpose.ObjectDirectColor
										: material.kind === "index8"
											? TexturePurpose.ObjectIndex8
											: TexturePurpose.ObjectIndex16,
									"0x06000001",
								),
					palette:
						material.kind === "index8" || material.kind === "index16"
							? createAssetTextureKey(
									TexturePurpose.ObjectPalette,
									"0x04000001",
								)
							: null,
				},
				sampler: {
					wrap: wrapRepeat ? TextureWrapMode.Repeat : TextureWrapMode.Clamp,
				},
				palettedClipMap,
			};
		}),
		ranges: surfaces.map((_, selector) => ({
			transparentSort: { key: "fixture-order", center: Vec3.zero() },
			partSelector: selector,
			materialSelector: selector,
			indexStart: selector * 6,
			indexCount: 6,
			ordering: "opaque",
			polygon: { cullFace: "back", stippled: false },
			retailVisibility: "normally-visible",
		})),
	};
}

/** Synthetic physical units mirror the probe bindings; production packing reads their rectangles. */
function probeMaterial(
	kind: PreparedObjectMaterial<number, null>["kind"],
	color: readonly [number, number, number, number],
	baseX: number,
): PreparedObjectMaterial<number, null> {
	if (kind === "solid-color") return { kind, color };
	const base = { texture: 0, sampler: null, rect: [baseX, 0, 64, 64] as const };
	if (kind === "direct-color") return { kind, color, base };
	return {
		kind,
		color,
		base,
		palette: { texture: 1, sampler: null, rect: [0, 0, 256, 2] },
	};
}

/** Diagnostic repetitions amortize timer resolution; these are not live-scene frames. */
const SUBMISSION_REPETITIONS = 256;

/** Sample one already-bound synthetic submission with the existing asynchronous GPU profiler. */
async function measureSubmission(
	gl: WebGL2RenderingContext,
	submit: () => void,
) {
	for (let warmup = 0; warmup < 32; warmup += 1) submit();
	gl.finish();
	const profiler = new WebGL2GpuFrameProfiler(gl);
	try {
		const frame = profiler.beginFrame(1);
		const phase = frame?.beginPhase("opaque");
		const started = performance.now();
		for (let iteration = 0; iteration < SUBMISSION_REPETITIONS; iteration += 1)
			submit();
		const cpuMs = performance.now() - started;
		phase?.finish();
		frame?.finish();
		gl.flush();
		const deadline = performance.now() + 2000;
		for (;;) {
			profiler.poll();
			const gpu = profiler.getProfile();
			if (gpu.kind === "available")
				return {
					repetitions: SUBMISSION_REPETITIONS,
					cpuMs,
					gpuMs: gpu.opaqueMs,
				};
			if (gpu.kind === "unsupported" || gpu.kind === "disjoint")
				return {
					repetitions: SUBMISSION_REPETITIONS,
					cpuMs,
					gpuUnavailable: gpu.kind,
				};
			if (performance.now() >= deadline)
				throw new Error(
					"Material-table GPU query did not complete within 2 seconds.",
				);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	} finally {
		profiler.destroy();
	}
}

/** Replace a known shader declaration once; fail rather than silently testing the old mechanism. */
function replaceDeclaration(
	source: string,
	declaration: string,
	replacement: string,
): string {
	if (source.split(declaration).length !== 2)
		throw new Error(
			`Material-table probe expected one declaration: ${declaration}`,
		);
	return source.replace(declaration, replacement);
}

/** Compare production uniforms with RGBA32F pose/material records using only ordinary draws. */
export async function probeDynamicMaterialTables() {
	const canvas = document.createElement("canvas");
	canvas.width = 64;
	canvas.height = 32;
	const gl = canvas.getContext("webgl2", { antialias: false });
	if (gl === null) throw new Error("Material-table probe requires WebGL2.");
	const posePages = new WebGL2DynamicPosePages<string>(gl);
	try {
		const preparationStarted = performance.now();
		let referenceVertex = replaceDeclaration(
			createObjectVertexShader(false),
			"uniform mat4 uLocalToLandblock;",
			"uniform mat4 uLocalToLandblock;\nuniform vec4 uPartColor;",
		);
		referenceVertex = replaceDeclaration(
			referenceVertex,
			"vInstanceColor = vec4(1.0);",
			"vInstanceColor = uPartColor;",
		);
		const reference = linkWebGL2Program(
			gl,
			"uniform material reference",
			referenceVertex,
			createObjectFragmentShader(false),
		);
		const merged = createWebGL2ObjectProgram(gl, {
			distanceFog: false,
			portalVisibility: false,
			outdoorPssm: false,
			transformSource: "pose-table",
			materialSource: "table",
		}).program;
		const staticTable = createWebGL2ObjectProgram(gl, {
			distanceFog: false,
			portalVisibility: false,
			outdoorPssm: false,
			transformSource: "uniform",
			materialSource: "table",
		}).program;
		// Exercise every planned color-program interface, including combined portal/PSSM/fog.
		let linkedTableVariants = 0;
		let linkedStaticTableVariants = 0;
		for (const fog of [false, true]) {
			for (const portal of [false, true]) {
				for (const pssm of [false, true]) {
					const variant = createWebGL2ObjectProgram(gl, {
						distanceFog: fog,
						portalVisibility: portal,
						outdoorPssm: pssm,
						transformSource: "pose-table",
						materialSource: "table",
					});
					gl.deleteProgram(variant.program);
					linkedTableVariants += 1;
					const staticVariant = createWebGL2ObjectProgram(gl, {
						distanceFog: fog,
						portalVisibility: portal,
						outdoorPssm: pssm,
						transformSource: "uniform",
						materialSource: "table",
					});
					gl.deleteProgram(staticVariant.program);
					linkedStaticTableVariants += 1;
				}
			}
		}
		const identity = new Float32Array([
			1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
		]);
		const primaryPart = {
			frameInstance: {
				sourceToLandblock: new Mat4(
					0.4,
					0,
					0,
					0,
					0,
					0.65,
					0,
					0,
					0,
					0,
					1,
					0,
					-0.5,
					0,
					0,
					1,
				),
				color: { r: 1, g: 1, b: 1, a: 1 },
			},
		};
		const secondaryPart = {
			frameInstance: {
				sourceToLandblock: new Mat4(
					0.3,
					0,
					0,
					0,
					0,
					0.4,
					0,
					0,
					0,
					0,
					0.6,
					0,
					0.5,
					0,
					0,
					1,
				),
				color: { r: 1, g: 1, b: 1, a: 1 },
			},
		};
		const packedEntities = new Map([
			["padding", [primaryPart]],
			["fixture", [primaryPart, secondaryPart]],
		]);
		const poses = new Float32Array([
			...mat4ToFloat32Array(primaryPart.frameInstance.sourceToLandblock),
			...[1, 1, 1, 1],
			...mat4ToFloat32Array(secondaryPart.frameInstance.sourceToLandblock),
			...[1, 1, 1, 1],
		]);
		const buffer = (target: number, data: Float32Array | Uint32Array) => {
			const resource = gl.createBuffer();
			if (resource === null)
				throw new Error("Material-table probe buffer allocation failed.");
			gl.bindBuffer(target, resource);
			gl.bufferData(target, data, gl.STATIC_DRAW);
			return resource;
		};
		const positions = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
		const normals = [1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1];
		const uv = [-0.25, -0.25, 1.25, -0.25, 1.25, 1.25, -0.25, 1.25];
		for (const [location, size, values] of [
			[0, 3, positions],
			[1, 3, normals],
			[2, 2, uv],
		] as const) {
			buffer(gl.ARRAY_BUFFER, new Float32Array([...values, ...values]));
			gl.enableVertexAttribArray(location);
			gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
		}
		for (const location of [3, 4]) {
			buffer(gl.ARRAY_BUFFER, new Uint32Array([0, 0, 0, 0, 1, 1, 1, 1]));
			gl.enableVertexAttribArray(location);
			gl.vertexAttribIPointer(location, 1, gl.UNSIGNED_INT, 0, 0);
		}
		const sourceIndices = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
		const indexBuffer = buffer(gl.ELEMENT_ARRAY_BUFFER, sourceIndices);
		const textures = [0, 1, 2, 3, 4].map((unit) => {
			const texture = gl.createTexture();
			if (texture === null)
				throw new Error("Material-table probe texture allocation failed.");
			gl.activeTexture(gl.TEXTURE0 + unit);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			return texture;
		});
		const upload = (
			unit: number,
			width: number,
			height: number,
			data: Float32Array | Uint8Array,
		) => {
			const texture = textures[unit];
			if (texture === undefined)
				throw new Error(`Probe texture unit ${unit} was not allocated.`);
			gl.activeTexture(gl.TEXTURE0 + unit);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				data instanceof Float32Array ? gl.RGBA32F : gl.RGBA8,
				width,
				height,
				0,
				gl.RGBA,
				data instanceof Float32Array ? gl.FLOAT : gl.UNSIGNED_BYTE,
				data,
			);
		};
		upload(2, 1, 1, new Uint8Array([255, 255, 255, 255]));
		upload(OBJECT_TEXTURE_UNITS.poses, 5, 2, poses);
		const configure = (program: WebGLProgram) => {
			gl.useProgram(program);
			const uniform = (name: string) => requireWebGL2Uniform(gl, program, name);
			gl.uniformMatrix4fv(uniform("uProjection"), false, identity);
			gl.uniformMatrix4fv(uniform("uView"), false, identity);
			gl.uniform4f(uniform("uClipTransform"), 1, 1, 0, 0);
			gl.uniform3f(uniform("uAmbientColor"), 1, 1, 1);
			gl.uniform1f(uniform("uAmbientLevel"), 0.3);
			gl.uniform3f(uniform("uSunVector"), 0, 0, 1);
			gl.uniform3f(uniform("uSunColor"), 0.5, 0.5, 0.5);
			gl.uniform1i(uniform("uBase"), 0);
			gl.uniform1i(uniform("uPalette"), 1);
			gl.uniform1i(uniform("uDetail"), 2);
			return uniform;
		};
		gl.viewport(0, 0, canvas.width, canvas.height);
		const prototypePreparationMs = performance.now() - preparationStarted;
		const cases: {
			kind: number;
			wrap: number;
			rejection: boolean;
			partOpacity: number;
			testedPixels: number;
		}[] = [];
		let staticTableCases = 0;
		const timings: {
			strategy: "uniform" | "table" | "table-static" | "table-packed";
			sample: Awaited<ReturnType<typeof measureSubmission>>;
		}[] = [];
		for (const [materialKind, kind] of [
			["solid-color", 0],
			["direct-color", 1],
			["index8", 2],
			["index16", 3],
		] as const)
			for (const wrap of [0, 1])
				for (const rejection of [false, true])
					for (const partOpacity of [1, 0.35, 0]) {
						poses[19] = partOpacity;
						primaryPart.frameInstance.color.a = partOpacity;
						upload(OBJECT_TEXTURE_UNITS.poses, 5, 2, poses);
						if (partOpacity === 0.35) {
							gl.enable(gl.BLEND);
							gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
						} else gl.disable(gl.BLEND);
						// Two atlas rectangles exercise table-selected addressing; index16 uses a nonzero high byte.
						const index = kind === 3 && !rejection ? 258 : 2;
						const base = new Uint8Array(128 * 64 * 4);
						for (let y = 0; y < 64; y += 1)
							for (let x = 0; x < 128; x += 1) {
								const checker = (Math.floor(x / 4) + Math.floor(y / 4)) % 2;
								const encoded = index + checker;
								base.set(
									kind === 1
										? [
												checker * 200 + 20,
												(1 - checker) * 170 + 40,
												x + 50,
												255,
											]
										: [encoded % 256, Math.floor(encoded / 256), 0, 255],
									(y * 128 + x) * 4,
								);
							}
						upload(0, 128, 64, base);
						gl.texParameteri(
							gl.TEXTURE_2D,
							gl.TEXTURE_MIN_FILTER,
							kind === 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST,
						);
						gl.texParameteri(
							gl.TEXTURE_2D,
							gl.TEXTURE_MAG_FILTER,
							kind === 1 ? gl.LINEAR : gl.NEAREST,
						);
						if (kind === 1) gl.generateMipmap(gl.TEXTURE_2D);
						const palette = new Uint8Array(512 * 4);
						palette.set([220, 40, 80, 255], index * 4);
						palette.set([20, 210, 130, 255], (index + 1) * 4);
						upload(1, 256, 2, palette);
						const surfaces = [
							{
								material: probeMaterial(
									materialKind,
									[1, 0.5, 0.7, rejection && kind < 2 ? 0.25 : 1],
									0,
								),
								wrapRepeat: wrap === 1,
								palettedClipMap: rejection,
								luminosity: 0.1,
								alphaTest: 0.5,
							},
							{
								material: probeMaterial(materialKind, [0.5, 1, 0.7, 1], 64),
								wrapRepeat: wrap === 0,
								palettedClipMap: false,
								luminosity: 0.2,
								alphaTest: 0.5,
							},
						];
						const physical = compileDynamicIndexBatches(
							sourceIndices,
							probeAppearance(surfaces),
							surfaces,
						);
						if (
							physical.batches.length !== 1 ||
							physical.indices.length !== sourceIndices.length
						)
							throw new Error(
								"Probe materials did not compile to one lossless physical batch.",
							);
						gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
						gl.bufferData(
							gl.ELEMENT_ARRAY_BUFFER,
							physical.indices,
							gl.STATIC_DRAW,
						);
						const records = createObjectMaterialTable(surfaces);
						upload(
							OBJECT_TEXTURE_UNITS.materials,
							OBJECT_MATERIAL_TEXELS,
							2,
							records,
						);
						const uniform = configure(reference);
						gl.clear(gl.COLOR_BUFFER_BIT);
						for (let part = 0; part < 2; part += 1) {
							if (poses[part * 20 + 19] === 0) continue;
							const offset = part * 20;
							gl.uniformMatrix4fv(
								uniform("uLocalToLandblock"),
								false,
								poses.subarray(part * 20, part * 20 + 16),
							);
							gl.uniform4fv(
								uniform("uPartColor"),
								poses.subarray(part * 20 + 16, part * 20 + 20),
							);
							gl.uniform4fv(
								uniform("uMaterialColor"),
								records.subarray(offset, offset + 4),
							);
							gl.uniform4fv(
								uniform("uBaseRect"),
								records.subarray(offset + 4, offset + 8),
							);
							gl.uniform4fv(
								uniform("uPaletteRect"),
								records.subarray(offset + 8, offset + 12),
							);
							gl.uniform1i(uniform("uMaterialKind"), kind);
							gl.uniform1i(uniform("uWrapRepeat"), records[offset + 13]);
							gl.uniform1i(uniform("uPalettedClipMap"), records[offset + 14]);
							gl.uniform1f(uniform("uLuminosity"), records[offset + 15]);
							gl.uniform1f(uniform("uAlphaTest"), 0.5);
							gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, part * 6 * 4);
						}
						const expected = new Uint8Array(canvas.width * canvas.height * 4);
						gl.readPixels(
							0,
							0,
							canvas.width,
							canvas.height,
							gl.RGBA,
							gl.UNSIGNED_BYTE,
							expected,
						);
						posePages.upload(packedEntities);
						// Uploads use texture unit zero. Restore the fixture's sampled bindings explicitly.
						for (const [unit, texture] of textures.entries()) {
							gl.activeTexture(gl.TEXTURE0 + unit);
							gl.bindTexture(gl.TEXTURE_2D, texture);
						}
						const packed = posePages.get("fixture");
						gl.activeTexture(gl.TEXTURE0 + OBJECT_TEXTURE_UNITS.poses);
						gl.bindTexture(gl.TEXTURE_2D, packed.texture);
						const mergedUniform = configure(merged);
						gl.uniform1i(mergedUniform("uFirstPoseRow"), packed.firstRow);
						gl.clear(gl.COLOR_BUFFER_BIT);
						gl.drawElements(gl.TRIANGLES, 12, gl.UNSIGNED_INT, 0);
						const actual = new Uint8Array(expected.length);
						gl.readPixels(
							0,
							0,
							canvas.width,
							canvas.height,
							gl.RGBA,
							gl.UNSIGNED_BYTE,
							actual,
						);
						const error = gl.getError();
						if (error !== gl.NO_ERROR)
							throw new Error(`Material-table probe GL error ${error}.`);
						if (!expected.some((value) => value !== 0))
							throw new Error("Reference probe rendered no pixels.");
						const mismatch = actual.findIndex(
							(value, index) => value !== expected[index],
						);
						if (mismatch !== -1)
							throw new Error(
								`Material-table mismatch kind=${kind} wrap=${wrap} byte=${mismatch}: ${actual[mismatch]} != ${expected[mismatch]}.`,
							);
						cases.push({
							kind,
							wrap,
							rejection,
							partOpacity,
							testedPixels: canvas.width * canvas.height,
						});
						if (partOpacity === 1) {
							// Static geometry selects material rows independently of its draw transform.
							// Keep source positions and separate transforms here to compare pixels exactly;
							// geometry baking and range merging have their own later verification boundary.
							const staticUniform = configure(staticTable);
							gl.clear(gl.COLOR_BUFFER_BIT);
							for (let part = 0; part < 2; part += 1) {
								gl.uniformMatrix4fv(
									staticUniform("uLocalToLandblock"),
									false,
									poses.subarray(part * 20, part * 20 + 16),
								);
								gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, part * 6 * 4);
							}
							gl.readPixels(
								0,
								0,
								canvas.width,
								canvas.height,
								gl.RGBA,
								gl.UNSIGNED_BYTE,
								actual,
							);
							if (gl.getError() !== gl.NO_ERROR)
								throw new Error("Static material-table probe GL error.");
							if (actual.some((value, index) => value !== expected[index]))
								throw new Error(
									`Static material-table mismatch kind=${kind} wrap=${wrap} rejection=${rejection}.`,
								);
							staticTableCases += 1;
							configure(merged);
						}
						// Keep the established upload-isolation benchmark on its original two-row texture.
						for (const [unit, texture] of textures.entries()) {
							gl.activeTexture(gl.TEXTURE0 + unit);
							gl.bindTexture(gl.TEXTURE_2D, texture);
						}
						gl.uniform1i(mergedUniform("uFirstPoseRow"), 0);
						if (kind === 3 && wrap === 1 && !rejection && partOpacity === 1) {
							// Pre-resolve locations and typed-array views: do not bill shader discovery or
							// transient view allocation to the per-part reference submission.
							const names = [
								"uLocalToLandblock",
								"uMaterialColor",
								"uBaseRect",
								"uPaletteRect",
								"uWrapRepeat",
								"uPalettedClipMap",
								"uLuminosity",
							] as const;
							const locations = Object.fromEntries(
								names.map((name) => [name, uniform(name)]),
							);
							const referenceParts = [0, 1].map((part) => ({
								pose: poses.subarray(part * 20, part * 20 + 16),
								color: records.subarray(part * 20, part * 20 + 4),
								base: records.subarray(part * 20 + 4, part * 20 + 8),
								palette: records.subarray(part * 20 + 8, part * 20 + 12),
								wrap: records[part * 20 + 13],
								clip: records[part * 20 + 14],
								luminosity: records[part * 20 + 15],
								offset: part * 6 * Uint32Array.BYTES_PER_ELEMENT,
							}));
							const referenceSubmit = () => {
								for (const part of referenceParts) {
									gl.uniformMatrix4fv(
										locations.uLocalToLandblock,
										false,
										part.pose,
									);
									gl.uniform4fv(locations.uMaterialColor, part.color);
									gl.uniform4fv(locations.uBaseRect, part.base);
									gl.uniform4fv(locations.uPaletteRect, part.palette);
									gl.uniform1i(locations.uWrapRepeat, part.wrap);
									gl.uniform1i(locations.uPalettedClipMap, part.clip);
									gl.uniform1f(locations.uLuminosity, part.luminosity);
									gl.drawElements(
										gl.TRIANGLES,
										6,
										gl.UNSIGNED_INT,
										part.offset,
									);
								}
							};
							const tableSubmit = () => {
								// Pose upload remains frame work; immutable material records do not.
								gl.texSubImage2D(
									gl.TEXTURE_2D,
									0,
									0,
									0,
									5,
									2,
									gl.RGBA,
									gl.FLOAT,
									poses,
								);
								gl.drawElements(gl.TRIANGLES, 12, gl.UNSIGNED_INT, 0);
							};
							for (let sample = 0; sample < 3; sample += 1) {
								configure(reference);
								timings.push({
									strategy: "uniform",
									sample: await measureSubmission(gl, referenceSubmit),
								});
								configure(merged);
								gl.activeTexture(gl.TEXTURE0 + OBJECT_TEXTURE_UNITS.poses);
								timings.push({
									strategy: "table",
									sample: await measureSubmission(gl, tableSubmit),
								});
								timings.push({
									strategy: "table-static",
									sample: await measureSubmission(gl, () =>
										gl.drawElements(gl.TRIANGLES, 12, gl.UNSIGNED_INT, 0),
									),
								});
							}
							// Pack distinct entity rows and upload before any draw consumes them. This
							// isolates streaming upload hazards from vertex/fragment table lookup cost.
							const packed = new Float32Array(
								poses.length * SUBMISSION_REPETITIONS,
							);
							for (let entity = 0; entity < SUBMISSION_REPETITIONS; entity += 1)
								packed.set(poses, entity * poses.length);
							upload(
								OBJECT_TEXTURE_UNITS.poses,
								5,
								2 * SUBMISSION_REPETITIONS,
								packed,
							);
							const poseOffset = requireWebGL2Uniform(
								gl,
								merged,
								"uFirstPoseRow",
							);
							let entity = 0;
							for (let sample = 0; sample < 3; sample += 1) {
								timings.push({
									strategy: "table-packed",
									sample: await measureSubmission(gl, () => {
										if (entity === 0)
											gl.texSubImage2D(
												gl.TEXTURE_2D,
												0,
												0,
												0,
												5,
												2 * SUBMISSION_REPETITIONS,
												gl.RGBA,
												gl.FLOAT,
												packed,
											);
										gl.uniform1i(poseOffset, entity * 2);
										gl.drawElements(gl.TRIANGLES, 12, gl.UNSIGNED_INT, 0);
										entity = (entity + 1) % SUBMISSION_REPETITIONS;
									}),
								});
							}
							gl.uniform1i(poseOffset, 0);
							upload(OBJECT_TEXTURE_UNITS.poses, 5, 2, poses);
						}
					}
		// Exercise a packed entity at the device's last legal rows, independently of the
		// small content fixtures. Capacity limits must be queried, not copied from this GPU.
		const maximumRows = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
		const boundaryReference = new Uint8Array(canvas.width * canvas.height * 4);
		gl.readPixels(
			0,
			0,
			canvas.width,
			canvas.height,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			boundaryReference,
		);
		const boundaryPoses = new Float32Array(maximumRows * 20);
		boundaryPoses.set(poses, (maximumRows - 2) * 20);
		upload(OBJECT_TEXTURE_UNITS.poses, 5, maximumRows, boundaryPoses);
		gl.uniform1i(
			requireWebGL2Uniform(gl, merged, "uFirstPoseRow"),
			maximumRows - 2,
		);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.drawElements(gl.TRIANGLES, 12, gl.UNSIGNED_INT, 0);
		const boundaryActual = new Uint8Array(boundaryReference.length);
		gl.readPixels(
			0,
			0,
			canvas.width,
			canvas.height,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			boundaryActual,
		);
		if (
			gl.getError() !== gl.NO_ERROR ||
			boundaryActual.some((value, index) => value !== boundaryReference[index])
		)
			throw new Error(
				"Packed pose addressing failed at the device's last legal rows.",
			);
		return {
			cases,
			linkedTableVariants,
			linkedStaticTableVariants,
			staticTableCases,
			prototypePreparationMs,
			boundaryPoseRow: maximumRows - 2,
			timings,
			poseBytes: poses.byteLength,
			materialBytes: 2 * 20 * 4,
			maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
			maxVertexTextureUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
			maxFragmentTextureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
		};
	} finally {
		posePages.destroy();
		gl.getExtension("WEBGL_lose_context")?.loseContext();
	}
}

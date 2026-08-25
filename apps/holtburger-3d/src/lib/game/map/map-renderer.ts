import type { EnvCellId, LandblockId } from "../game-types";
import { createLandblockWorldOrigin } from "../landblocks";
import { writeMat4ToFloat32Array } from "../math/matrices";
import type { InstalledTerrain } from "../terrain/terrain-system";
import type { ResolvedMapSurface } from "../resolution/presentation";
import type {
	MapGeometryStore,
	MapSurfaceInstance,
} from "./map-geometry-store";
import { MapInteriorSelection } from "./map-interior-selection";
import {
	createMapSurfaceProgram,
	MAP_SURFACE_POSITION_ATTRIBUTE,
	type MapSurfaceProgram,
} from "./map-surface-program";
import {
	MAP_AMBIENT_LEVEL,
	MAP_BLOCKER_COLOR,
	MAP_BLOCKER_STROKE_COLOR,
	MAP_BLOCKER_STROKE_PIXELS,
	MAP_CONTOUR_HEIGHT_SPAN,
	MAP_CONTOUR_INTERVAL,
	MAP_CONTOUR_MINIMUM_CLIMB_PER_PIXEL,
	MAP_CONTOUR_STRENGTH,
	MAP_FLOOR_DEPTH_SPAN,
	MAP_HEIGHT_ABOVE_COLOR,
	MAP_HEIGHT_BELOW_COLOR,
	MAP_HEIGHT_SAME_LEVEL_COLOR,
	MAP_FLOOR_FADE_SPAN,
	MAP_FLOOR_MAXIMUM_FADE,
	MAP_FLOOR_SAME_LEVEL_BAND,
	MAP_FLOOR_TINT_SPAN,
	MAP_IMPASSABLE_COLOR,
	MAP_IMPASSABLE_HATCH_PERIOD_PIXELS,
	MAP_IMPASSABLE_HATCH_STRENGTH,
	MAP_RELIEF_EXAGGERATION,
	MAP_ROAD_COLOR,
	MAP_ROAD_TINT_STRENGTH,
	MAP_TRANSITION_ACCENT_COLOR,
	MAP_SUN_DIRECTION,
	MAP_VOID_COLOR,
	MAP_VOID_COLOR_VECTOR,
} from "./map-appearance";
import { buildMapTerrainMesh } from "./map-terrain-mesh";
import {
	MAP_TERRAIN_ATTRIBUTES,
	type MapTerrainProgram,
	createMapTerrainProgram,
} from "./map-terrain-program";
import {
	type MapViewParameters,
	computeMapWorldToClip,
	mapEnvironment,
	writeMapWorldToClip,
} from "./map-view";

/**
 * Everything the map reads from the running game.
 *
 * Narrow on purpose: the map takes terrain facts and a palette, never renderer, scene, or resource
 * internals. `GameRuntime` satisfies this structurally, so the map never imports it and cannot grow
 * into a second scene renderer by reaching for what it can see.
 */
export interface MapTerrainSource {
	/** Changes whenever a landblock's terrain is installed or removed. */
	readonly terrainInstallationRevision: number;
	listInstalledTerrain(): Iterable<InstalledTerrain>;
	/** Regional mean colour per terrain code, or null before the region's colours publish. */
	terrainColorPalette(): Float32Array | null;
	/** Derived floors and blockers, installed and evicted with the layers they came from. */
	readonly mapGeometry: MapGeometryStore;
}

/** Landblock-local geometry places itself, so accents upload this instead of a transform. */
const MAP_IDENTITY_TRANSFORM = new Float32Array([
	1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

/** GPU residency for one derived surface, uploaded once and drawn per placement. */
interface MapSurfaceBuffers {
	readonly vertexArray: WebGLVertexArrayObject;
	readonly positions: WebGLBuffer;
	readonly indices: WebGLBuffer;
	readonly indexCount: number;
	/** Horizontal centre of the surface's own vertices, which the outline pass expands away from. */
	readonly centerX: number;
	readonly centerZ: number;
}

/** GPU residency for one landblock's map terrain. */
interface MapTerrainBuffers {
	readonly vertexArray: WebGLVertexArrayObject;
	readonly buffers: readonly WebGLBuffer[];
	readonly vertexCount: number;
	readonly originX: number;
	readonly originZ: number;
}

/**
 * Standalone overhead-map renderer.
 *
 * Owns its own canvas and WebGL2 context because contexts cannot share resources with the scene
 * renderer's; the only duplicated upload is small per-landblock terrain data. Context loss is
 * terminal here exactly as it is for the scene device: there is no restoration path to mirror, so a
 * lost map context reports unavailable rather than pretending to draw.
 */
export class MapRenderer {
	readonly #canvas: HTMLCanvasElement;
	readonly #source: MapTerrainSource;
	readonly #gl: WebGL2RenderingContext;
	readonly #program: MapTerrainProgram;
	readonly #surfaceProgram: MapSurfaceProgram;
	readonly #interiorSelection = new MapInteriorSelection();
	/**
	 * Uploaded surfaces keyed by their source array, so one building model or cell structure is
	 * resident once no matter how many placements draw it.
	 */
	readonly #surfaces = new Map<Float32Array, MapSurfaceBuffers>();
	readonly #localToLandblock = new Float32Array(16);
	readonly #terrain = new Map<LandblockId, MapTerrainBuffers>();
	/** Reused so the per-frame clip upload allocates nothing. */
	readonly #worldToClip = new Float32Array(4);
	#syncedTerrainRevision: number | null = null;
	#syncedGeometryRevision: number | null = null;
	#contextLost = false;
	#destroyed = false;

	readonly #onContextLost = (event: Event): void => {
		event.preventDefault();
		this.#contextLost = true;
		console.error("Overhead map WebGL2 context was lost; the map is offline.");
	};

	constructor(canvas: HTMLCanvasElement, source: MapTerrainSource) {
		const gl = canvas.getContext("webgl2", {
			alpha: false,
			// Thin blocker silhouettes visibly alias at one sample. Browser MSAA keeps those edges
			// legible without supersampling every fragment of this small, cadence-limited canvas.
			antialias: true,
			// Interior floors use depth to resolve vertically overlapping passages.
			depth: true,
			stencil: false,
		});
		if (!gl) throw new Error("Overhead map requires a WebGL2 context.");
		this.#canvas = canvas;
		this.#source = source;
		this.#gl = gl;
		this.#program = createMapTerrainProgram(gl);
		this.#surfaceProgram = createMapSurfaceProgram(gl);
		canvas.addEventListener("webglcontextlost", this.#onContextLost);
	}

	/** Whether the map can still draw; false once its context is lost. */
	get available(): boolean {
		return !this.#contextLost && !this.#destroyed;
	}

	/** Number of landblocks currently resident on the map's context. */
	get residentLandblockCount(): number {
		return this.#terrain.size;
	}

	/**
	 * Bring GPU residency in line with the installed terrain set.
	 *
	 * Keyed to the installation revision rather than re-diffing every frame, matching how the
	 * ambient bakes reconcile against the same counter.
	 */
	sync(): void {
		if (!this.available) return;
		const revision = this.#source.terrainInstallationRevision;
		if (this.#syncedTerrainRevision !== revision) {
			const installed = new Set<LandblockId>();
			for (const terrain of this.#source.listInstalledTerrain()) {
				installed.add(terrain.landblockId);
				if (!this.#terrain.has(terrain.landblockId)) {
					this.#terrain.set(terrain.landblockId, this.#createBuffers(terrain));
				}
			}
			for (const [landblockId, buffers] of this.#terrain) {
				if (installed.has(landblockId)) continue;
				this.#deleteBuffers(buffers);
				this.#terrain.delete(landblockId);
			}
			this.#syncedTerrainRevision = revision;
		}
		this.#syncSurfaceResidency();
	}

	/**
	 * Draw one map frame, returning whether anything was drawn.
	 *
	 * Outdoor mode returns false while the region's palette has not published: terrain colour is not
	 * something to approximate. Indoor floors need no terrain facts and remain independently usable.
	 */
	render(view: MapViewParameters): boolean {
		if (!this.available) return false;
		this.sync();
		const gl = this.#gl;
		const width = this.#canvas.width;
		const height = this.#canvas.height;
		if (width <= 0 || height <= 0) return false;
		gl.viewport(0, 0, width, height);
		gl.clearColor(...MAP_VOID_COLOR, 1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		// Outdoor terrain tiles without overlap, so Phase 1 needs neither depth nor culling. The
		// interior program introduces the anchor-relative depth rule when overlap becomes possible.
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.CULL_FACE);

		writeMapWorldToClip(
			computeMapWorldToClip(view, width, height),
			this.#worldToClip,
		);
		const indoors = mapEnvironment(view.anchor) === "indoor";
		if (!indoors) {
			const palette = this.#source.terrainColorPalette();
			if (!palette || this.#terrain.size === 0) return false;
			const uniforms = this.#program.uniforms;
			gl.useProgram(this.#program.program);
			gl.uniformMatrix2fv(uniforms.worldToClip, false, this.#worldToClip);
			gl.uniform2f(uniforms.mapCenter, view.anchor.worldX, view.anchor.worldZ);
			gl.uniform3fv(uniforms.palette, palette);
			gl.uniform3fv(uniforms.sunDirection, MAP_SUN_DIRECTION);
			gl.uniform1f(uniforms.ambientLevel, MAP_AMBIENT_LEVEL);
			gl.uniform3fv(uniforms.roadColor, MAP_ROAD_COLOR);
			gl.uniform1f(uniforms.roadTintStrength, MAP_ROAD_TINT_STRENGTH);
			gl.uniform3fv(uniforms.impassableColor, MAP_IMPASSABLE_COLOR);
			gl.uniform1f(uniforms.reliefExaggeration, MAP_RELIEF_EXAGGERATION);
			gl.uniform3fv(
				uniforms.contourSameLevelColor,
				MAP_HEIGHT_SAME_LEVEL_COLOR,
			);
			gl.uniform3fv(uniforms.contourAboveColor, MAP_HEIGHT_ABOVE_COLOR);
			gl.uniform3fv(uniforms.contourBelowColor, MAP_HEIGHT_BELOW_COLOR);
			gl.uniform1f(uniforms.contourInterval, MAP_CONTOUR_INTERVAL);
			gl.uniform1f(uniforms.contourStrength, MAP_CONTOUR_STRENGTH);
			gl.uniform1f(
				uniforms.contourMinimumClimbPerPixel,
				MAP_CONTOUR_MINIMUM_CLIMB_PER_PIXEL,
			);
			gl.uniform1f(uniforms.contourHeightSpan, MAP_CONTOUR_HEIGHT_SPAN);
			// The map's own ink: a contour halo is the same dark the map clears to, so lines read as
			// drawn on the terrain rather than as another colour competing with it.
			gl.uniform3fv(uniforms.contourHaloColor, MAP_VOID_COLOR_VECTOR);
			gl.uniform1f(uniforms.anchorHeight, view.anchor.worldY);
			gl.uniform1f(
				uniforms.impassableHatchPeriodPixels,
				MAP_IMPASSABLE_HATCH_PERIOD_PIXELS,
			);
			gl.uniform1f(
				uniforms.impassableHatchStrength,
				MAP_IMPASSABLE_HATCH_STRENGTH,
			);
			for (const buffers of this.#terrain.values()) {
				gl.uniform2f(
					uniforms.landblockOrigin,
					buffers.originX,
					buffers.originZ,
				);
				gl.bindVertexArray(buffers.vertexArray);
				gl.drawArrays(gl.TRIANGLES, 0, buffers.vertexCount);
			}
		}
		this.#drawSurfaces(view, indoors);
		gl.bindVertexArray(null);
		return true;
	}

	/**
	 * Draw the derived surfaces for the current mode.
	 *
	 * Outdoors that is building footprints over the terrain, painted in order with no depth because
	 * outdoor geometry cannot overlap itself. Indoors it is the anchor's own interior component,
	 * depth-tested against the anchor's level so a passage above a corridor resolves correctly.
	 */
	#drawSurfaces(view: MapViewParameters, indoors: boolean): void {
		const gl = this.#gl;
		const uniforms = this.#surfaceProgram.uniforms;
		gl.useProgram(this.#surfaceProgram.program);
		gl.uniformMatrix2fv(uniforms.worldToClip, false, this.#worldToClip);
		gl.uniform2f(uniforms.mapCenter, view.anchor.worldX, view.anchor.worldZ);
		gl.uniform3fv(uniforms.voidColor, MAP_VOID_COLOR_VECTOR);
		gl.uniform1f(uniforms.anchorHeight, view.anchor.worldY);
		gl.uniform1f(uniforms.depthSpan, MAP_FLOOR_DEPTH_SPAN);

		if (!indoors) {
			// Outdoor blockers have no height relationship to the anchor worth drawing, so no fade.
			gl.uniform1f(uniforms.fadeSpan, 0);
			gl.uniform1f(uniforms.sameLevelBand, 0);
			gl.uniform1f(uniforms.tintSpan, 1);
			gl.uniform1f(uniforms.maximumFade, 0);
			gl.uniform3fv(uniforms.aboveTint, MAP_BLOCKER_COLOR);
			gl.uniform3fv(uniforms.belowTint, MAP_BLOCKER_COLOR);
			// Stroke underneath, fill on top, so a rim of the first pass survives around the
			// second. Expansion is a pixel width converted to metres, so a footprint stays outlined
			// at every zoom instead of the outline thinning away as the map pulls back.
			const metresPerPixel =
				view.viewDiameter / Math.min(this.#canvas.width, this.#canvas.height);
			gl.uniform3fv(uniforms.fillColor, MAP_BLOCKER_STROKE_COLOR);
			for (const [
				landblockId,
				instances,
			] of this.#source.mapGeometry.listBlockers()) {
				this.#drawInstances(
					landblockId,
					instances,
					MAP_BLOCKER_STROKE_PIXELS * metresPerPixel,
				);
			}
			gl.uniform3fv(uniforms.fillColor, MAP_BLOCKER_COLOR);
			for (const [
				landblockId,
				instances,
			] of this.#source.mapGeometry.listBlockers()) {
				this.#drawInstances(landblockId, instances);
			}
			this.#drawTransitionAccents(null);
			return;
		}

		const component = this.#interiorSelection.select(
			this.#source.mapGeometry,
			view.anchor.residency,
		);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LESS);
		gl.uniform3fv(uniforms.fillColor, MAP_HEIGHT_SAME_LEVEL_COLOR);
		gl.uniform3fv(uniforms.aboveTint, MAP_HEIGHT_ABOVE_COLOR);
		gl.uniform3fv(uniforms.belowTint, MAP_HEIGHT_BELOW_COLOR);
		gl.uniform1f(uniforms.fadeSpan, MAP_FLOOR_FADE_SPAN);
		gl.uniform1f(uniforms.sameLevelBand, MAP_FLOOR_SAME_LEVEL_BAND);
		gl.uniform1f(uniforms.tintSpan, MAP_FLOOR_TINT_SPAN);
		gl.uniform1f(uniforms.maximumFade, MAP_FLOOR_MAXIMUM_FADE);
		for (const [
			landblockId,
			interior,
		] of this.#source.mapGeometry.listInteriors()) {
			this.#drawInteriorFloors(landblockId, interior.floors, component);
		}
		// Accents lie in their floor plane and are intentionally drawn afterward, so equality must
		// pass rather than letting the floor reject its own doorway marker.
		gl.depthFunc(gl.LEQUAL);
		this.#drawTransitionAccents(component);
		gl.disable(gl.DEPTH_TEST);
	}

	/**
	 * Mark every doorway between inside and outside, in both modes.
	 *
	 * Outdoors these are the entrances a map reader is looking for; indoors they are the way out.
	 * Accents keep their own height so an exit on another level fades exactly as its floor does,
	 * and are drawn after the surfaces they sit on so a doorway is never buried by its own wall.
	 */
	#drawTransitionAccents(component: ReadonlySet<EnvCellId> | null): void {
		const gl = this.#gl;
		const uniforms = this.#surfaceProgram.uniforms;
		gl.uniform1f(uniforms.outlineExpansion, 0);
		gl.uniform3fv(uniforms.fillColor, MAP_TRANSITION_ACCENT_COLOR);
		gl.uniform3fv(uniforms.aboveTint, MAP_TRANSITION_ACCENT_COLOR);
		gl.uniform3fv(uniforms.belowTint, MAP_TRANSITION_ACCENT_COLOR);
		for (const [
			landblockId,
			interior,
		] of this.#source.mapGeometry.listInteriors()) {
			if (interior.transitions.length === 0) continue;
			const origin = createLandblockWorldOrigin(landblockId);
			gl.uniform2f(uniforms.landblockOrigin, origin.x, origin.z);
			// Accents are authored in landblock-local space already, so they place themselves.
			gl.uniformMatrix4fv(
				uniforms.localToLandblock,
				false,
				MAP_IDENTITY_TRANSFORM,
			);
			for (const accent of interior.transitions) {
				if (component && !component.has(accent.envCellId)) continue;
				const buffers = this.#surfaceBuffers(accent.surface);
				if (!buffers) continue;
				gl.bindVertexArray(buffers.vertexArray);
				gl.drawElements(gl.TRIANGLES, buffers.indexCount, gl.UNSIGNED_INT, 0);
			}
		}
	}

	/** Draw only the floor instances in the anchor's connected interior, without a filtered copy. */
	#drawInteriorFloors(
		landblockId: LandblockId,
		floors: readonly (MapSurfaceInstance & { readonly envCellId: EnvCellId })[],
		component: ReadonlySet<EnvCellId>,
	): void {
		const gl = this.#gl;
		const uniforms = this.#surfaceProgram.uniforms;
		const origin = createLandblockWorldOrigin(landblockId);
		gl.uniform2f(uniforms.landblockOrigin, origin.x, origin.z);
		gl.uniform1f(uniforms.outlineExpansion, 0);
		for (const floor of floors) {
			if (!component.has(floor.envCellId)) continue;
			this.#drawInstance(floor);
		}
	}

	/** Draw one landblock's instances, uploading each distinct source surface at most once. */
	#drawInstances(
		landblockId: LandblockId,
		instances: readonly MapSurfaceInstance[],
		outlineExpansion = 0,
	): void {
		if (instances.length === 0) return;
		const gl = this.#gl;
		const uniforms = this.#surfaceProgram.uniforms;
		const origin = createLandblockWorldOrigin(landblockId);
		gl.uniform2f(uniforms.landblockOrigin, origin.x, origin.z);
		gl.uniform1f(uniforms.outlineExpansion, outlineExpansion);
		for (const instance of instances) {
			this.#drawInstance(instance);
		}
	}

	/** Draw one already-landblock-scoped surface placement. */
	#drawInstance(instance: MapSurfaceInstance): void {
		const buffers = this.#surfaceBuffers(instance.surface);
		if (!buffers) return;
		const gl = this.#gl;
		const uniforms = this.#surfaceProgram.uniforms;
		gl.uniform2f(uniforms.outlineCenter, buffers.centerX, buffers.centerZ);
		writeMat4ToFloat32Array(
			instance.placement.localTransform,
			this.#localToLandblock,
			0,
		);
		gl.uniformMatrix4fv(
			uniforms.localToLandblock,
			false,
			this.#localToLandblock,
		);
		gl.bindVertexArray(buffers.vertexArray);
		gl.drawElements(gl.TRIANGLES, buffers.indexCount, gl.UNSIGNED_INT, 0);
	}

	/** Release derived-surface buffers as their source geometry leaves residency. */
	#syncSurfaceResidency(): void {
		const revision = this.#source.mapGeometry.revision;
		if (this.#syncedGeometryRevision === revision) return;
		const retained = new Set<Float32Array>();
		for (const [, instances] of this.#source.mapGeometry.listBlockers()) {
			for (const instance of instances)
				retained.add(instance.surface.positions);
		}
		for (const [, interior] of this.#source.mapGeometry.listInteriors()) {
			for (const floor of interior.floors)
				retained.add(floor.surface.positions);
			for (const transition of interior.transitions) {
				retained.add(transition.surface.positions);
			}
		}
		for (const [positions, buffers] of this.#surfaces) {
			if (retained.has(positions)) continue;
			this.#gl.deleteBuffer(buffers.positions);
			this.#gl.deleteBuffer(buffers.indices);
			this.#gl.deleteVertexArray(buffers.vertexArray);
			this.#surfaces.delete(positions);
		}
		this.#syncedGeometryRevision = revision;
	}

	/** Resolve, uploading on first use, the GPU residency for one derived surface. */
	#surfaceBuffers(surface: ResolvedMapSurface): MapSurfaceBuffers | null {
		const existing = this.#surfaces.get(surface.positions);
		if (existing) return existing;
		if (surface.indices.length === 0) return null;
		const gl = this.#gl;
		const vertexArray = gl.createVertexArray();
		const positions = gl.createBuffer();
		const indices = gl.createBuffer();
		if (!vertexArray || !positions || !indices) {
			throw new Error("Failed to allocate a map surface buffer.");
		}
		gl.bindVertexArray(vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, positions);
		gl.bufferData(gl.ARRAY_BUFFER, surface.positions, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(MAP_SURFACE_POSITION_ATTRIBUTE);
		gl.vertexAttribPointer(
			MAP_SURFACE_POSITION_ATTRIBUTE,
			3,
			gl.FLOAT,
			false,
			0,
			0,
		);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, surface.indices, gl.STATIC_DRAW);
		gl.bindVertexArray(null);
		const buffers = {
			...horizontalCenterOf(surface.positions),
			indexCount: surface.indices.length,
			indices,
			positions,
			vertexArray,
		};
		this.#surfaces.set(surface.positions, buffers);
		return buffers;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#canvas.removeEventListener("webglcontextlost", this.#onContextLost);
		for (const buffers of this.#terrain.values()) this.#deleteBuffers(buffers);
		this.#terrain.clear();
		if (!this.#contextLost) {
			for (const buffers of this.#surfaces.values()) {
				this.#gl.deleteBuffer(buffers.positions);
				this.#gl.deleteBuffer(buffers.indices);
				this.#gl.deleteVertexArray(buffers.vertexArray);
			}
			this.#gl.deleteProgram(this.#program.program);
			this.#gl.deleteProgram(this.#surfaceProgram.program);
		}
		this.#surfaces.clear();
	}

	#createBuffers(terrain: InstalledTerrain): MapTerrainBuffers {
		const gl = this.#gl;
		const mesh = buildMapTerrainMesh(terrain.generation);
		const origin = createLandblockWorldOrigin(terrain.landblockId);
		const vertexArray = gl.createVertexArray();
		if (!vertexArray) {
			throw new Error("Failed to allocate a map terrain vertex array.");
		}
		gl.bindVertexArray(vertexArray);
		const buffers: WebGLBuffer[] = [];
		const attribute = (
			data: Float32Array | Uint8Array,
			location: number,
			size: number,
			integer: boolean,
		): void => {
			const buffer = gl.createBuffer();
			if (!buffer) throw new Error("Failed to allocate a map terrain buffer.");
			buffers.push(buffer);
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
			gl.enableVertexAttribArray(location);
			if (integer) {
				gl.vertexAttribIPointer(location, size, gl.UNSIGNED_BYTE, 0, 0);
			} else {
				gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
			}
		};
		attribute(mesh.positions, MAP_TERRAIN_ATTRIBUTES.localPosition, 3, false);
		attribute(mesh.normals, MAP_TERRAIN_ATTRIBUTES.normal, 3, false);
		attribute(mesh.terrainCodes, MAP_TERRAIN_ATTRIBUTES.terrainCode, 1, true);
		attribute(mesh.roadCoverage, MAP_TERRAIN_ATTRIBUTES.roadCoverage, 1, false);
		attribute(mesh.passable, MAP_TERRAIN_ATTRIBUTES.passable, 1, false);
		gl.bindVertexArray(null);
		return {
			buffers,
			vertexCount: mesh.vertexCount,
			originX: origin.x,
			originZ: origin.z,
			vertexArray,
		};
	}

	#deleteBuffers(buffers: MapTerrainBuffers): void {
		if (this.#contextLost) return;
		for (const buffer of buffers.buffers) this.#gl.deleteBuffer(buffer);
		this.#gl.deleteVertexArray(buffers.vertexArray);
	}
}

/** The horizontal centre of one surface's vertices, which its outline pass expands away from. */
function horizontalCenterOf(positions: Float32Array): {
	readonly centerX: number;
	readonly centerZ: number;
} {
	let minimumX = Number.POSITIVE_INFINITY;
	let maximumX = Number.NEGATIVE_INFINITY;
	let minimumZ = Number.POSITIVE_INFINITY;
	let maximumZ = Number.NEGATIVE_INFINITY;
	for (let index = 0; index + 2 < positions.length; index += 3) {
		const x = positions[index];
		const z = positions[index + 2];
		if (x === undefined || z === undefined) break;
		minimumX = Math.min(minimumX, x);
		maximumX = Math.max(maximumX, x);
		minimumZ = Math.min(minimumZ, z);
		maximumZ = Math.max(maximumZ, z);
	}
	if (!Number.isFinite(minimumX)) return { centerX: 0, centerZ: 0 };
	// The bounds centre rather than the vertex mean: a wall modelled with many more vertices than
	// the floor beside it would drag a mean away from the middle of the shape it belongs to.
	return {
		centerX: (minimumX + maximumX) / 2,
		centerZ: (minimumZ + maximumZ) / 2,
	};
}

import type { ParticleMeshPresentations } from "../../assets/decode-particle-mesh-record";
import type { DecodedParticleMesh } from "../../assets/decode-particle-mesh-record";
import type { DatAssetId } from "../game-types";
import { createTexture2DUpload } from "../textures/texture-manager";
import { resolveObjectMaterialRanges } from "../commit/object-material-ranges";
import type { AssetTextureFact, AssetTextureKey } from "../textures/types";
import type { TexturePreparer } from "../textures/texture-preparer";
import type {
	GeometryResourceKey,
	Texture2DResourceKey,
} from "./resource-manager";
import type { WebGL2ResourceManager } from "./webgl2-resource-manager";
import type { ParticleDrawGeometry } from "./webgl2-particle-pass";
import { PARTICLE_ORIENTATION } from "./webgl2-particle-program";

/**
 * Renderer-owned residency for particle meshes, keyed by `hw_gfxobj_id`.
 *
 * Mirrors the sky pass's model — upload once, resolve at draw time — because both draw standalone
 * objects that are not landblock residents. Kept out of `WebGL2ParticlePass` so that pass stays
 * testable without a resource manager and knows only how to draw.
 *
 * A particle mesh resolves to **one** draw geometry rather than a range list: a `CreateParticle`
 * names a single mesh, and every particle in a cohort shares it, so a multi-range mesh would mean
 * splitting a cohort mid-draw. The first material range wins and the rest are reported.
 */
/**
 * Reference axis for an axis-locked particle billboard, in **render** axes.
 *
 * Degrade modes 3, 4 and 5 lock about AC's x, y and z, but a census of every shipped
 * `GfxObjDegradeInfo` finds only mode 5 — AC's z, which is up — so a single constant is lossless
 * here: 3,852 authored, 251 viewer-facing, 28 axis-locked, all of them mode 5.
 *
 * AC's up is `(0, 0, 1)`, and writing that literally is the bug this constant exists to prevent:
 * in render axes it is a *horizontal* vector, which sends the sprite's own up sideways and rolls
 * the whole basis as the camera pitches. Converted, AC's up is `(0, 1, 0)`.
 */
const AXIS_LOCKED_REFERENCE: readonly [number, number, number] = [0, 1, 0];

export class ParticleMeshResidency {
	readonly #resources: WebGL2ResourceManager;
	/** Resource keys, resolved to live bindings only in {@link resolve}. */
	readonly #meshes = new Map<DatAssetId, ResidentParticleMesh>();
	readonly #geometries: GeometryResourceKey[] = [];
	readonly #textures = new Map<AssetTextureKey, Texture2DResourceKey>();
	#multiRangeMeshCount = 0;

	constructor(resources: WebGL2ResourceManager) {
		this.#resources = resources;
	}

	/** Upload one decoded batch, skipping meshes already resident. */
	async install(
		batch: ParticleMeshPresentations,
		preparer: TexturePreparer,
	): Promise<void> {
		const facts = new Map<AssetTextureKey, AssetTextureFact>();
		const pending: Array<[DatAssetId, DecodedParticleMesh]> = [];
		for (const [hwGfxObjId, decoded] of batch.presentations) {
			if (this.#meshes.has(hwGfxObjId)) continue;
			pending.push([hwGfxObjId, decoded]);
		}
		if (pending.length === 0) return;
		const resolved = pending.map(
			([hwGfxObjId, decoded]) =>
				[hwGfxObjId, this.#resolveMesh(hwGfxObjId, decoded, facts)] as const,
		);
		await Promise.all(
			[...facts.values()].map(async (fact) => {
				const prepared = await preparer.prepare(fact);
				if (!("pixels" in prepared)) {
					throw new Error(
						`Particle texture ${fact.key} prepared as an array source; particle meshes are standalone.`,
					);
				}
				this.#textures.set(
					fact.key,
					this.#resources.createTexture2D(createTexture2DUpload(prepared)),
				);
			}),
		);
		for (const [hwGfxObjId, mesh] of resolved) {
			if (mesh !== null) this.#meshes.set(hwGfxObjId, mesh);
		}
	}

	/** Resolve a resident mesh for the draw pass; `null` never triggers an upload. */
	resolve(hwGfxObjId: DatAssetId): ParticleDrawGeometry | null {
		const mesh = this.#meshes.get(hwGfxObjId.toLowerCase() as DatAssetId);
		if (mesh === undefined) return null;
		const base = this.#textures.get(mesh.base);
		// A mesh whose texture upload failed is not drawable; reporting null keeps it counted as an
		// unresolved cohort rather than drawn untextured.
		if (base === undefined) return null;
		const palette =
			mesh.palette === null ? null : (this.#textures.get(mesh.palette) ?? null);
		const geometry = this.#resources.getGeometry(mesh.geometry);
		return {
			alphaTest: mesh.alphaTest,
			baseTexture: this.#resources.getTexture2D(base).texture,
			indexCount: mesh.indexCount,
			indexOffsetBytes: mesh.indexOffsetBytes,
			lockedAxis: mesh.lockedAxis,
			materialKind: mesh.materialKind,
			orientation: mesh.orientation,
			rawSurfaceFlags: mesh.rawSurfaceFlags,
			paletteTexture:
				palette === null ? null : this.#resources.getTexture2D(palette).texture,
			vertexArray: geometry.vertexArray,
		};
	}

	getDiagnostics() {
		return {
			multiRangeMeshCount: this.#multiRangeMeshCount,
			residentMeshCount: this.#meshes.size,
		};
	}

	destroy(): void {
		for (const geometry of this.#geometries)
			this.#resources.releaseResource(geometry);
		for (const texture of this.#textures.values())
			this.#resources.releaseResource(texture);
		this.#geometries.length = 0;
		this.#textures.clear();
		this.#meshes.clear();
	}

	#resolveMesh(
		hwGfxObjId: DatAssetId,
		decoded: DecodedParticleMesh,
		facts: Map<AssetTextureKey, AssetTextureFact>,
	): ResidentParticleMesh | null {
		const part = decoded.presentation.presentation.parts[0];
		if (part === undefined) return null;
		const label = `Particle mesh ${hwGfxObjId}`;
		const geometry = this.#resources.createGeometry({
			bakedLight: null,
			indices: part.geometry.indices,
			kind: "object",
			normals: part.geometry.normals,
			positions: part.geometry.positions,
			textureCoordinates: part.geometry.textureCoordinates,
		});
		this.#geometries.push(geometry);
		const ranges = resolveObjectMaterialRanges(part, label, facts);
		const range = ranges[0];
		if (range === undefined) return null;
		// Every particle in a cohort shares one mesh, so a mesh spanning several material ranges
		// would have to split the cohort mid-draw. Counted rather than silently truncated.
		if (ranges.length > 1) this.#multiRangeMeshCount += 1;
		const base = range.material.textures.base;
		if (base === null) {
			throw new Error(`${label} resolves a material with no base texture.`);
		}
		return {
			alphaTest: range.ordering === "alpha-test" ? 0.5 : 0,
			base,
			geometry,
			indexCount: range.indexCount,
			indexOffsetBytes: range.indexStart * Uint32Array.BYTES_PER_ELEMENT,
			lockedAxis: AXIS_LOCKED_REFERENCE,
			materialKind: 0,
			orientation:
				decoded.orientation === "viewer-facing"
					? PARTICLE_ORIENTATION.viewerFacing
					: decoded.orientation === "axis-locked"
						? PARTICLE_ORIENTATION.axisLocked
						: PARTICLE_ORIENTATION.authored,
			palette: range.material.textures.palette,
			rawSurfaceFlags: range.material.source.rawSurfaceFlags,
		};
	}
}

/** One resident mesh, held as resource keys so residency never caches stale GL handles. */
interface ResidentParticleMesh {
	readonly geometry: GeometryResourceKey;
	/** Asset keys, not resource keys: the upload that creates the resource runs after resolution. */
	readonly base: AssetTextureKey;
	readonly palette: AssetTextureKey | null;
	readonly indexCount: number;
	readonly indexOffsetBytes: number;
	readonly materialKind: number;
	readonly alphaTest: number;
	readonly orientation: number;
	readonly lockedAxis: readonly [number, number, number];
	readonly rawSurfaceFlags: number;
}

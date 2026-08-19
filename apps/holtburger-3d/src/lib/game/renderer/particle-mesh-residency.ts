import type { ParticleMeshPresentations } from "../../assets/decode-particle-mesh-record";
import type { DecodedParticleMesh } from "../../assets/decode-particle-mesh-record";
import type { DatAssetId } from "../game-types";
import { createTexture2DUpload } from "../textures/texture-manager";
import { resolveObjectMaterialRanges } from "../commit/object-material-ranges";
import { sourceOpacity } from "./object-rendering-policy";
import { TexturePixelFormat, TextureWrapMode } from "../textures/types";
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
 * names a single mesh, and every particle in a draw range shares it, so a multi-range mesh would
 * mean splitting a range mid-draw. The first material range wins and the rest are reported.
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

/**
 * Shared with the object program so one encoding means one thing across both.
 *
 * The two shaders previously disagreed — the object program reserves 0 for solid colour while the
 * particle program used 0 for a direct texture — which is how a paletted mesh could carry kind 0 and
 * still take the unpaletted branch.
 */
const OBJECT_MATERIAL_KIND = {
	"direct-color": 1,
	index8: 2,
	index16: 3,
} as const;

/** The object program's reserved slot for an untextured surface, shared with the particle program. */
const SOLID_COLOR_MATERIAL_KIND = 0;

/** Opaque white, so the placeholder binding cannot tint anything if it is ever sampled. */
const PLACEHOLDER_TEXEL = new Uint8Array([255, 255, 255, 255]);

export class ParticleMeshResidency {
	readonly #resources: WebGL2ResourceManager;
	/** Resource keys, resolved to live bindings only in {@link resolve}. */
	readonly #meshes = new Map<DatAssetId, ResidentParticleMesh>();
	readonly #geometries: GeometryResourceKey[] = [];
	readonly #textures = new Map<AssetTextureKey, Texture2DResourceKey>();
	#multiRangeMeshCount = 0;
	#droppedMeshCount = 0;
	/**
	 * One opaque white texel bound wherever an untextured mesh leaves a sampler unfed.
	 *
	 * WebGL validates every statically-used sampler against its bound texture whether or not the
	 * branch reading it executes, and the particle pass runs after terrain has left integer
	 * textures on these very units. A solid-colour mesh samples nothing, but it still has to bind
	 * something compatible.
	 */
	#placeholderTexture: Texture2DResourceKey | null = null;

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
		// An untextured mesh has no upload to wait on; it binds the placeholder purely to keep the
		// samplers complete and reads its colour from the uniform instead.
		const base =
			mesh.base === null
				? this.#requirePlaceholderTexture()
				: this.#textures.get(mesh.base);
		// A mesh whose texture upload failed is not drawable; reporting null keeps it counted as an
		// unresolved range rather than drawn untextured.
		if (base === undefined) return null;
		const baseBinding = this.#resources.getTexture2D(base);
		const palette =
			mesh.palette === null ? null : (this.#textures.get(mesh.palette) ?? null);
		const geometry = this.#resources.getGeometry(mesh.geometry);
		return {
			alphaTest: mesh.alphaTest,
			baseMipLevels: baseBinding.mipLevels,
			baseTexture: baseBinding.texture,
			indexCount: mesh.indexCount,
			indexOffsetBytes: mesh.indexOffsetBytes,
			lockedAxis: mesh.lockedAxis,
			materialKind: mesh.materialKind,
			materialColor: mesh.color,
			palettedClipMap: mesh.palettedClipMap,
			orientation: mesh.orientation,
			rawSurfaceFlags: mesh.rawSurfaceFlags,
			paletteTexture:
				palette === null ? null : this.#resources.getTexture2D(palette).texture,
			vertexArray: geometry.vertexArray,
			wrap: mesh.wrap,
		};
	}

	getDiagnostics() {
		return {
			/** Meshes this pass could not host, each already reported on the console. */
			droppedMeshCount: this.#droppedMeshCount,
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

	#requirePlaceholderTexture(): Texture2DResourceKey {
		this.#placeholderTexture ??= this.#resources.createTexture2D({
			data: PLACEHOLDER_TEXEL,
			format: TexturePixelFormat.RGBA8,
			height: 1,
			mipLevels: 1,
			width: 1,
		});
		return this.#placeholderTexture;
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
		// Every particle in a draw range shares one mesh, so a mesh spanning several material
		// ranges would have to split the range mid-draw. Counted rather than silently truncated.
		if (ranges.length > 1) this.#multiRangeMeshCount += 1;
		const base = range.material.textures.base;
		const source = range.material.source;
		// An untextured surface is authored content, not a defect: the rain emitter's mesh
		// `0x01001646` is a solid pale blue-white. Retail renders these by writing the colour into a
		// 1x1 texture and taking the ordinary textured path (`D3DPolyRender`, acclient.c:434074);
		// we carry the colour as a uniform instead, exactly as the object program already does.
		//
		// Retail masks the authored colour's own alpha off and substitutes the surface translucency
		// (`curr_color & 0xFFFFFF | (curr_alpha << 24)`), so the alpha here comes from translucency
		// rather than from the colour's fourth component.
		if (source.kind === "solid-color") {
			const [red, green, blue] = source.color;
			return {
				alphaTest: range.ordering === "alpha-test" ? 0.5 : 0,
				base: null,
				color: [red, green, blue, sourceOpacity(source.translucency)],
				geometry,
				indexCount: range.indexCount,
				indexOffsetBytes: range.indexStart * Uint32Array.BYTES_PER_ELEMENT,
				lockedAxis: AXIS_LOCKED_REFERENCE,
				materialKind: SOLID_COLOR_MATERIAL_KIND,
				palettedClipMap: range.material.palettedClipMap,
				orientation: particleOrientation(decoded.orientation),
				palette: null,
				rawSurfaceFlags: source.rawSurfaceFlags,
				wrap: TextureWrapMode.Clamp,
			};
		}
		if (base === null) {
			// Dropped rather than thrown: this runs inside a batch install, so failing here would
			// take down every mesh staged alongside this one for a defect in a single asset.
			console.error(
				`${label} resolves a textured material with no base texture; mesh dropped.`,
			);
			this.#droppedMeshCount += 1;
			return null;
		}
		return {
			alphaTest: range.ordering === "alpha-test" ? 0.5 : 0,
			base,
			color: null,
			geometry,
			indexCount: range.indexCount,
			indexOffsetBytes: range.indexStart * Uint32Array.BYTES_PER_ELEMENT,
			lockedAxis: AXIS_LOCKED_REFERENCE,
			// Derived, not assumed. Hardcoding this to the direct-texture kind made every paletted
			// particle sample its index texture as colour, so it never reached the palette, produced
			// no alpha, and drew its cutout region as an opaque quad.
			materialKind: OBJECT_MATERIAL_KIND[source.textureEncoding],
			palettedClipMap: range.material.palettedClipMap,
			orientation: particleOrientation(decoded.orientation),
			palette: range.material.textures.palette,
			rawSurfaceFlags: range.material.source.rawSurfaceFlags,
			wrap: range.material.sampler.wrap,
		};
	}
}

function particleOrientation(
	orientation: DecodedParticleMesh["orientation"],
): number {
	return orientation === "viewer-facing"
		? PARTICLE_ORIENTATION.viewerFacing
		: orientation === "axis-locked"
			? PARTICLE_ORIENTATION.axisLocked
			: PARTICLE_ORIENTATION.authored;
}

/** One resident mesh, held as resource keys so residency never caches stale GL handles. */
interface ResidentParticleMesh {
	readonly geometry: GeometryResourceKey;
	/**
	 * Asset keys, not resource keys: the upload that creates the resource runs after resolution.
	 *
	 * Null for an untextured surface, whose colour rides in {@link ResidentParticleMesh.color}.
	 */
	readonly base: AssetTextureKey | null;
	/** Authored colour of an untextured surface, alpha already carrying its translucency. */
	readonly color: readonly [number, number, number, number] | null;
	readonly palette: AssetTextureKey | null;
	readonly indexCount: number;
	readonly indexOffsetBytes: number;
	readonly materialKind: number;
	/** Retail's indexed cutout: palette indices below 8 are fully transparent. */
	readonly palettedClipMap: boolean;
	readonly alphaTest: number;
	readonly orientation: number;
	readonly lockedAxis: readonly [number, number, number];
	readonly rawSurfaceFlags: number;
	readonly wrap: TextureWrapMode;
}

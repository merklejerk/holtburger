import type { ObjectMaterialBinding } from "../commit/artifacts";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import type { StaticDetailRole } from "../resolution/static-detail-role";
import type { TextureAtlasBinding } from "../textures/texture-manager";
import {
	TextureWrapMode,
	type AssetTextureKey,
	type GeneratedTextureKey,
} from "../textures/types";
import type { CompiledObjectDraw } from "./compiled-object-draws";
import { prepareObjectSurface } from "./object-material-preparation";
import {
	objectBlendPolicy,
	type PreparedObjectAtlasBinding,
	type PreparedObjectTextureBinding,
	type PreparedStaticObjectDrawCompatibility,
} from "./object-rendering-policy";
import type { ActiveRegionStaticDetailRenderBinding } from "./render-world";
import type {
	GeometryResourceKey,
	Texture2DResourceKey,
} from "./resource-manager";
import { resolveStaticMaterialDetail } from "./static-detail-binding";
import type { TextureFilteringPolicy } from "./texture-filtering-policy";
import type {
	TextureSamplingClass,
	WebGL2TextureSamplerCatalog,
} from "./webgl2-texture-sampler-catalog";
import type {
	WebGL2GeometryBinding,
	WebGL2ResourceManager,
} from "./webgl2-resource-manager";

/** Device-resolved constants shared by every submission of one immutable object draw unit. */
export type WebGL2PreparedObjectDrawCompatibility =
	PreparedStaticObjectDrawCompatibility<
		WebGL2GeometryBinding,
		WebGLTexture,
		WebGLSampler
	>;

/** Immutable draw facts required before camera- or frame-specific submission exists. */
export interface WebGL2ObjectDrawInput {
	readonly cullFaceOverride:
		ObjectMaterialBinding["polygon"]["cullFace"] | null;
	readonly geometry: GeometryResourceKey;
	readonly indexCount: number;
	readonly indexStart: number;
	readonly material: ObjectMaterialBinding;
	readonly ordering: ObjectMaterialOrdering;
}

/** Context-local lookup capabilities used to compile object material and geometry bindings. */
export interface WebGL2ObjectDrawCompilerDependencies {
	readonly resources: WebGL2ResourceManager;
	readonly samplers: WebGL2TextureSamplerCatalog;
	readonly textureFiltering: () => TextureFilteringPolicy;
	readonly resolveAtlasTexture: (key: AssetTextureKey) => TextureAtlasBinding;
	readonly resolveTexture2D: (
		key: AssetTextureKey | GeneratedTextureKey,
	) => Texture2DResourceKey;
	readonly resolveStaticDetail: (
		role: StaticDetailRole,
	) => ActiveRegionStaticDetailRenderBinding | null;
}

/** Compile object draw constants against exactly one WebGL context's resource namespace. */
export class WebGL2ObjectDrawCompiler {
	readonly #dependencies: WebGL2ObjectDrawCompilerDependencies;

	constructor(dependencies: WebGL2ObjectDrawCompilerDependencies) {
		this.#dependencies = dependencies;
	}

	compile(
		object: WebGL2ObjectDrawInput,
	): CompiledObjectDraw<WebGL2PreparedObjectDrawCompatibility> {
		const geometry = this.#dependencies.resources.getGeometry(object.geometry);
		validateDrawRange(geometry, object.indexStart, object.indexCount);
		const { material } = object;
		const surface = this.prepareSurface(material, object.ordering);
		const detail = resolveStaticMaterialDetail(
			material,
			this.#dependencies.resolveStaticDetail,
		);
		return {
			batchKey: `${object.ordering}\0${object.geometry}\0${object.indexStart}\0${object.indexCount}`,
			blendPolicy: objectBlendPolicy(material.source.rawSurfaceFlags),
			compatibility: {
				...surface,
				cullFace: object.cullFaceOverride ?? material.polygon.cullFace,
				detail:
					detail === null
						? null
						: {
								...this.#prepareTextureBinding(
									this.#dependencies.resolveTexture2D(detail.key),
									"filterable",
								),
								rect: [0, 0, 1, 1],
								tiling: detail.tiling,
							},
				geometry,
				indexCount: object.indexCount,
				indexStart: object.indexStart,
			},
		};
	}

	/** Resolve material texture bindings without compiling geometry or draw-range facts. */
	prepareSurface(
		material: Omit<ObjectMaterialBinding, "polygon">,
		ordering: ObjectMaterialOrdering,
	) {
		return prepareObjectSurface(material, ordering, (key, samplingClass) =>
			this.prepareAtlasBinding(key, samplingClass),
		);
	}

	prepareAtlasBinding(
		key: AssetTextureKey,
		samplingClass: TextureSamplingClass,
	): PreparedObjectAtlasBinding<WebGLTexture, WebGLSampler> {
		const atlas = this.#dependencies.resolveAtlasTexture(key);
		const bounds = atlas.placement.bounds;
		return {
			...this.#prepareTextureBinding(atlas.resource, samplingClass),
			rect: [
				bounds.min.x,
				bounds.min.y,
				bounds.max.x - bounds.min.x,
				bounds.max.y - bounds.min.y,
			],
		};
	}

	#prepareTextureBinding(
		resource: Texture2DResourceKey,
		samplingClass: TextureSamplingClass,
	): PreparedObjectTextureBinding<WebGLTexture, WebGLSampler> {
		const binding = this.#dependencies.resources.getTexture2D(resource);
		return {
			sampler: this.#dependencies.samplers.getSampler({
				mipLevels: binding.mipLevels,
				policy: this.#dependencies.textureFiltering(),
				samplingClass,
				wrap: TextureWrapMode.Clamp,
			}),
			texture: binding.texture,
		};
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

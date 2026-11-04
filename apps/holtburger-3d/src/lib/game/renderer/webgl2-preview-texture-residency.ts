import { AABB2, Vec2 } from "../math/types";
import {
	createTexture2DUpload,
	type TextureAtlasBinding,
} from "../textures/texture-manager";
import type { TexturePreparer } from "../textures/texture-preparer";
import {
	TextureWrapMode,
	isPackedObjectTexturePurpose,
	type AssetTextureFact,
	type AssetTextureKey,
} from "../textures/types";
import type { Texture2DResourceKey } from "./resource-manager";
import type { WebGL2ResourceManager } from "./webgl2-resource-manager";

/** Context-local standalone uploads for the bounded texture set of one preview visual. */
export class WebGL2PreviewTextureResidency {
	readonly #resources: WebGL2ResourceManager;
	readonly #bindings = new Map<AssetTextureKey, TextureAtlasBinding>();

	constructor(resources: WebGL2ResourceManager) {
		this.#resources = resources;
	}

	/** Prepare first, then publish the complete set atomically into this residency. */
	async install(
		facts: readonly AssetTextureFact[],
		preparer: TexturePreparer,
	): Promise<void> {
		const distinct = new Map(facts.map((fact) => [fact.key, fact]));
		const additions: Array<
			readonly [
				AssetTextureKey,
				Texture2DResourceKey,
				{ readonly width: number; readonly height: number },
			]
		> = [];
		try {
			for (const [key, fact] of distinct) {
				if (this.#bindings.has(key)) continue;
				if (!isPackedObjectTexturePurpose(fact.purpose))
					throw new Error(
						`Preview object texture ${key} has unsupported purpose ${fact.purpose}.`,
					);
				const source = await preparer.prepare(fact);
				if (!("pixels" in source))
					throw new Error(
						`Preview object texture ${key} prepared as an array.`,
					);
				additions.push([
					key,
					this.#resources.createTexture2D(createTexture2DUpload(source)),
					{ height: source.height, width: source.width },
				]);
			}
		} catch (cause) {
			for (const [, resource] of additions)
				this.#resources.releaseResource(resource);
			throw cause;
		}
		for (const [key, resource, extent] of additions) {
			this.#bindings.set(key, {
				placement: {
					// The object material table stores atlas rectangles in texels, including for
					// standalone resources whose rectangle covers the whole texture.
					bounds: new AABB2(Vec2.zero(), new Vec2(extent.width, extent.height)),
					// Standalone textures have no packed edge to isolate; shader UV policy still
					// supplies the authored clamp/repeat behavior.
					preparation: { gutterPixels: 0, wrap: TextureWrapMode.Clamp },
				},
				resource,
			});
		}
	}

	resolveAtlasTexture(key: AssetTextureKey): TextureAtlasBinding {
		const binding = this.#bindings.get(key);
		if (!binding)
			throw new Error(
				`Preview texture ${key} is not resident in this context.`,
			);
		return binding;
	}

	resolveTexture2D(key: AssetTextureKey): Texture2DResourceKey {
		return this.resolveAtlasTexture(key).resource;
	}

	destroy(): void {
		for (const binding of this.#bindings.values())
			this.#resources.releaseResource(binding.resource);
		this.#bindings.clear();
	}
}

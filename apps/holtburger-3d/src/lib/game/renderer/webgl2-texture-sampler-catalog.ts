import { TextureWrapMode } from "../textures/types";
import {
	TEXTURE_FILTERING_POLICIES,
	resolveTextureFilteringPolicy,
	textureFilteringAnisotropy,
	type TextureFilteringCapabilities,
	type TextureFilteringPolicy,
} from "./texture-filtering-policy";
import type { WebGL2TextureFilteringSupport } from "./webgl2-texture-filtering-support";

/** Semantic sampling classes that must remain distinct before backend state resolution. */
export type TextureSamplingClass = "exact" | "filterable";

/** Complete facts required to choose one draw-time WebGL sampler. */
export interface TextureSamplerRequest {
	readonly mipLevels: number;
	readonly policy: TextureFilteringPolicy;
	readonly samplingClass: TextureSamplingClass;
	readonly wrap: TextureWrapMode;
}

/** Renderer-neutral description used to prove sampler selection before WebGL construction. */
export interface TextureSamplerDescription {
	readonly anisotropy: 1 | 2 | 4 | 8;
	readonly magnification: "nearest" | "linear";
	readonly minification: "nearest" | "linear" | "linear-mipmap-linear";
	readonly wrap: TextureWrapMode;
}

/** Resolve all semantic, resource, and capability facts into one backend sampler description. */
export function resolveTextureSamplerDescription(
	request: TextureSamplerRequest,
	capabilities: TextureFilteringCapabilities,
): TextureSamplerDescription {
	if (!Number.isInteger(request.mipLevels) || request.mipLevels <= 0) {
		throw new Error(
			`Texture sampler mip level count must be a positive integer; got ${request.mipLevels}.`,
		);
	}
	if (request.samplingClass === "exact") {
		return {
			anisotropy: 1,
			magnification: "nearest",
			minification: "nearest",
			wrap: request.wrap,
		};
	}
	const policy = resolveTextureFilteringPolicy(request.policy, capabilities);
	if (policy === "nearest") {
		return {
			anisotropy: 1,
			magnification: "nearest",
			minification: "nearest",
			wrap: request.wrap,
		};
	}
	return {
		anisotropy: textureFilteringAnisotropy(policy),
		magnification: "linear",
		minification: request.mipLevels > 1 ? "linear-mipmap-linear" : "linear",
		wrap: request.wrap,
	};
}

/** Context-owned immutable WebGL sampler objects shared by every game-texture binding. */
export class WebGL2TextureSamplerCatalog {
	readonly #gl: WebGL2RenderingContext;
	readonly #support: WebGL2TextureFilteringSupport;
	readonly #samplers = new Map<string, WebGLSampler>();
	/** Finite semantic-request table avoiding description and string-key work at frame time. */
	readonly #samplersByRequest: Array<WebGLSampler | undefined> = [];
	#destroyed = false;

	constructor(
		gl: WebGL2RenderingContext,
		support: WebGL2TextureFilteringSupport,
	) {
		this.#gl = gl;
		this.#support = support;
		try {
			for (const description of admittedSamplerDescriptions(
				support.capabilities,
			)) {
				this.#samplers.set(
					samplerDescriptionKey(description),
					this.#createSampler(description),
				);
			}
			for (const request of admittedSamplerRequests()) {
				const description = resolveTextureSamplerDescription(
					request,
					support.capabilities,
				);
				const sampler = this.#samplers.get(samplerDescriptionKey(description));
				if (!sampler) {
					throw new Error(
						"Admitted sampler request has no constructed sampler.",
					);
				}
				this.#samplersByRequest[samplerRequestIndex(request)] = sampler;
			}
		} catch (cause) {
			this.destroy();
			throw cause;
		}
	}

	/** Return the prebuilt sampler selected by one complete draw request. */
	getSampler(request: TextureSamplerRequest): WebGLSampler {
		if (this.#destroyed) {
			throw new Error("Texture sampler catalog is destroyed.");
		}
		const sampler = this.#samplersByRequest[samplerRequestIndex(request)];
		if (!sampler) {
			throw new Error("Texture sampler catalog lacks an admitted request.");
		}
		return sampler;
	}

	/** Bind the selected immutable sampler to one texture unit. */
	bind(unit: number, request: TextureSamplerRequest): void {
		this.#gl.bindSampler(unit, this.getSampler(request));
	}

	/** Release every context-owned sampler exactly once. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		for (const sampler of this.#samplers.values()) {
			this.#gl.deleteSampler(sampler);
		}
		this.#samplers.clear();
		this.#samplersByRequest.length = 0;
	}

	#createSampler(description: TextureSamplerDescription): WebGLSampler {
		const gl = this.#gl;
		const sampler = gl.createSampler();
		if (!sampler) throw new Error("Failed to allocate texture sampler.");
		try {
			gl.samplerParameteri(
				sampler,
				gl.TEXTURE_MIN_FILTER,
				minification(gl, description.minification),
			);
			gl.samplerParameteri(
				sampler,
				gl.TEXTURE_MAG_FILTER,
				description.magnification === "nearest" ? gl.NEAREST : gl.LINEAR,
			);
			const wrap =
				description.wrap === TextureWrapMode.Repeat
					? gl.REPEAT
					: gl.CLAMP_TO_EDGE;
			gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, wrap);
			gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, wrap);
			if (description.anisotropy > 1) {
				const extension = this.#support.anisotropyExtension;
				if (!extension) {
					throw new Error(
						"An anisotropic sampler was admitted without extension support.",
					);
				}
				gl.samplerParameterf(
					sampler,
					extension.TEXTURE_MAX_ANISOTROPY_EXT,
					description.anisotropy,
				);
			}
			return sampler;
		} catch (cause) {
			gl.deleteSampler(sampler);
			throw cause;
		}
	}
}

function admittedSamplerDescriptions(
	capabilities: TextureFilteringCapabilities,
): readonly TextureSamplerDescription[] {
	const descriptions = new Map<string, TextureSamplerDescription>();
	for (const request of admittedSamplerRequests()) {
		const description = resolveTextureSamplerDescription(request, capabilities);
		descriptions.set(samplerDescriptionKey(description), description);
	}
	return [...descriptions.values()];
}

/** Enumerate the closed request space once while constructing a context-owned catalog. */
function admittedSamplerRequests(): readonly TextureSamplerRequest[] {
	return [TextureWrapMode.Clamp, TextureWrapMode.Repeat].flatMap((wrap) =>
		TEXTURE_FILTERING_POLICIES.flatMap((policy) =>
			(["exact", "filterable"] as const).flatMap((samplingClass) => [
				{ mipLevels: 1, policy, samplingClass, wrap },
				{ mipLevels: 2, policy, samplingClass, wrap },
			]),
		),
	);
}

/** Encode the closed semantic request axes into one dense array position. */
function samplerRequestIndex(request: TextureSamplerRequest): number {
	if (!Number.isInteger(request.mipLevels) || request.mipLevels <= 0) {
		throw new Error(
			`Texture sampler mip level count must be a positive integer; got ${request.mipLevels}.`,
		);
	}
	const policy = TEXTURE_FILTERING_POLICIES.indexOf(request.policy);
	if (policy < 0) {
		throw new Error(`Unknown texture filtering policy ${request.policy}.`);
	}
	const samplingClass = request.samplingClass === "exact" ? 0 : 1;
	const mipmapped = request.mipLevels > 1 ? 1 : 0;
	const wrap = request.wrap === TextureWrapMode.Clamp ? 0 : 1;
	return ((policy * 2 + samplingClass) * 2 + mipmapped) * 2 + wrap;
}

function samplerDescriptionKey(description: TextureSamplerDescription): string {
	return [
		description.minification,
		description.magnification,
		`${description.anisotropy}x`,
		description.wrap,
	].join(":");
}

function minification(
	gl: WebGL2RenderingContext,
	value: TextureSamplerDescription["minification"],
): GLenum {
	switch (value) {
		case "nearest":
			return gl.NEAREST;
		case "linear":
			return gl.LINEAR;
		case "linear-mipmap-linear":
			return gl.LINEAR_MIPMAP_LINEAR;
	}
}

import {
	createTextureFilteringCapabilities,
	type TextureFilteringCapabilities,
} from "./texture-filtering-policy";

/** WebGL extension contract retained privately for renderer sampler construction. */
interface WebGL2AnisotropyExtension {
	readonly MAX_TEXTURE_MAX_ANISOTROPY_EXT: GLenum;
	readonly TEXTURE_MAX_ANISOTROPY_EXT: GLenum;
}

/** One device probe result shared by public capability and backend sampler consumers. */
export interface WebGL2TextureFilteringSupport {
	readonly anisotropyExtension: WebGL2AnisotropyExtension | null;
	readonly capabilities: TextureFilteringCapabilities;
}

/** Probe anisotropic filtering once for the lifetime of one WebGL device. */
export function probeWebGL2TextureFilteringSupport(
	gl: WebGL2RenderingContext,
): WebGL2TextureFilteringSupport {
	const anisotropyExtension =
		extension(gl, "EXT_texture_filter_anisotropic") ??
		extension(gl, "WEBKIT_EXT_texture_filter_anisotropic") ??
		extension(gl, "MOZ_EXT_texture_filter_anisotropic");
	const maximumAnisotropy =
		anisotropyExtension === null
			? 1
			: (gl.getParameter(
					anisotropyExtension.MAX_TEXTURE_MAX_ANISOTROPY_EXT,
				) as number);
	return {
		anisotropyExtension,
		capabilities: createTextureFilteringCapabilities(maximumAnisotropy),
	};
}

function extension(
	gl: WebGL2RenderingContext,
	name: string,
): WebGL2AnisotropyExtension | null {
	return gl.getExtension(name) as WebGL2AnisotropyExtension | null;
}

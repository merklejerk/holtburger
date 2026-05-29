import type { Device } from "@luma.gl/core";
import { GL, WebGLDevice } from "@luma.gl/webgl";

import type { MaterialTextureCapabilities } from "./render-surface-texture-data";

export function detectLumaMaterialTextureCapabilities(
	device: Device,
): MaterialTextureCapabilities {
	if (!(device instanceof WebGLDevice)) {
		return {
			supportsS3tc: device.features.has("texture-compression-bc"),
			supportsS3tcSrgb: false,
			supportsPackedRgb565: false,
			supportsPackedRgba4444: true,
			maxAnisotropy: 1,
		};
	}

	const extensions = device.getExtension("WEBGL_compressed_texture_s3tc");
	const srgbExtensions = device.getExtension(
		"WEBGL_compressed_texture_s3tc_srgb",
	);
	const anisotropyExtensions = device.getExtension(
		"EXT_texture_filter_anisotropic",
	);
	return {
		supportsS3tc: extensions.WEBGL_compressed_texture_s3tc !== null,
		supportsS3tcSrgb:
			srgbExtensions.WEBGL_compressed_texture_s3tc_srgb !== null,
		supportsPackedRgb565: false,
		supportsPackedRgba4444: true,
		maxAnisotropy:
			anisotropyExtensions.EXT_texture_filter_anisotropic === null
				? 1
				: Number(device.handle.getParameter(GL.MAX_TEXTURE_MAX_ANISOTROPY_EXT)),
	};
}

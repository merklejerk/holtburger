import {
	TexturePixelFormat,
	texturePurposePolicy,
} from "../game/textures/types";
import type {
	PreparedTextureSurface,
	TexturePreparationServiceRequest,
	TexturePreparationServiceResponse,
} from "../game/textures/texture-preparer";

const HEADER_LENGTH = 12;
const MAGIC = "HBTP";

interface PixelSection {
	readonly name: "pixels";
	readonly scalarType: "u8";
	readonly elementCount: number;
	readonly byteOffset: number;
	readonly byteLength: number;
}

interface TexturePixelsManifest {
	readonly transport: "holtburger-texture-pixels";
	readonly byteOrder: "little-endian";
	readonly sectionByteOffsetBase: "section-data";
	readonly sourceAssetId: string;
	readonly purpose: string;
	readonly surface: {
		readonly sourceRecordId: string;
		readonly format: "rgba8" | "r8" | "rg8";
		readonly width: number;
		readonly height: number;
	};
	readonly sections: readonly PixelSection[];
}

/** Decode and validate one normalized texture-pixel host response. */
export function decodeTexturePixels(
	response: Uint8Array,
	request: TexturePreparationServiceRequest,
): TexturePreparationServiceResponse {
	if (response.byteLength < HEADER_LENGTH) {
		throw new Error(
			"Texture-pixel response is shorter than its binary header.",
		);
	}
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	const magic = new TextDecoder().decode(response.subarray(0, 4));
	if (magic !== MAGIC)
		throw new Error(`Unexpected texture-pixel magic ${magic}.`);
	const manifestLength = view.getUint32(4, true);
	const totalLength = view.getUint32(8, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`Texture-pixel length is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	const sectionDataOffset = HEADER_LENGTH + manifestLength;
	if (sectionDataOffset > response.byteLength) {
		throw new Error("Texture-pixel manifest exceeds the binary response.");
	}
	const manifest = parseManifest(
		new TextDecoder().decode(
			response.subarray(HEADER_LENGTH, sectionDataOffset),
		),
	);
	if (manifest.sourceAssetId !== request.sourceAssetId) {
		throw new Error(
			`Texture pixels returned ${manifest.sourceAssetId} for ${request.sourceAssetId}.`,
		);
	}
	if (manifest.purpose !== request.purpose) {
		throw new Error(
			`Texture pixels returned purpose ${manifest.purpose} for ${request.purpose}.`,
		);
	}
	const format = texturePixelFormat(manifest.surface.format);
	if (format !== texturePurposePolicy(request.purpose).format) {
		throw new Error(
			`Texture pixels returned ${format} for ${request.purpose}, which requires ${texturePurposePolicy(request.purpose).format}.`,
		);
	}
	if (
		!Number.isInteger(manifest.surface.width) ||
		manifest.surface.width <= 0 ||
		!Number.isInteger(manifest.surface.height) ||
		manifest.surface.height <= 0
	) {
		throw new Error(
			"Texture-pixel response declares invalid surface dimensions.",
		);
	}
	const section = requirePixelsSection(manifest.sections);
	const expectedLength =
		manifest.surface.width * manifest.surface.height * bytesPerPixel(format);
	if (
		section.elementCount !== expectedLength ||
		section.byteLength !== expectedLength
	) {
		throw new Error(
			"Texture-pixel response declares an incompatible pixel byte length.",
		);
	}
	const start = sectionDataOffset + section.byteOffset;
	const end = start + section.byteLength;
	if (
		section.byteOffset !== 0 ||
		start < sectionDataOffset ||
		end > response.byteLength
	) {
		throw new Error(
			"Texture-pixel response declares an invalid pixel section.",
		);
	}
	const surface: PreparedTextureSurface = {
		format,
		height: manifest.surface.height,
		pixels: Uint8Array.from(response.subarray(start, end)),
		sourceAssetId: request.sourceAssetId,
		width: manifest.surface.width,
	};
	return {
		kind: request.kind,
		purpose: request.purpose,
		surface,
	};
}

function parseManifest(serialized: string): TexturePixelsManifest {
	let manifest: unknown;
	try {
		manifest = JSON.parse(serialized);
	} catch {
		throw new Error("Texture-pixel manifest is not valid JSON.");
	}
	if (
		!isRecord(manifest) ||
		manifest.transport !== "holtburger-texture-pixels" ||
		manifest.byteOrder !== "little-endian" ||
		manifest.sectionByteOffsetBase !== "section-data" ||
		typeof manifest.sourceAssetId !== "string" ||
		typeof manifest.purpose !== "string" ||
		!isRecord(manifest.surface) ||
		!Array.isArray(manifest.sections)
	) {
		throw new Error("Texture-pixel manifest has an incompatible contract.");
	}
	return manifest as unknown as TexturePixelsManifest;
}

function requirePixelsSection(sections: readonly PixelSection[]): PixelSection {
	if (sections.length !== 1) {
		throw new Error(
			"Texture-pixel response must contain exactly one pixel section.",
		);
	}
	const [section] = sections;
	if (
		section?.name !== "pixels" ||
		section.scalarType !== "u8" ||
		!Number.isInteger(section.elementCount) ||
		!Number.isInteger(section.byteOffset) ||
		!Number.isInteger(section.byteLength)
	) {
		throw new Error("Texture-pixel response pixel section is invalid.");
	}
	return section;
}

function texturePixelFormat(
	format: "rgba8" | "r8" | "rg8",
): TexturePixelFormat {
	if (format === "rgba8") return TexturePixelFormat.RGBA8;
	if (format === "r8") return TexturePixelFormat.R8;
	if (format === "rg8") return TexturePixelFormat.RG8;
	throw new Error(`Unsupported texture-pixel format ${format}.`);
}

function bytesPerPixel(format: TexturePixelFormat): number {
	if (format === TexturePixelFormat.RGBA8) return 4;
	if (format === TexturePixelFormat.R8) return 1;
	if (format === TexturePixelFormat.RG8) return 2;
	throw new Error(
		`Texture-pixel format ${format} has no host byte representation.`,
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

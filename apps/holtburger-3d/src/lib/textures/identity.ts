import type { VisualTextureDomain } from "../static/contracts";
import type {
	TexturePageSampleClass,
	TextureWrapMode,
} from "./sampling-policy";

/** Canonical texture-pool identity. Ownership, bindings, and renderer pages are forbidden here. */
export type TextureKey = string & { readonly __textureKey: unique symbol };

/** Material-consumer binding identity. This may be scoped because it is not dedupe identity. */
export type TextureBindingId = string & {
	readonly __textureBindingId: unique symbol;
};

/** Residency/lifetime owner identity. Landblock and resource scope belongs here, not in TextureKey. */
export type TextureOwnerId = string & {
	readonly __textureOwnerId: unique symbol;
};

/** Physical atlas-page compatibility class. This is not canonical texture identity. */
export type TexturePageClass = string & {
	readonly __texturePageClass: unique symbol;
};

/** Source portion of a TextureKey before shader interpretation facts are applied. */
export type MaterialTextureSourceKey = string & {
	readonly __materialTextureSourceKey: unique symbol;
};

/** Canonical recipe id for final palette replacement ranges. */
export type PaletteReplacementRecipeKey = string & {
	readonly __paletteReplacementRecipeKey: unique symbol;
};

/** Cheap range fingerprint used in palette replacement recipe identity. */
export interface PaletteReplacementFingerprint {
	/** Palette entry offset where this already-normalized replacement range starts. */
	readonly offset: number;
	/** Number of palette entries in this already-normalized replacement range. */
	readonly count: number;
	/** FNV-1a 64-bit hash of RGBA replacement bytes, encoded as fixed-width lowercase hex. */
	readonly hash64: string;
}

export interface PaletteReplacementRangeInput {
	/** Palette entry offset where the replacement range starts. */
	readonly offset: number;
	/** Number of RGBA palette entries represented by `rgbaBytes`. */
	readonly count: number;
	/** Replacement color bytes in RGBA order. Must contain exactly `count * 4` bytes. */
	readonly rgbaBytes: Uint8Array | readonly number[];
}

export type MaterialTextureSourceKeyInput =
	| {
			/** Prepared render-surface texture bytes. */
			readonly kind: "render-surface";
			readonly renderSurfaceId: number | string;
			readonly usage: TextureSourceUsage;
	  }
	| {
			/** Prepared palette texture bytes after base palette plus replacement ranges. */
			readonly kind: "palette";
			readonly basePaletteId: number | string;
			readonly domain: "index8" | "index16";
			readonly replacementRecipeKey: PaletteReplacementRecipeKey;
			readonly usage: "palette-rgba";
	  }
	| {
			/** Runtime-authored source whose bytes are identified outside static DAT ids. */
			readonly kind: "runtime";
			readonly sourceId: string;
			readonly usage: TextureSourceUsage;
	  };

export type TextureSourceUsage =
	| "rgba-color"
	| "rgba-detail"
	| "rgba-mask"
	| "rgba-raw"
	| "index8"
	| "index16"
	| "palette-rgba";

export interface TextureKeyInput {
	/** Canonical source identity that excludes owner/binding/sampler facts. */
	readonly sourceKey: MaterialTextureSourceKey;
	/** Prepared byte/layout interpretation used by shader and upload code. */
	readonly outputFormat: "rgba8" | "index8" | "index16";
	/** Shader sample class when it changes texture interpretation. */
	readonly sampleClass: TexturePageSampleClass;
}

export interface TextureBindingIdInput {
	/** Caller-owned material or draw-resource id. */
	readonly resourceId: string;
	/** Material slot inside the caller-owned resource. */
	readonly slot: number | string;
	/** Binding role in the shader/material payload. */
	readonly role: "base-color" | "detail" | "index" | "palette" | string;
	/** Material wrap mode when the binding's sampling semantics depend on it. */
	readonly wrapMode?: TextureWrapMode;
	/** Material variant discriminator when one slot emits multiple bindings. */
	readonly variantSignature?: string;
}

export type TextureOwnerIdInput =
	| {
			/** Static or generated layer owner used for streaming residency. */
			readonly kind: "layer";
			readonly layerOwnerId: string;
	  }
	| {
			/** Reusable visual resource owner used for static object residency. */
			readonly kind: "visual-resource";
			readonly visualResourceId: string;
	  }
	| {
			/** Runtime entity/resource owner used for dynamic residency. */
			readonly kind: "dynamic-resource";
			readonly dynamicResourceId: string;
	  };

export interface TexturePageClassInput {
	/** Renderer texture domain that owns compatible atlas pages. */
	readonly domain: VisualTextureDomain;
	/** Shader/page purpose that must remain compatible inside the page class. */
	readonly purpose: string;
	/** Shader sample class for page packing/upload compatibility. */
	readonly sampleClass: TexturePageSampleClass;
	/** Physical page pixel format. */
	readonly format: "rgba8" | "index8" | "index16";
	/** Gutter policy in pixels. */
	readonly gutterPixels: number;
	/** Physical wrap only when the renderer cannot virtualize material wrap in shader. */
	readonly physicalWrapMode?: TextureWrapMode;
}

export interface TextureRequest {
	/** Canonical texture-pool entry requested by this material consumer. */
	readonly textureKey: TextureKey;
	/** Material binding that will consume the canonical texture. */
	readonly bindingId: TextureBindingId;
	/** Residency owners that keep this texture alive. */
	readonly ownerIds: readonly TextureOwnerId[];
	/** Physical atlas compatibility class for placement. */
	readonly pageClass: TexturePageClass;
}

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

export function createPaletteReplacementFingerprint(
	input: PaletteReplacementRangeInput,
): PaletteReplacementFingerprint {
	assertSafeNonNegativeInteger(input.offset, "palette replacement offset");
	assertSafePositiveInteger(input.count, "palette replacement count");

	const bytes = normalizeByteArray(
		input.rgbaBytes,
		"palette replacement bytes",
	);
	const expectedByteLength = input.count * 4;
	if (bytes.length !== expectedByteLength) {
		throw new Error(
			`Palette replacement byte length must be count * 4 (${expectedByteLength}), got ${bytes.length}.`,
		);
	}

	return {
		count: input.count,
		hash64: hashBytesFnv1a64(bytes),
		offset: input.offset,
	};
}

export function createPaletteReplacementRecipeKey(
	replacements: readonly PaletteReplacementFingerprint[],
): PaletteReplacementRecipeKey {
	if (replacements.length === 0) {
		return "repl=none" as PaletteReplacementRecipeKey;
	}

	const normalized = [...replacements].sort(
		comparePaletteReplacementFingerprints,
	);
	return `repl=${normalized
		.map((replacement) => {
			assertSafeNonNegativeInteger(
				replacement.offset,
				"palette replacement fingerprint offset",
			);
			assertSafePositiveInteger(
				replacement.count,
				"palette replacement fingerprint count",
			);
			assertHash64(replacement.hash64);
			return `${replacement.offset}+${replacement.count}@${replacement.hash64}`;
		})
		.join(",")}` as PaletteReplacementRecipeKey;
}

export function createMaterialTextureSourceKey(
	input: MaterialTextureSourceKeyInput,
): MaterialTextureSourceKey {
	switch (input.kind) {
		case "render-surface":
			return joinIdentityParts([
				"src=render-surface",
				`id=${formatIdentityComponent(input.renderSurfaceId)}`,
				`usage=${input.usage}`,
			]) as MaterialTextureSourceKey;
		case "palette":
			return joinIdentityParts([
				"src=palette",
				`base=${formatIdentityComponent(input.basePaletteId)}`,
				`domain=${input.domain}`,
				`recipe=${input.replacementRecipeKey}`,
				`usage=${input.usage}`,
			]) as MaterialTextureSourceKey;
		case "runtime":
			assertNonEmptyString(input.sourceId, "runtime texture source id");
			return joinIdentityParts([
				"src=runtime",
				`id=${formatIdentityComponent(input.sourceId)}`,
				`usage=${input.usage}`,
			]) as MaterialTextureSourceKey;
	}
}

export function createTextureKey(input: TextureKeyInput): TextureKey {
	return joinIdentityParts([
		"texture",
		`source=${input.sourceKey}`,
		`format=${input.outputFormat}`,
		`sample=${input.sampleClass}`,
	]) as TextureKey;
}

export function createTextureBindingId(
	input: TextureBindingIdInput,
): TextureBindingId {
	assertNonEmptyString(input.resourceId, "texture binding resource id");
	assertNonEmptyString(String(input.slot), "texture binding slot");
	assertNonEmptyString(input.role, "texture binding role");

	return joinIdentityParts([
		"binding",
		`resource=${formatIdentityComponent(input.resourceId)}`,
		`slot=${formatIdentityComponent(input.slot)}`,
		`role=${formatIdentityComponent(input.role)}`,
		`wrap=${input.wrapMode ?? "material-default"}`,
		`variant=${formatIdentityComponent(input.variantSignature ?? "default")}`,
	]) as TextureBindingId;
}

export function createTextureOwnerId(
	input: TextureOwnerIdInput,
): TextureOwnerId {
	switch (input.kind) {
		case "layer":
			assertNonEmptyString(input.layerOwnerId, "texture layer owner id");
			return joinIdentityParts([
				"owner=layer",
				`id=${formatIdentityComponent(input.layerOwnerId)}`,
			]) as TextureOwnerId;
		case "visual-resource":
			assertNonEmptyString(
				input.visualResourceId,
				"texture visual resource owner id",
			);
			return joinIdentityParts([
				"owner=visual-resource",
				`id=${formatIdentityComponent(input.visualResourceId)}`,
			]) as TextureOwnerId;
		case "dynamic-resource":
			assertNonEmptyString(
				input.dynamicResourceId,
				"texture dynamic resource owner id",
			);
			return joinIdentityParts([
				"owner=dynamic-resource",
				`id=${formatIdentityComponent(input.dynamicResourceId)}`,
			]) as TextureOwnerId;
	}
}

export function createTexturePageClass(
	input: TexturePageClassInput,
): TexturePageClass {
	assertSafeNonNegativeInteger(
		input.gutterPixels,
		"texture page gutter pixels",
	);

	return joinIdentityParts([
		"page-class",
		`domain=${input.domain}`,
		`purpose=${formatIdentityComponent(input.purpose)}`,
		`sample=${input.sampleClass}`,
		`format=${input.format}`,
		`gutter=${input.gutterPixels}`,
		`physical-wrap=${input.physicalWrapMode ?? "virtualized"}`,
	]) as TexturePageClass;
}

function comparePaletteReplacementFingerprints(
	left: PaletteReplacementFingerprint,
	right: PaletteReplacementFingerprint,
): number {
	return (
		left.offset - right.offset ||
		left.count - right.count ||
		left.hash64.localeCompare(right.hash64)
	);
}

function hashBytesFnv1a64(bytes: Uint8Array): string {
	let hash = FNV64_OFFSET;
	for (const byte of bytes) {
		hash ^= BigInt(byte);
		hash = (hash * FNV64_PRIME) & UINT64_MASK;
	}
	return hash.toString(16).padStart(16, "0");
}

function normalizeByteArray(
	value: Uint8Array | readonly number[],
	label: string,
): Uint8Array {
	if (value instanceof Uint8Array) {
		return value;
	}

	const bytes = new Uint8Array(value.length);
	for (let index = 0; index < value.length; index += 1) {
		const byte = value[index];
		if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
			throw new Error(`${label} must contain only byte values, got ${byte}.`);
		}
		bytes[index] = byte;
	}
	return bytes;
}

function joinIdentityParts(parts: readonly string[]): string {
	return parts.join("|");
}

function formatIdentityComponent(value: number | string): string {
	if (typeof value === "number") {
		assertSafeNonNegativeInteger(value, "numeric identity component");
		return value.toString(16).padStart(8, "0");
	}
	assertNonEmptyString(value, "string identity component");
	return encodeURIComponent(value);
}

function assertSafeNonNegativeInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${label} must be a safe non-negative integer: ${value}.`);
	}
}

function assertSafePositiveInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${label} must be a safe positive integer: ${value}.`);
	}
}

function assertNonEmptyString(value: string, label: string): void {
	if (value.length === 0) {
		throw new Error(`${label} must not be empty.`);
	}
}

function assertHash64(value: string): void {
	if (!/^[0-9a-f]{16}$/.test(value)) {
		throw new Error(
			`Palette replacement hash must be 16 lowercase hex chars: ${value}.`,
		);
	}
}

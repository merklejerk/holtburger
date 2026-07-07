import type { TextureUsagePurpose } from "../../../../textures/placement";

/** Replacement-owned atlas namespace for texture placement buckets. */
export type OpenWorldTextureBucketKey = string & {
	readonly __brand: "OpenWorldTextureBucketKey";
};

type OpenWorldTextureBucketScope =
	| {
			/** Broad static content can share compatible pages across owners. */
			readonly kind: "static-domain";
	  }
	| {
			/** Owner-scoped static content isolates placement when source facts are owner-specific. */
			readonly kind: "static-owner";
			readonly ownerId: string;
	  }
	| {
			/** Runtime-authored content is isolated by the runtime owner that mutates it. */
			readonly kind: "runtime-owner";
			readonly ownerId: string;
	  }
	| {
			/** Adapter-owned escape hatch for temporary or experimental placement scopes. */
			readonly kind: "custom";
			readonly key: string;
	  };

/** Decoded texture bucket parts for diagnostics and runtime resource inspection. */
export interface OpenWorldTextureBucketParts {
	/** Renderer or shader domain that constrains compatible atlas pages. */
	readonly domain: string;
	/** Shader/page purpose that constrains compatible atlas pages. */
	readonly purpose: TextureUsagePurpose;
	/** Streaming lifetime and sharing policy encoded into this bucket. */
	readonly scope: string;
}

export interface OpenWorldTextureBucketInput {
	/** Renderer or shader domain that constrains compatible atlas pages. */
	readonly domain: string;
	/** Shader/page purpose that constrains compatible atlas pages. */
	readonly purpose: TextureUsagePurpose;
	/** Streaming lifetime and sharing policy for compatible entries in this bucket. */
	readonly scope: OpenWorldTextureBucketScope;
}

export function createOpenWorldTextureBucketKey(
	input: OpenWorldTextureBucketInput,
): OpenWorldTextureBucketKey {
	assertNonEmptyBucketPart(input.domain, "texture bucket domain");
	return [
		"open-world-texture-bucket",
		`domain=${escapeBucketPart(input.domain)}`,
		`purpose=${input.purpose}`,
		createBucketScopeKey(input.scope),
	].join("|") as OpenWorldTextureBucketKey;
}

export function parseOpenWorldTextureBucketKey(
	bucketKey: OpenWorldTextureBucketKey,
): OpenWorldTextureBucketParts {
	const parts = bucketKey.split("|");
	if (parts[0] !== "open-world-texture-bucket") {
		throw new Error(`Unknown open-world texture bucket key: ${bucketKey}.`);
	}
	const values = new Map<string, string>();
	for (const part of parts.slice(1)) {
		const separatorIndex = part.indexOf("=");
		if (separatorIndex <= 0) {
			throw new Error(`Malformed open-world texture bucket part: ${part}.`);
		}
		values.set(part.slice(0, separatorIndex), part.slice(separatorIndex + 1));
	}
	const domain = requireBucketPart(values, "domain", bucketKey);
	const purpose = requireBucketPart(values, "purpose", bucketKey);
	const scope = requireBucketPart(values, "scope", bucketKey);
	return {
		domain: unescapeBucketPart(domain),
		purpose: parseTextureUsagePurpose(purpose, bucketKey),
		scope: unescapeScopePart(scope),
	};
}

function createBucketScopeKey(scope: OpenWorldTextureBucketScope): string {
	switch (scope.kind) {
		case "static-domain":
			return "scope=static-domain";
		case "static-owner":
			assertNonEmptyBucketPart(scope.ownerId, "static texture bucket owner id");
			return `scope=static-owner:${escapeBucketPart(scope.ownerId)}`;
		case "runtime-owner":
			assertNonEmptyBucketPart(
				scope.ownerId,
				"runtime texture bucket owner id",
			);
			return `scope=runtime-owner:${escapeBucketPart(scope.ownerId)}`;
		case "custom":
			assertNonEmptyBucketPart(scope.key, "custom texture bucket scope key");
			return `scope=custom:${escapeBucketPart(scope.key)}`;
	}
}

function assertNonEmptyBucketPart(value: string, label: string): void {
	if (value.length === 0) {
		throw new Error(`${label} cannot be empty.`);
	}
}

function escapeBucketPart(value: string): string {
	return encodeURIComponent(value);
}

function requireBucketPart(
	values: ReadonlyMap<string, string>,
	name: string,
	bucketKey: OpenWorldTextureBucketKey,
): string {
	const value = values.get(name);
	if (value === undefined || value.length === 0) {
		throw new Error(`Texture bucket key is missing ${name}: ${bucketKey}.`);
	}
	return value;
}

function unescapeScopePart(value: string): string {
	const separatorIndex = value.indexOf(":");
	if (separatorIndex < 0) {
		return unescapeBucketPart(value);
	}
	return [
		value.slice(0, separatorIndex),
		unescapeBucketPart(value.slice(separatorIndex + 1)),
	].join(":");
}

function unescapeBucketPart(value: string): string {
	return decodeURIComponent(value);
}

const TEXTURE_USAGE_PURPOSES = new Set<string>([
	"object-base-color",
	"object-detail",
	"object-index",
	"object-palette",
	"terrain-color",
	"terrain-detail",
	"terrain-mask",
] satisfies readonly TextureUsagePurpose[]);

function parseTextureUsagePurpose(
	value: string,
	bucketKey: OpenWorldTextureBucketKey,
): TextureUsagePurpose {
	if (!TEXTURE_USAGE_PURPOSES.has(value)) {
		throw new Error(
			`Texture bucket key has invalid purpose ${value}: ${bucketKey}.`,
		);
	}
	return value as TextureUsagePurpose;
}

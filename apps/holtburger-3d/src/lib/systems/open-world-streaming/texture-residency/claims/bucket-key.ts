import type { TextureUsagePurpose } from "../../../../textures/placement";

/** Replacement-owned atlas namespace. Legacy placement bucket keys are adapter inputs only. */
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

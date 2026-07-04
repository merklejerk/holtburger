import type { TextureResourceDependencies } from "./placement";

export interface TextureLeaseSet {
	/** Placement dependencies that must stay resident while their resources are installed. */
	readonly dependencies: readonly TextureResourceDependencies[];
}

export const EMPTY_TEXTURE_LEASE_SET: TextureLeaseSet = Object.freeze({
	dependencies: Object.freeze([]),
});

export function createTextureLeaseSet(
	dependencies: readonly TextureResourceDependencies[],
): TextureLeaseSet {
	const resourceIds = new Set<string>();
	for (const dependency of dependencies) {
		if (resourceIds.has(dependency.resourceId)) {
			throw new Error(
				`Texture lease set contains duplicate resource id ${dependency.resourceId}.`,
			);
		}
		resourceIds.add(dependency.resourceId);
	}
	return {
		dependencies: [...dependencies],
	};
}

export function collectTextureLeaseResourceIds(
	leaseSet: TextureLeaseSet,
): readonly string[] {
	return leaseSet.dependencies.map((dependency) => dependency.resourceId);
}

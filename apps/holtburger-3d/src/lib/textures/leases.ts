import type {
	TextureResourceDependencies,
	TextureResourceRoleDependency,
} from "./placement";

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
	return {
		dependencies: mergeTextureResourceDependencies(dependencies),
	};
}

export function collectTextureLeaseResourceIds(
	leaseSet: TextureLeaseSet,
): readonly string[] {
	return leaseSet.dependencies.map((dependency) => dependency.resourceId);
}

function mergeTextureResourceDependencies(
	dependencies: readonly TextureResourceDependencies[],
): readonly TextureResourceDependencies[] {
	// Large static publications can report the same renderer resource more than
	// once. A lease set is idempotent by resource id, so keep one lease and union
	// the texture placement item ids it needs to retain.
	const resourceOrder: string[] = [];
	const resourcesById = new Map<string, MutableTextureResourceDependency>();
	for (const dependency of dependencies) {
		let merged = resourcesById.get(dependency.resourceId);
		if (!merged) {
			merged = {
				resourceId: dependency.resourceId,
				roleOrder: [],
				rolesByPurpose: new Map(),
			};
			resourcesById.set(dependency.resourceId, merged);
			resourceOrder.push(dependency.resourceId);
		}
		for (const role of dependency.roles) {
			mergeTextureRoleDependency(merged, role);
		}
	}

	return resourceOrder.map((resourceId) => {
		const resource = resourcesById.get(resourceId);
		if (!resource) {
			throw new Error(`Missing merged texture resource ${resourceId}.`);
		}
		return {
			resourceId,
			roles: resource.roleOrder.map((purpose) => {
				const role = resource.rolesByPurpose.get(purpose);
				if (!role) {
					throw new Error(
						`Missing merged texture role ${purpose} for resource ${resourceId}.`,
					);
				}
				return {
					itemIds: role.itemIds,
					purpose,
				};
			}),
		};
	});
}

function mergeTextureRoleDependency(
	resource: MutableTextureResourceDependency,
	role: TextureResourceRoleDependency,
): void {
	let merged = resource.rolesByPurpose.get(role.purpose);
	if (!merged) {
		merged = {
			itemIdSet: new Set(),
			itemIds: [],
		};
		resource.rolesByPurpose.set(role.purpose, merged);
		resource.roleOrder.push(role.purpose);
	}
	for (const itemId of role.itemIds) {
		if (!merged.itemIdSet.has(itemId)) {
			merged.itemIdSet.add(itemId);
			merged.itemIds.push(itemId);
		}
	}
}

interface MutableTextureResourceDependency {
	readonly resourceId: string;
	readonly roleOrder: TextureResourceRoleDependency["purpose"][];
	readonly rolesByPurpose: Map<
		TextureResourceRoleDependency["purpose"],
		{
			readonly itemIdSet: Set<string>;
			readonly itemIds: string[];
		}
	>;
}

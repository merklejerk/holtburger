import type { StaticObjectMaterialBinding } from "../commit/artifacts";
import type { StaticDetailRole } from "../resolution/static-detail-role";

/**
 * Resolve one material's planned regional detail binding.
 *
 * A selected role must resolve; null is the explicit retail no-detail domain.
 */
export function resolveStaticMaterialDetail<TBinding>(
	material: Pick<StaticObjectMaterialBinding, "detailRole" | "source">,
	resolve: (role: StaticDetailRole) => TBinding | null,
): TBinding | null {
	if (material.detailRole === null) return null;
	const binding = resolve(material.detailRole);
	if (binding === null) {
		throw new Error(
			`Static material ${material.source.id} requires unavailable ${material.detailRole} detail.`,
		);
	}
	return binding;
}

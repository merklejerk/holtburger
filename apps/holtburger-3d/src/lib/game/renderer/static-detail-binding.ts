import type { StaticObjectMaterialBinding } from "../commit/artifacts";
import type { StaticDetailRole } from "../resolution/static-detail-role";

/**
 * Resolve one material's planned regional detail binding.
 *
 * Missing roles are fatal because silently dropping the overlay would hide an incomplete
 * active-region installation and produce domain-dependent material parity failures.
 */
export function resolveStaticMaterialDetail<TBinding>(
	material: Pick<StaticObjectMaterialBinding, "detailRole" | "source">,
	resolve: (role: StaticDetailRole) => TBinding | null,
): TBinding {
	const binding = resolve(material.detailRole);
	if (binding === null) {
		throw new Error(
			`Static material ${material.source.id} requires unavailable ${material.detailRole} detail.`,
		);
	}
	return binding;
}

import type { SceneScope } from "../scene";
import { scopeKey } from "../scene/scope";

/** Renderer-domain lookup required to route one dynamic object's plural source scopes. */
export interface DynamicRenderDomainSelection {
	/** Resolve a selected scope to its collapsed visibility-island domain. */
	selectedRenderDomainOrdinal(renderScopeKey: string): number | null;
}

/** Resolve plural source scopes to one submission per selected visibility-island domain. */
export function selectedDynamicRenderScopeKeys(
	scopes: readonly SceneScope[],
	portalVisibility: DynamicRenderDomainSelection | null,
): readonly string[] {
	if (scopes.length === 0) {
		throw new Error("Dynamic render contribution has no spatial membership.");
	}
	if (!portalVisibility) return [scopeKey(scopes[0]!)];

	const selectedKeys: string[] = [];
	const selectedDomainOrdinals = new Set<number>();
	for (const scope of scopes) {
		const key = scopeKey(scope);
		const domainOrdinal = portalVisibility.selectedRenderDomainOrdinal(key);
		if (domainOrdinal === null || selectedDomainOrdinals.has(domainOrdinal)) {
			continue;
		}
		selectedDomainOrdinals.add(domainOrdinal);
		selectedKeys.push(key);
	}
	if (selectedKeys.length === 0) {
		throw new Error(
			"Selected dynamic entity reaches no selected portal render domain.",
		);
	}
	return selectedKeys;
}

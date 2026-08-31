import type { RetailGeometryVisibility } from "../resolution/presentation";

/** Apply mode-owned debug policy to a host-derived retail visibility fact. */
export function retainsRetailGeometry(
	visibility: RetailGeometryVisibility,
	showRetailHiddenGeometry: boolean,
): boolean {
	return showRetailHiddenGeometry || visibility === "normally-visible";
}

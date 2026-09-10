import { sceneVector3 } from "../../lib/assets/ac-frame";
import {
	getLandblockCoordinates,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../../lib/game/landblocks";
import {
	PortalScopeWindowCuller,
	type PortalScopeWindowFrameView,
} from "../../lib/game/renderer/portal-scope-window-culler";
import { cullPortalScopeWindowsReference } from "../../lib/game/renderer/portal-scope-window-reference";
import { scopeKey } from "../../lib/game/scene/scope";

/** Borrowed current-view input; synchronous reference checks finish before the next frame. */
type CullArguments = Parameters<PortalScopeWindowCuller["cull"]>;
let latest: CullArguments | null = null;
let frame: PortalScopeWindowFrameView | null = null;
let installed = false;
/** Instrument only the explicitly enabled browser harness. */
export function installPortalTraversalInvestigation(): void {
	if (installed) throw new Error("Portal traversal probe already installed.");
	installed = true;
	const original = PortalScopeWindowCuller.prototype.cull;
	PortalScopeWindowCuller.prototype.cull = function (...args) {
		latest = args;
		frame = original.apply(this, args);
		return frame;
	};
}
/** Scope retention against the independent exact reference; pixel equality is not the contract. */
export function runPortalTraversalInvestigation() {
	if (latest === null || frame === null)
		throw new Error("No portal view captured.");
	const reference = cullPortalScopeWindowsReference(latest[0], {
		...latest[1],
		safetyWorkItemLimit: 1_000_000,
	});
	const captured = frame;
	const selected = new Set(
		Array.from({ length: frame.selectedScopeCount }, (_, i) =>
			scopeKey(captured.selectedScope(i)),
		),
	);
	const lostScopes = reference.selections
		.map((s) => scopeKey(s.scope))
		.filter((key) => !selected.has(key));
	return {
		root: scopeKey(latest[1].rootScope),
		status: frame.status,
		depth: frame.completedDepth,
		cells: frame.selectedScopeCount,
		crossings: frame.selectedCrossingCount,
		domains: frame.selectedRenderDomainCount,
		referenceCells: reference.selections.length,
		lostScopes,
		trace: { ...frame.trace },
	};
}

/** Nearby authored portal triangles provide local, geometry-checked cell-boundary probes. */
export function portalTransitionProbeSegments() {
	if (latest === null) throw new Error("No portal topology captured.");
	const segments = [];
	const eye = latest[1].nearClipVolume.eye;
	for (const crossing of latest[0].crossings) {
		if (
			crossing.source.kind !== "env-cell" ||
			crossing.target.kind !== "env-cell"
		)
			continue;
		if (
			crossing.reciprocalCrossingId !== null &&
			crossing.id > crossing.reciprocalCrossingId
		)
			continue;
		const aperture = crossing.visibilityAperture;
		const coordinates = getLandblockCoordinates(aperture.landblockId);
		let x = 0,
			y = 0,
			z = 0;
		for (let vertex = 0; vertex < 3; vertex += 1) {
			const offset = aperture.indices[vertex]! * 3;
			x += aperture.vertices[offset]! / 3;
			y += aperture.vertices[offset + 1]! / 3;
			z += aperture.vertices[offset + 2]! / 3;
		}
		const anchorX =
			x +
			(coordinates.x - latest[1].anchorCoordinates.x) *
				OUTDOOR_LANDBLOCK_WORLD_SIZE;
		const anchorZ =
			z -
			(coordinates.y - latest[1].anchorCoordinates.y) *
				OUTDOOR_LANDBLOCK_WORLD_SIZE;
		const distance = Math.hypot(anchorX - eye.x, y - eye.y, anchorZ - eye.z);
		x += coordinates.x * OUTDOOR_LANDBLOCK_WORLD_SIZE;
		z -= coordinates.y * OUTDOOR_LANDBLOCK_WORLD_SIZE;
		const normal = aperture.plane.normal;
		const sign = crossing.acceptedSide === "positive" ? 1 : -1;
		segments.push({
			source: crossing.source.envCellId,
			target: crossing.target.envCellId,
			distance,
			center: sceneVector3([x, y, z]),
			normal: [normal.x * sign, normal.y * sign, normal.z * sign],
		});
	}
	return segments.sort((a, b) => a.distance - b.distance).slice(0, 12);
}

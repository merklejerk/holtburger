/** Depth-buffer clear value representing no admitted appearance of the packed scope pixel. */
export const PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH = 0;
/** Distinct maximum value representing a scope appearance with no admitted exit portal. */
export const PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH = 1;
/** Keep every finite exit below the unbounded sentinel while preserving strict depth ordering. */
const PORTAL_SCOPE_ENVELOPE_FINITE_DEPTH_SCALE = 0.5;

/** Exact logical scope-envelope value before its depth-attachment encoding. */
export type PortalScopeEnvelopeExit =
	| { readonly kind: "uncovered" }
	| { readonly kind: "unbounded" }
	| { readonly kind: "finite"; readonly maximumExitDepth: number };

/**
 * Encode maximum-exit reduction into one depth attachment without a sentinel collision.
 *
 * Finite clip depths occupy [0, 0.5], unbounded uses 1, and uncovered uses 0. A finite zero exit is
 * observationally equivalent to uncovered because normalized raster depth cannot be less than 0.
 */
export function encodePortalScopeEnvelopeDepth(
	exit: PortalScopeEnvelopeExit,
): number {
	if (exit.kind === "uncovered") {
		return PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH;
	}
	if (exit.kind === "unbounded") {
		return PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH;
	}
	validateNormalizedDepth(exit.maximumExitDepth, "finite portal exit");
	return exit.maximumExitDepth * PORTAL_SCOPE_ENVELOPE_FINITE_DEPTH_SCALE;
}

/** Apply the exact deferred-fragment predicate to one encoded envelope sample. */
export function encodedPortalScopeEnvelopeContainsFragment(
	encodedEnvelopeDepth: number,
	fragmentDepth: number,
): boolean {
	validateNormalizedDepth(fragmentDepth, "portal fragment");
	validateEncodedEnvelopeDepth(encodedEnvelopeDepth);
	if (encodedEnvelopeDepth === PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH) {
		return true;
	}
	if (encodedEnvelopeDepth === PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH) {
		return false;
	}
	return (
		fragmentDepth * PORTAL_SCOPE_ENVELOPE_FINITE_DEPTH_SCALE <
		encodedEnvelopeDepth
	);
}

function validateEncodedEnvelopeDepth(value: number): void {
	if (
		value === PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH ||
		(Number.isFinite(value) &&
			value >= PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH &&
			value <= PORTAL_SCOPE_ENVELOPE_FINITE_DEPTH_SCALE)
	) {
		return;
	}
	throw new Error(
		"Portal scope-envelope sample must be uncovered, finite-scaled, or unbounded.",
	);
}

function validateNormalizedDepth(value: number, owner: string): void {
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new Error(`${owner} depth must be finite and normalized.`);
	}
}

import { describe, expect, it } from "vitest";
import {
	encodedPortalScopeEnvelopeContainsFragment,
	encodePortalScopeEnvelopeDepth,
	PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH,
	PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH,
	type PortalScopeEnvelopeExit,
} from "./portal-scope-envelope-depth";

describe("portal scope-envelope depth encoding", () => {
	it.each([
		{
			encoded: PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH,
			exit: { kind: "uncovered" },
		},
		{
			encoded: PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH,
			exit: { kind: "unbounded" },
		},
		{
			encoded: PORTAL_SCOPE_ENVELOPE_UNCOVERED_DEPTH,
			exit: { kind: "finite", maximumExitDepth: 0 },
		},
		{ encoded: 0.125, exit: { kind: "finite", maximumExitDepth: 0.25 } },
		{ encoded: 0.5, exit: { kind: "finite", maximumExitDepth: 1 } },
	] as const)("encodes $exit.kind as $encoded", ({ encoded, exit }) => {
		expect(encodePortalScopeEnvelopeDepth(exit)).toBe(encoded);
	});

	it("preserves the exact logical predicate across normalized finite depths", () => {
		const exits: PortalScopeEnvelopeExit[] = [
			{ kind: "uncovered" },
			{ kind: "unbounded" },
		];
		for (let exitOrdinal = 0; exitOrdinal <= 256; exitOrdinal += 1) {
			exits.push({
				kind: "finite",
				maximumExitDepth: exitOrdinal / 256,
			});
		}
		for (const exit of exits) {
			const encoded = encodePortalScopeEnvelopeDepth(exit);
			for (
				let fragmentOrdinal = 0;
				fragmentOrdinal <= 256;
				fragmentOrdinal += 1
			) {
				const fragmentDepth = fragmentOrdinal / 256;
				const expected =
					exit.kind === "unbounded" ||
					(exit.kind === "finite" && fragmentDepth < exit.maximumExitDepth);
				expect(
					encodedPortalScopeEnvelopeContainsFragment(encoded, fragmentDepth),
				).toBe(expected);
			}
		}
	});

	it("keeps far-plane finite and unbounded exits observably distinct", () => {
		const finiteFar = encodePortalScopeEnvelopeDepth({
			kind: "finite",
			maximumExitDepth: 1,
		});
		const unbounded = encodePortalScopeEnvelopeDepth({ kind: "unbounded" });

		expect(finiteFar).toBe(0.5);
		expect(unbounded).toBe(PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH);
		expect(encodedPortalScopeEnvelopeContainsFragment(finiteFar, 1)).toBe(
			false,
		);
		expect(encodedPortalScopeEnvelopeContainsFragment(unbounded, 1)).toBe(true);
	});

	it("rejects malformed logical and encoded depths", () => {
		expect(() =>
			encodePortalScopeEnvelopeDepth({
				kind: "finite",
				maximumExitDepth: -0.01,
			}),
		).toThrow("finite portal exit depth");
		expect(() => encodedPortalScopeEnvelopeContainsFragment(0.75, 0.5)).toThrow(
			"uncovered, finite-scaled, or unbounded",
		);
		expect(() =>
			encodedPortalScopeEnvelopeContainsFragment(0.25, Number.NaN),
		).toThrow("portal fragment depth");
	});
});

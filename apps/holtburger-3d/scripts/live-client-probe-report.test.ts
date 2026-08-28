import { describe, expect, it } from "vitest";

import {
	createProbeFailureResult,
	probeHostDiagnostic,
} from "./live-client-probe-report.mjs";

const credentials = { account: "test-account", password: "test-password" };

describe("live client probe failure reporting", () => {
	it("retains progress while redacting credentials from errors and host diagnostics", () => {
		const lifecycle = [{ kind: "connecting" }];
		const terminalEvents = [{ cause: "login-rejected" }];
		const result = createProbeFailureResult(
			new Error("test-account could not use test-password"),
			{
				credentials,
				lastCompletedPhase: "client-start-requested",
				lifecycle,
				terminalEvents,
				stderr: "ACE rejected test-account with test-password",
			},
		);

		expect(result).toEqual({
			ok: false,
			error: {
				name: "Error",
				message: "<account> could not use <password>",
			},
			lastCompletedPhase: "client-start-requested",
			lifecycle,
			terminalEvents,
			hostDiagnostic: "ACE rejected <account> with <password>",
		});
	});

	it("omits silent host diagnostics and bounds noisy ones to their useful tail", () => {
		expect(probeHostDiagnostic(" \n", credentials)).toBeNull();
		const diagnostic = probeHostDiagnostic(
			`${"x".repeat(5_000)} test-password`,
			credentials,
		);

		expect(diagnostic).toHaveLength(4_097);
		expect(diagnostic).toMatch(/^…x+/);
		expect(diagnostic).toMatch(/<password>$/);
		expect(diagnostic).not.toContain("test-password");
	});
});

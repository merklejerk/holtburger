import { describe, expect, it } from "vitest";
import {
	HostCommandError,
	isContentFailure,
	unwrapHostCommandResult,
} from "./host-command-result";

/** A real source failure shape, independent of installed content and Electron error serialization. */
const failure = {
	code: "application_error",
	message: "Could not load Animation 0x0300055b: missing archive resource",
	resource: {
		kind: "missing" as const,
		namespace: "eor/portal",
		file_id: 0x0300055b,
	},
};

describe("host command outcomes", () => {
	it("retains source identity and classification after IPC data cloning", () => {
		const reply = structuredClone({ kind: "failed", error: failure });
		try {
			unwrapHostCommandResult(reply);
			throw new Error("request should reject");
		} catch (error) {
			expect(error).toBeInstanceOf(HostCommandError);
			expect(error).toMatchObject({ failure });
			expect(isContentFailure(error)).toBe(true);
		}
	});

	it("does not contain operational errors, mixed aggregates, or invalid replies", () => {
		const source = new HostCommandError(failure);
		const invariant = new Error("handle released twice");
		expect(
			isContentFailure(new Error("closure failed", { cause: source })),
		).toBe(true);
		expect(
			isContentFailure(new AggregateError([source, source], "shared source")),
		).toBe(true);
		expect(
			isContentFailure(
				new AggregateError([source, invariant], "mixed failure"),
			),
		).toBe(false);
		expect(
			isContentFailure(
				new AggregateError([source], "mixed cause", { cause: invariant }),
			),
		).toBe(false);
		expect(
			isContentFailure(
				new AggregateError([source], "shared cause", { cause: source }),
			),
		).toBe(true);
		expect(
			isContentFailure(
				new HostCommandError({ code: "host_exit", message: "host stopped" }),
			),
		).toBe(false);
		expect(() =>
			unwrapHostCommandResult({
				kind: "failed",
				error: { message: "lost classification" },
			}),
		).toThrow();
		expect(
			unwrapHostCommandResult({ kind: "ok", value: new Uint8Array([1, 2]) }),
		).toEqual(new Uint8Array([1, 2]));
	});

	it("terminates on circular causes without classifying them as source content", () => {
		const error = new Error("cycle");
		error.cause = error;
		expect(isContentFailure(error)).toBe(false);
		const aggregate = new AggregateError(
			[new HostCommandError(failure)],
			"cycle",
		);
		aggregate.cause = aggregate;
		expect(isContentFailure(aggregate)).toBe(false);
	});
});

import { describe, expect, it } from "vitest";

import { landblockVector3 } from "../lib/assets/ac-frame";
import type { ClientCameraIdentity } from "./client-host-contract";
import {
	ClientLifecycleSession,
	type ClientLifecycleTransport,
} from "./client-lifecycle-session";
import {
	ClientPreciseJumpSession,
	type ClientPreciseJumpCadence,
} from "./client-precise-jump-session";

const AIM_INTERVAL_MS = 40;

class FakeClientTransport implements ClientLifecycleTransport {
	readonly handlers = new Map<string, (payload: unknown) => void>();
	readonly invocations: Array<{ command: string; args: unknown }> = [];

	async listen(
		event: Parameters<ClientLifecycleTransport["listen"]>[0],
		handler: (payload: unknown) => void,
	): Promise<() => void> {
		this.handlers.set(event, handler);
		return () => this.handlers.delete(event);
	}

	async invoke(
		command: Parameters<ClientLifecycleTransport["invoke"]>[0],
		args?: Parameters<ClientLifecycleTransport["invoke"]>[1],
	): Promise<unknown> {
		this.invocations.push({ command, args });
		return undefined;
	}

	emit(event: string, payload: unknown): void {
		this.handlers.get(event)?.(payload);
	}
}

class FakeCadence implements ClientPreciseJumpCadence {
	#now = 0;
	#nextTaskId = 1;
	readonly #tasks = new Map<
		number,
		{ readonly due: number; readonly callback: () => void }
	>();

	nowMilliseconds(): number {
		return this.#now;
	}

	schedule(delayMilliseconds: number, callback: () => void): () => void {
		const id = this.#nextTaskId++;
		this.#tasks.set(id, { due: this.#now + delayMilliseconds, callback });
		return () => this.#tasks.delete(id);
	}

	advance(milliseconds: number): void {
		const target = this.#now + milliseconds;
		for (;;) {
			const next = [...this.#tasks.entries()]
				.filter(([, task]) => task.due <= target)
				.sort((left, right) => left[1].due - right[1].due)[0];
			if (next === undefined) break;
			const [id, task] = next;
			this.#tasks.delete(id);
			this.#now = task.due;
			task.callback();
		}
		this.#now = target;
	}

	pendingTaskCount(): number {
		return this.#tasks.size;
	}
}

const camera: ClientCameraIdentity = {
	cameraGeneration: 2,
	playerGuid: 0x5000_0001,
	entityGeneration: 7,
};

const ray = {
	camera,
	anchor: 0xda55_ffff,
	start: landblockVector3([10, 20, 4]),
	direction: [0, 1, 0] as const,
	maximumDistance: 80,
	previousCell: null,
};

function evaluation(sequence: number, status: "reachable" | "unreachable") {
	return {
		evaluationId: sequence + 100,
		camera,
		sequence,
		target: {
			anchor: 0xda55_ffff,
			point: [10, 40, 0],
			normal: [0, 0, 1],
			committedCell: null,
		},
		status,
		...(status === "reachable"
			? {
					trajectory: {
						anchor: 0xda55_ffff,
						origin: [10, 20, 4],
						velocity: [0, 14, 8],
						acceleration: [0, 0, -9.8],
						durationSeconds: 1.5,
						placements: [
							{
								startFraction: 0,
								endFraction: 1,
								committedCell: null,
							},
						],
					},
				}
			: {}),
		diagnostics: {
			generatedCandidates: 6,
			evaluatedCandidates: 2,
			solverTicks: 71,
		},
	};
}

async function fixture(): Promise<{
	transport: FakeClientTransport;
	lifecycle: ClientLifecycleSession;
	precise: ClientPreciseJumpSession;
	cadence: FakeCadence;
}> {
	const transport = new FakeClientTransport();
	const lifecycle = new ClientLifecycleSession(transport);
	const cadence = new FakeCadence();
	await lifecycle.start();
	transport.invocations.length = 0;
	return {
		transport,
		lifecycle,
		precise: new ClientPreciseJumpSession(
			lifecycle,
			() => undefined,
			cadence,
			AIM_INTERVAL_MS,
		),
		cadence,
	};
}

describe("ClientPreciseJumpSession", () => {
	it("coalesces pointer pressure behind the submitted evaluation", async () => {
		const { cadence, precise, transport } = await fixture();
		precise.enter();
		precise.aim(ray);
		precise.aim({ ...ray, maximumDistance: 70 });
		precise.aim({ ...ray, maximumDistance: 60 });
		cadence.advance(AIM_INTERVAL_MS);

		expect(transport.invocations).toHaveLength(1);
		transport.emit(
			"client-precise-jump-evaluation",
			evaluation(1, "reachable"),
		);

		expect(transport.invocations).toHaveLength(2);
		expect(transport.invocations.map(({ args }) => args)).toMatchObject([
			{ request: { sequence: 1, maximumDistance: 80 } },
			{ request: { sequence: 2, maximumDistance: 60 } },
		]);
	});

	it("publishes a submitted completion while a newer ray is pending", async () => {
		const { precise, transport } = await fixture();
		expect(precise.snapshot()).toEqual({ active: false, marker: null });
		precise.enter();
		expect(precise.snapshot()).toEqual({ active: true, marker: null });
		precise.aim(ray);
		precise.aim({ ...ray, maximumDistance: 60 });
		transport.emit(
			"client-precise-jump-evaluation",
			evaluation(1, "reachable"),
		);
		expect(precise.snapshot()).toEqual({
			active: true,
			marker: evaluation(1, "reachable"),
		});
	});

	it("bounds a sustained pointer stream without starving marker publication", async () => {
		const { cadence, precise, transport } = await fixture();
		let invocationIndex = 0;
		let publications = 0;
		precise.subscribe((snapshot) => {
			if (snapshot.marker !== null) publications += 1;
		});
		precise.enter();

		const durationMs = AIM_INTERVAL_MS * 10;
		for (let millisecond = 0; millisecond < durationMs; millisecond += 1) {
			precise.aim({ ...ray, maximumDistance: 60 + millisecond / 1_000 });
			cadence.advance(1);
			while (invocationIndex < transport.invocations.length) {
				const invocation = transport.invocations[invocationIndex++];
				const request = (invocation.args as { request: { sequence: number } })
					.request;
				transport.emit(
					"client-precise-jump-evaluation",
					evaluation(request.sequence, "reachable"),
				);
			}
		}

		expect(transport.invocations.length).toBeGreaterThan(1);
		expect(transport.invocations.length).toBeLessThanOrEqual(
			Math.ceil(durationMs / AIM_INTERVAL_MS) + 1,
		);
		expect(publications).toBe(transport.invocations.length);
	});

	it("rejects obsolete evaluations and treats red activation as a no-op", async () => {
		const { cadence, precise, transport } = await fixture();
		precise.enter();
		precise.aim(ray);
		transport.emit(
			"client-precise-jump-evaluation",
			evaluation(1, "reachable"),
		);
		precise.aim(ray);
		cadence.advance(AIM_INTERVAL_MS);
		transport.emit(
			"client-precise-jump-evaluation",
			evaluation(1, "unreachable"),
		);
		expect(precise.snapshot().marker).toEqual(evaluation(1, "reachable"));

		transport.emit(
			"client-precise-jump-evaluation",
			evaluation(2, "unreachable"),
		);
		expect(precise.activate()).toBe(false);
		expect(precise.state().kind).toBe("targeting");
		expect(precise.snapshot()).toEqual({
			active: true,
			marker: evaluation(2, "unreachable"),
		});
	});

	it("admits one reachable commit and exits only on matching committed feedback", async () => {
		const { cadence, precise, transport } = await fixture();
		precise.enter();
		precise.aim(ray);
		transport.emit(
			"client-precise-jump-evaluation",
			evaluation(1, "reachable"),
		);
		precise.aim({ ...ray, maximumDistance: 60 });
		cadence.advance(AIM_INTERVAL_MS);
		expect(
			transport.invocations.filter(
				({ command }) => command === "set_client_precise_jump_aim",
			),
		).toHaveLength(2);

		expect(precise.activate()).toBe(true);
		cadence.advance(AIM_INTERVAL_MS * 2);
		expect(precise.activate()).toBe(false);
		transport.emit(
			"client-precise-jump-evaluation",
			evaluation(2, "unreachable"),
		);
		expect(precise.state()).toMatchObject({
			kind: "commit-pending",
			evaluation: evaluation(1, "reachable"),
		});
		transport.emit("client-precise-jump-transaction-feedback", {
			sequence: 99,
			outcome: { kind: "committed" },
		});
		expect(precise.state().kind).toBe("commit-pending");
		transport.emit("client-precise-jump-transaction-feedback", {
			sequence: 1,
			outcome: { kind: "committed" },
		});

		expect(precise.state()).toEqual({ kind: "inactive" });
		expect(
			transport.invocations.filter(
				({ command }) => command === "commit_client_precise_jump",
			),
		).toHaveLength(1);
		expect(
			transport.invocations.filter(
				({ command }) => command === "set_client_precise_jump_aim",
			),
		).toHaveLength(2);
	});

	it("cancels pending cadence work on camera replacement and destroy", async () => {
		const { cadence, precise, transport } = await fixture();
		precise.enter();
		precise.aim(ray);
		transport.emit(
			"client-precise-jump-evaluation",
			evaluation(1, "reachable"),
		);
		precise.aim(ray);
		expect(cadence.pendingTaskCount()).toBe(1);

		transport.emit("client-camera-started", {
			cameraGeneration: 3,
			playerGuid: camera.playerGuid,
			entityGeneration: camera.entityGeneration,
		});
		expect(precise.state()).toEqual({ kind: "inactive" });
		expect(cadence.pendingTaskCount()).toBe(0);
		cadence.advance(AIM_INTERVAL_MS * 2);
		expect(
			transport.invocations.filter(
				({ command }) => command === "set_client_precise_jump_aim",
			),
		).toHaveLength(1);

		precise.enter();
		precise.aim(ray);
		transport.emit(
			"client-precise-jump-evaluation",
			evaluation(2, "reachable"),
		);
		precise.aim(ray);
		expect(cadence.pendingTaskCount()).toBe(1);
		precise.destroy();
		expect(cadence.pendingTaskCount()).toBe(0);
	});
});

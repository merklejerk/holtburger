import {
	resolvedJumpFixture,
	predictedJumpFixture,
	jumpActorFixture,
} from "./client-precise-jump-fixtures";
import { CLIENT_TUNING } from "./client-tuning";
import { describe, expect, it } from "vitest";
import { setImmediate as settleSubmission } from "node:timers/promises";

import { landblockVector3 } from "../lib/assets/ac-frame";
import {
	MINIMUM_JUMP_POWER,
	type ClientCameraIdentity,
} from "./client-host-contract";
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

async function fixture() {
	const transport = new FakeClientTransport();
	const lifecycle = new ClientLifecycleSession(transport);
	const cadence = new FakeCadence();
	await lifecycle.start();
	transport.invocations.length = 0;
	return {
		transport,
		lifecycle,
		cadence,
		precise: new ClientPreciseJumpSession(
			lifecycle,
			() => undefined,
			cadence,
			AIM_INTERVAL_MS,
		),
	};
}

describe("ClientPreciseJumpSession", () => {
	it("coalesces pointer input without waiting for a flight to finish", async () => {
		const { precise, transport, cadence } = await fixture();
		precise.enter();
		precise.aim(ray);
		await settleSubmission();
		precise.aim({ ...ray, maximumDistance: 70 });
		precise.aim({ ...ray, maximumDistance: 60 });
		cadence.advance(AIM_INTERVAL_MS);
		expect(transport.invocations.map((x) => x.args)).toMatchObject([
			{ request: { sequence: 1, maximumDistance: 80 } },
			{ request: { sequence: 2, maximumDistance: 60 } },
		]);
	});
	it("submits changed power for the same ray and invalidates the old selection", async () => {
		const { precise, transport, cadence } = await fixture();
		precise.enter();
		precise.aim(ray);
		await settleSubmission();
		transport.emit(
			"client-precise-jump-evaluation",
			resolvedJumpFixture(camera, 1, precise.power()),
		);
		const before = precise.power();
		const direction = before <= 0.5 ? 1 : -1;
		precise.adjustPower(direction);
		expect(precise.power()).toBe(
			Math.max(
				MINIMUM_JUMP_POWER,
				Math.min(1, before + direction * CLIENT_TUNING.preciseJump.powerStep),
			),
		);
		expect(precise.snapshot().marker).toBeNull();
		expect(precise.activate()).toBe(false);
		cadence.advance(AIM_INTERVAL_MS);
		expect(transport.invocations.at(-1)?.args).toMatchObject({
			request: { sequence: 2, power: precise.power(), start: ray.start },
		});
	});
	it("activates an early resolved launch once while collision prediction is pending", async () => {
		const { precise, transport } = await fixture();
		precise.enter();
		precise.aim(ray);
		transport.emit(
			"client-precise-jump-evaluation",
			resolvedJumpFixture(camera, 1, precise.power()),
		);
		expect(precise.activate()).toBe(true);
		expect(precise.activate()).toBe(false);
		expect(
			transport.invocations.filter(
				(x) => x.command === "commit_client_precise_jump",
			),
		).toHaveLength(1);
	});
	it.each(["match", "miss", "incomplete"] as const)(
		"allows the user's chosen launch when prediction reports %s",
		async (outcome) => {
			const { precise, transport } = await fixture();
			precise.enter();
			precise.aim(ray);
			const resolved = resolvedJumpFixture(camera, 1, precise.power());
			transport.emit(
				"client-precise-jump-evaluation",
				predictedJumpFixture(resolved, outcome),
			);
			expect(precise.activate()).toBe(true);
		},
	);
	it("does not activate an unresolved target", async () => {
		const { precise, transport } = await fixture();
		precise.enter();
		precise.aim(ray);
		transport.emit("client-precise-jump-evaluation", {
			phase: "completed",
			status: "no-surface",

			camera,
			sequence: 1,
		});
		expect(precise.activate()).toBe(false);
	});
	it("rejects old power and camera feedback while replacement awaits cadence", async () => {
		const { precise, transport, cadence } = await fixture();
		precise.enter();
		precise.aim(ray);
		await settleSubmission();
		precise.adjustPower(precise.power() <= 0.5 ? 1 : -1);
		transport.emit(
			"client-precise-jump-evaluation",
			resolvedJumpFixture(camera, 1, 1),
		);
		expect(precise.snapshot().marker).toBeNull();
		cadence.advance(AIM_INTERVAL_MS);
		transport.emit(
			"client-precise-jump-evaluation",
			resolvedJumpFixture(
				{ ...camera, cameraGeneration: camera.cameraGeneration + 1 },
				2,
				precise.power(),
			),
		);
		expect(precise.snapshot().marker).toBeNull();
		transport.emit(
			"client-precise-jump-evaluation",
			resolvedJumpFixture(camera, 2, precise.power()),
		);
		expect(precise.activate()).toBe(true);
	});
	it("deduplicates unchanged input and rejects late progress after completion", async () => {
		const { precise, transport, cadence } = await fixture();
		precise.enter();
		precise.aim(ray);
		await settleSubmission();
		const resolved = resolvedJumpFixture(camera, 1, precise.power());
		const final = predictedJumpFixture(resolved, "miss");
		transport.emit("client-precise-jump-evaluation", final);
		precise.aim({ ...ray });
		cadence.advance(AIM_INTERVAL_MS);
		expect(transport.invocations).toHaveLength(1);
		transport.emit("client-precise-jump-evaluation", resolved);
		expect(precise.snapshot().marker).toEqual(final);
	});
	it("keeps selected power and reacquires a launch after airborne rejection", async () => {
		const { precise, transport, cadence } = await fixture();
		precise.enter();
		precise.aim(ray);
		await settleSubmission();
		const power = precise.power();
		transport.emit(
			"client-precise-jump-evaluation",
			resolvedJumpFixture(camera, 1, power),
		);
		precise.activate();
		transport.emit("client-precise-jump-transaction-feedback", {
			sequence: 1,
			outcome: { kind: "rejected", reason: "airborne" },
		});
		expect(precise.snapshot().active).toBe(true);
		expect(precise.power()).toBe(power);
		cadence.advance(AIM_INTERVAL_MS);
		expect(transport.invocations.at(-1)?.args).toMatchObject({
			request: { sequence: 2, power },
		});
	});
	it("integrates held power by elapsed time rather than event or frame count", async () => {
		const first = (await fixture()).precise;
		const second = (await fixture()).precise;
		for (const precise of [first, second]) {
			precise.enter();
			precise.adjustPower(-1e6);
		}
		first.adjustHeldPower(1, 0.2);
		for (let frame = 0; frame < 4; frame++) second.adjustHeldPower(1, 0.05);
		const expected = Math.min(
			1,
			MINIMUM_JUMP_POWER + CLIENT_TUNING.preciseJump.heldPowerPerSecond * 0.2,
		);
		expect(first.power()).toBeCloseTo(expected);
		expect(second.power()).toBeCloseTo(expected);
		first.adjustHeldPower(0, 1);
		first.adjustHeldPower(1, -1);
		expect(first.power()).toBeCloseTo(expected);
		first.cancel();
		first.adjustHeldPower(1, 1);
		expect(first.power()).toBeCloseTo(expected);
	});

	it("sets absolute bar power, replaces the selected launch and clamps endpoints", async () => {
		const { precise, transport, cadence } = await fixture();
		precise.enter();
		precise.aim(ray);
		await settleSubmission();
		transport.emit(
			"client-precise-jump-evaluation",
			resolvedJumpFixture(camera, 1, precise.power()),
		);
		precise.setPower(0.37);
		expect(precise.power()).toBe(0.37);
		expect(precise.activate()).toBe(false);
		cadence.advance(AIM_INTERVAL_MS);
		await settleSubmission();
		expect(transport.invocations.at(-1)?.args).toMatchObject({
			request: { power: 0.37 },
		});
		precise.setPower(0);
		expect(precise.power()).toBe(MINIMUM_JUMP_POWER);
		precise.setPower(2);
		expect(precise.power()).toBe(1);
		precise.setPower(Number.NaN);
		expect(precise.power()).toBe(1);
		precise.cancel();
		precise.setPower(0.5);
		expect(precise.power()).toBe(1);
	});

	it("submits the legal minimum after scrolling below the power range", async () => {
		const { precise, transport, cadence } = await fixture();
		precise.enter();
		precise.aim(ray);
		await settleSubmission();
		precise.adjustPower(-1e6);
		cadence.advance(AIM_INTERVAL_MS);
		await settleSubmission();
		expect(transport.invocations.at(-1)?.args).toMatchObject({
			request: { power: MINIMUM_JUMP_POWER },
		});
	});
	it("clamps power within the legal range", async () => {
		const { precise } = await fixture();
		precise.enter();
		precise.adjustPower(-1e6);
		expect(precise.power()).toBe(MINIMUM_JUMP_POWER);
		precise.adjustPower(1e6);
		expect(precise.power()).toBe(1);
	});
	it("refreshes a stationary ray for actor translation but not rotation or peer changes", async () => {
		const { precise, lifecycle, transport, cadence } = await fixture();
		const actor = jumpActorFixture(camera.playerGuid, camera.entityGeneration);
		lifecycle.mirror.apply({
			kind: "snapshot",
			snapshot: { hostTime: { seconds: 1 }, entities: [actor] },
		});
		precise.enter();
		precise.aim(ray);
		await settleSubmission();
		const rotated = structuredClone(actor);
		rotated.placement.pose.rotation = { w: 0, x: 0, y: 0, z: 1 };
		transport.emit("client-dynamic-entity", {
			kind: "upserted",
			entity: rotated,
		});
		cadence.advance(AIM_INTERVAL_MS);
		expect(transport.invocations).toHaveLength(1);
		const moved = structuredClone(rotated);
		moved.placement.pose.coords.x += 1;
		transport.emit("client-dynamic-entity", {
			kind: "upserted",
			entity: moved,
		});
		cadence.advance(AIM_INTERVAL_MS);
		expect(transport.invocations.at(-1)?.args).toMatchObject({
			request: { sequence: 2, start: ray.start, power: precise.power() },
		});
		const count = transport.invocations.length;
		await settleSubmission();
		transport.emit("client-dynamic-entity", {
			kind: "upserted",
			entity: jumpActorFixture(42, 1),
		});
		cadence.advance(AIM_INTERVAL_MS);
		expect(transport.invocations).toHaveLength(count);
	});
	it("keeps a selected launch usable while actor-only preview refresh is pending", async () => {
		const { precise, lifecycle, transport, cadence } = await fixture();
		const actor = jumpActorFixture(camera.playerGuid, camera.entityGeneration);
		lifecycle.mirror.apply({
			kind: "snapshot",
			snapshot: { hostTime: { seconds: 1 }, entities: [actor] },
		});
		precise.enter();
		precise.aim(ray);
		await settleSubmission();
		const resolved = resolvedJumpFixture(camera, 1, precise.power());
		transport.emit("client-precise-jump-evaluation", resolved);
		const moved = structuredClone(actor);
		moved.placement.pose.coords.x += 1;
		transport.emit("client-dynamic-entity", {
			kind: "upserted",
			entity: moved,
		});
		expect(precise.snapshot().refreshing).toBe(true);
		expect(precise.snapshot().marker).toEqual(resolved);
		cadence.advance(AIM_INTERVAL_MS);
		expect(precise.activate()).toBe(true);
		expect(transport.invocations.at(-1)?.args).toMatchObject({
			request: {
				camera,
				target: resolved.launch.target,
				power: resolved.launch.power,
			},
		});
	});
	it("clears queued input and presentation on cancel and ignores late results", async () => {
		const { precise, transport, cadence } = await fixture();
		precise.enter();
		precise.aim(ray);
		await settleSubmission();
		precise.aim({ ...ray, maximumDistance: 60 });
		precise.cancel();
		cadence.advance(AIM_INTERVAL_MS);
		transport.emit(
			"client-precise-jump-evaluation",
			resolvedJumpFixture(camera, 1, precise.power()),
		);
		expect(precise.snapshot()).toEqual({
			active: false,
			marker: null,
			refreshing: false,
		});
		expect(
			transport.invocations.filter(
				(x) => x.command === "set_client_precise_jump_aim",
			),
		).toHaveLength(1);
	});
});

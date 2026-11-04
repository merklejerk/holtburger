import {
	resolvedJumpFixture,
	predictedJumpFixture,
} from "../../client/client-precise-jump-fixtures";
import {
	ClientLifecycleSession,
	type ClientLifecycleTransport,
} from "../../client/client-lifecycle-session";
import {
	ClientPreciseJumpSession,
	type ClientPreciseJumpSnapshot,
} from "../../client/client-precise-jump-session";
import {
	decodeClientPreciseJumpAimRequest,
	type ClientPreciseJumpAimRequest,
} from "../../client/client-host-contract";
import { landblockVector3 } from "../../lib/assets/ac-frame";

/** Exercise real browser timers and production correlation against a held synthetic host solve. */
export async function probeClientPreciseJump() {
	const handlers = new Map<string, (payload: unknown) => void>();
	const requests: Array<{
		request: ClientPreciseJumpAimRequest;
		atMs: number;
	}> = [];
	const snapshots: Array<{
		snapshot: ClientPreciseJumpSnapshot;
		atMs: number;
	}> = [];
	const commands: string[] = [];
	const transport: ClientLifecycleTransport = {
		async listen(event, handler) {
			handlers.set(event, handler);
			return () => {
				handlers.delete(event);
			};
		},
		async invoke(command, args) {
			commands.push(command);
			if (command === "set_client_precise_jump_aim") {
				if (typeof args !== "object" || args === null || !("request" in args))
					throw new Error("Aim transport omitted its request.");
				requests.push({
					request: decodeClientPreciseJumpAimRequest(args.request),
					atMs: performance.now(),
				});
			}
			return undefined;
		},
	};
	const lifecycle = new ClientLifecycleSession(transport);
	await lifecycle.start();
	const errors: unknown[] = [];
	const precise = new ClientPreciseJumpSession(lifecycle, (error) =>
		errors.push(error),
	);
	const unsubscribe = precise.subscribe((snapshot) =>
		snapshots.push({ snapshot, atMs: performance.now() }),
	);
	const emit = (payload: unknown) =>
		handlers.get("client-precise-jump-evaluation")?.(payload);
	const camera = { cameraGeneration: 2, playerGuid: 1, entityGeneration: 1 };
	const ray = {
		camera,
		anchor: 0xda55ffff,
		start: landblockVector3([120, 96, 24]),
		direction: [0, 0, -1] as const,
		maximumDistance: 80,
		previousCell: null,
	};
	const resolved = (request: ClientPreciseJumpAimRequest) =>
		resolvedJumpFixture(request.camera, request.sequence, request.power);
	const completed = (request: ClientPreciseJumpAimRequest) =>
		predictedJumpFixture(resolved(request), "miss");
	const require = (condition: boolean, message: string) => {
		if (!condition) throw new Error(`Precise-jump browser probe: ${message}`);
	};
	const waitForRequests = async (count: number) => {
		const deadline = performance.now() + 2_000;
		while (requests.length < count) {
			if (performance.now() >= deadline)
				throw new Error("Latest aim was starved behind the held solve.");
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		}
	};
	try {
		precise.enter();
		precise.aim(ray);
		await waitForRequests(1);
		const first = requests[0].request;
		emit(resolved(first));
		require(precise.snapshot().marker?.phase ===
			"launch-resolved", "picked target was not published");
		require(precise.snapshot().active, "early launch feedback left targeting");
		precise.aim({ ...ray, maximumDistance: 70 });
		precise.aim({ ...ray, maximumDistance: 60 });
		require(precise.snapshot().marker ===
			null, "replacement kept obsolete launch presentation");
		await waitForRequests(2);
		const latest = requests[1].request;
		require(latest.maximumDistance ===
			60, "pointer history was queued instead of coalesced");
		emit(completed(first));
		require(precise.snapshot().marker ===
			null, "obsolete completion replaced current pending input");
		emit(resolved(latest));
		emit(completed(latest));
		require(precise.snapshot().marker?.phase ===
			"completed", "latest settled solve was not usable");
		emit(resolved(latest));
		require(precise.snapshot().marker?.phase ===
			"completed", "late progress regressed a completed result");
		require(precise.activate(), "selected miss did not authorize activation");
		require(commands.filter(
			(command) => command === "commit_client_precise_jump",
		).length === 1, "commit was duplicated");
		handlers.get("client-precise-jump-transaction-feedback")?.({
			sequence: 1,
			outcome: { kind: "committed" },
		});
		precise.enter();
		precise.adjustPower(precise.power() <= 0.5 ? 2 : -2);
		precise.aim(ray);
		await waitForRequests(3);
		const early = requests[2].request;
		emit(resolved(early));
		require(precise.activate(), "resolved launch required collision completion");
		require(commands.filter(
			(command) => command === "commit_client_precise_jump",
		).length === 2, "early launch did not commit once");
		const submitted = snapshots.filter(
			({ snapshot }) => snapshot.marker !== null,
		);
		require(errors.length === 0, "transport errors occurred");
		return {
			passed: true,
			requests: requests.map(({ request, atMs }) => ({
				sequence: request.sequence,
				atMs,
			})),
			publications: submitted.map(({ snapshot, atMs }) => ({
				phase: snapshot.marker?.phase,
				atMs,
			})),
			coalescedReplacement: latest.maximumDistance,
		};
	} finally {
		unsubscribe();
		precise.destroy();
		lifecycle.stop();
	}
}

import { describe, expect, it } from "vitest";
import { Mat4, Vec3 } from "../math/types";
import type { SceneSpatialPlacement } from "../scene";
import {
	LocalSceneModelHandle,
	type LocalSceneModelPort,
	type LocalSceneModelSource,
	type PreparedLocalSceneModel,
} from "./local-scene-model";

function deferred<T>() {
	let resolve: (value: T) => void = () => {
		throw new Error("Deferred request has not initialized");
	};
	let reject: (cause: unknown) => void = () => {
		throw new Error("Deferred request has not initialized");
	};
	const promise = new Promise<T>((accept, fail) => {
		resolve = accept;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function source(setupDid: number): LocalSceneModelSource {
	return {
		body: {
			setupDid,
			appearance: {
				paletteDid: null,
				subPalettes: [],
				textureChanges: [],
				partChanges: [],
			},
			scale: 1,
			translucency: 0,
			pose: { kind: "setup-pose" },
		},
		attachments: [],
	};
}

function placement(x: number): SceneSpatialPlacement {
	return {
		landblockId: "0x0001ffff",
		envCellId: null,
		localTransform: Object.assign(Mat4.identity(), { m41: x }),
		spatialMembership: { scopes: [{ kind: "outdoor" }] },
	};
}

function fixture() {
	type Preparation = ReturnType<typeof deferred<PreparedLocalSceneModel>> & {
		source: LocalSceneModelSource;
	};
	const requests: Preparation[] = [];
	const waiting = new Map<number, (request: Preparation) => void>();
	const commits: {
		label: string;
		placement: SceneSpatialPlacement;
		visible: boolean;
	}[] = [];
	const releases: string[] = [];
	let installed: string | null = null;
	let withdrawals = 0;
	const visibility: boolean[] = [];
	const port: LocalSceneModelPort = {
		prepare: (source) => {
			const request = { ...deferred<PreparedLocalSceneModel>(), source };
			const index = requests.push(request) - 1;
			waiting.get(index)?.(request);
			waiting.delete(index);
			return request.promise;
		},
		setPlacement: () => {},
		setVisible: (visible) => visibility.push(visible),
		withdraw: () => {
			withdrawals++;
			installed = null;
		},
	};
	const handle = new LocalSceneModelHandle(port, placement(0), () => {});
	return {
		handle,
		requests,
		commits,
		releases,
		visibility,
		installed: () => installed,
		withdrawals: () => withdrawals,
		request: (index: number): Promise<Preparation> => {
			const request = requests[index];
			return request === undefined
				? new Promise((resolve) => waiting.set(index, resolve))
				: Promise.resolve(request);
		},
		prepared: (label: string): PreparedLocalSceneModel => ({
			fit: { center: Vec3.zero(), supportPoints: Float32Array.of(0, 0, 0) },
			commit: (placement, visible) => {
				installed = label;
				commits.push({ label, placement, visible });
			},
			release: () => releases.push(label),
		}),
	};
}

describe("local scene model source ownership", () => {
	it("prepares at most one request while coalescing edits to the latest source", async () => {
		const f = fixture();
		const first = f.handle.replace("creator", source(1));
		const middle = f.handle.replace("creator", source(2));
		const latest = f.handle.replace("creator", source(3));
		expect(await first).toEqual({ kind: "superseded" });
		expect(await middle).toEqual({ kind: "superseded" });
		expect(f.requests).toHaveLength(1);
		(await f.request(0)).resolve(f.prepared("obsolete"));
		const next = await f.request(1);
		expect(next.source.body.setupDid).toBe(3);
		next.resolve(f.prepared("latest"));
		expect(await latest).toEqual({ kind: "installed" });
		expect(f.commits.map((entry) => entry.label)).toEqual(["latest"]);
		expect(f.releases).toEqual(["obsolete", "latest"]);
		await f.handle.destroy();
	});

	it("keeps the last-good same-subject visual on preparation failure, but withdraws immediately on identity change", async () => {
		const f = fixture();
		const initial = f.handle.replace("A", source(1));
		(await f.request(0)).resolve(f.prepared("A"));
		await initial;
		const edit = f.handle.replace("A", source(2));
		expect(f.handle.status()).toMatchObject({
			kind: "ready",
			subjectId: "A",
			replacement: { kind: "loading" },
		});
		(await f.request(1)).reject(new Error("Missing child asset"));
		expect(await edit).toEqual({
			kind: "failed",
			message: "Missing child asset",
		});
		expect(f.installed()).toBe("A");
		expect(f.handle.status()).toMatchObject({
			kind: "ready",
			replacement: { kind: "failed" },
		});
		const other = f.handle.replace("B", source(3));
		expect(f.installed()).toBeNull();
		expect(f.withdrawals()).toBe(1);
		(await f.request(2)).resolve(f.prepared("B"));
		await other;
		expect(f.installed()).toBe("B");
		await f.handle.destroy();
	});

	it("commits using the latest placement and visibility without publishing hot UI status", async () => {
		const f = fixture();
		const statuses: string[] = [];
		f.handle.subscribe((status) => statuses.push(status.kind));
		const result = f.handle.replace("creator", source(1));
		const moved = placement(12);
		f.handle.setPlacement(moved);
		f.handle.setVisible(false);
		(await f.request(0)).resolve(f.prepared("body"));
		await result;
		expect(f.commits).toEqual([
			{ label: "body", placement: moved, visible: false },
		]);
		f.handle.setVisible(true);
		f.handle.setPlacement(placement(13));
		expect(f.requests).toHaveLength(1);
		expect(statuses).toEqual(["empty", "loading", "ready"]);
		expect(f.visibility).toEqual([false, true]);
		await f.handle.destroy();
	});

	it("joins late preparation on destroy and cannot resurrect a withdrawn subject", async () => {
		const f = fixture();
		const result = f.handle.replace("A", source(1));
		const retirement = f.handle.destroy();
		expect(await result).toEqual({ kind: "superseded" });
		expect(f.handle.status()).toEqual({ kind: "empty" });
		(await f.request(0)).resolve(f.prepared("late"));
		await retirement;
		expect(f.commits).toEqual([]);
		expect(f.releases).toEqual(["late"]);
		expect(f.installed()).toBeNull();
		expect(() => f.handle.replace("B", source(2))).toThrow(
			"retired local scene model",
		);
	});

	it("reports stale-work cleanup failure and rejects joined retirement instead of swallowing it", async () => {
		const f = fixture();
		const obsolete = f.handle.replace("A", source(1));
		const latest = f.handle.replace("A", source(2));
		const prepared = f.prepared("broken");
		(await f.request(0)).resolve({
			...prepared,
			release: () => {
				throw new Error("Synthetic staged release failure");
			},
		});
		expect(await obsolete).toEqual({ kind: "superseded" });
		expect(await latest).toEqual({
			kind: "failed",
			message: "Synthetic staged release failure",
		});
		expect(f.handle.status()).toMatchObject({ kind: "failed", subjectId: "A" });
		await expect(f.handle.destroy()).rejects.toThrow(AggregateError);
	});
});

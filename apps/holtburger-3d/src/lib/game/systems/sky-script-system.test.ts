import { describe, expect, it, vi } from "vitest";
import {
	SkyScriptSystem,
	type SkyScriptSystemDependencies,
} from "./sky-script-system";
import { clientEnvironmentFixture } from "../../../client/client-environment.test-support";
import { resolveSceneEnvironment } from "../environment/scene-environment";

function fixture() {
	const environment = resolveSceneEnvironment(clientEnvironmentFixture(), {
		dayIndex: 0,
		timeOfDay: 0.5,
		dayGroupOverride: 0,
	});
	if (environment.sky === null) throw new Error("Fixture must author a sky");
	const sky = {
		...environment.sky,
		objects: environment.sky.objects.map((object) => ({
			...object,
			particleEffectId: "0x33000001",
		})),
	};
	const release = vi.fn();
	const dependencies: SkyScriptSystemDependencies = {
		onFailure: vi.fn(),
		acquireClosure: async () => ({
			rootId: "0x33000001",
			scripts: new Map(),
			release,
		}),
		acquireEmitter: async () => {
			throw new Error("Fixture script has no emitters");
		},
		installMeshes: vi.fn(async () => {}),
		installScript: vi.fn(),
		removeScript: vi.fn(),
		registerTarget: vi.fn(),
		unregisterTarget: vi.fn(),
		viewerOrigin: () => {
			throw new Error("Retired target must not resolve a position");
		},
		clock: () => 0,
	};
	return { sky, release, dependencies };
}

describe("SkyScriptSystem retirement", () => {
	it("drains borrowed mesh installation before releasing assets without activating stale targets", async () => {
		const { sky, release, dependencies } = fixture();
		let finish: (() => void) | undefined;
		let started: (() => void) | undefined;
		const installing = new Promise<void>((resolve) => {
			started = resolve;
		});
		const system = new SkyScriptSystem({
			...dependencies,
			installMeshes: () =>
				new Promise<void>((resolve) => {
					finish = resolve;
					started?.();
				}),
		});
		system.sync(sky, true);
		await installing;
		let retired = false;
		const retirement = system.destroy().then(() => {
			retired = true;
		});
		await Promise.resolve();
		expect(retired).toBe(false);
		if (finish === undefined) throw new Error("Mesh preparation did not start");
		finish();
		await retirement;
		expect(release).toHaveBeenCalledOnce();
		expect(dependencies.installScript).not.toHaveBeenCalled();
		expect(dependencies.registerTarget).not.toHaveBeenCalled();
	});

	it("retries closure preparation after a failed acquisition", async () => {
		const { sky, release, dependencies } = fixture();
		const acquireClosure = vi
			.fn(dependencies.acquireClosure)
			.mockRejectedValueOnce(new Error("closure temporarily unavailable"));
		const onFailure = vi.fn();
		const system = new SkyScriptSystem({
			...dependencies,
			acquireClosure,
			onFailure,
		});
		system.sync(sky, true);
		await vi.waitFor(() => expect(onFailure).toHaveBeenCalled());
		system.sync(sky, true);
		await vi.waitFor(() => expect(system.activeCount).toBeGreaterThan(0));
		expect(acquireClosure).toHaveBeenCalledTimes(2);
		await system.destroy();
		expect(release).toHaveBeenCalledOnce();
	});

	it("reports asynchronous preparation failure through the runtime error port", async () => {
		const { sky, release, dependencies } = fixture();
		const failure = new Error("mesh preparation failed");
		let report: (() => void) | undefined;
		const reported = new Promise<void>((resolve) => {
			report = resolve;
		});
		const onFailure = vi.fn(() => report?.());
		const system = new SkyScriptSystem({
			...dependencies,
			onFailure,
			installMeshes: async () => {
				throw failure;
			},
		});
		system.sync(sky, true);
		await reported;
		expect(onFailure).toHaveBeenCalledWith(failure);
		expect(release).toHaveBeenCalledOnce();
		await system.destroy();
	});
});

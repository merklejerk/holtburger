import { mount, tick, unmount } from "svelte";
import PerformanceSurfaceHarness from "./PerformanceSurfaceHarness.svelte";
import {
	RENDERER_CPU_PHASES,
	RENDERER_GPU_SYSTEMS,
	type RendererFrameDiagnosticsSnapshot,
} from "../../lib/game/renderer/renderer";

function assertBucketSum<K extends string>(
	keys: readonly K[],
	values: Readonly<Record<K, number>>,
	total: number,
	label: string,
): void {
	let sum = 0;
	for (const key of keys) {
		const value = values[key];
		if (!Number.isFinite(value) || value < 0)
			throw new Error(`Invalid ${label} timing: ${key}`);
		sum += value;
	}
	if (Math.abs(sum - total) > 1e-6)
		throw new Error(`${label} timings do not sum to the measured total.`);
}

/** Exercise CPU phase and measured/unsupported GPU diagnostics in the production panels. */
export async function probeGpuSurfaces(
	diagnostics: RendererFrameDiagnosticsSnapshot,
): Promise<{
	observed: { passed: true; modes: string[] };
	unsupported: { passed: true; modes: string[] };
}> {
	const profile = diagnostics.profile;
	if (!profile)
		throw new Error("A renderer profile is required for capability coverage.");
	for (const [phases, total] of [
		[profile.cpu.latestPhaseMs, profile.cpu.latestMs],
		[profile.cpu.meanPhaseMs, profile.cpu.meanMs],
	] as const) {
		assertBucketSum(RENDERER_CPU_PHASES, phases, total, "CPU phase");
	}
	const gpu = profile.gpu;
	if (gpu.kind === "available") {
		for (const [systems, total] of [
			[gpu.latestSystemMs, gpu.latestMs],
			[gpu.meanSystemMs, gpu.meanMs],
		] as const) {
			assertBucketSum(RENDERER_GPU_SYSTEMS, systems, total, "GPU system");
		}
	}
	return {
		observed: await probe(diagnostics),
		unsupported: await probe({
			...diagnostics,
			profile: { ...profile, gpu: { kind: "unsupported" } },
		}),
	};
}

/** Each isolated mount owns its synthetic sessions and retires them on cleanup. */
async function probe(
	diagnostics: RendererFrameDiagnosticsSnapshot,
): Promise<{ passed: true; modes: string[] }> {
	const target = document.createElement("div");
	document.body.append(target);
	const component = mount(PerformanceSurfaceHarness, {
		target,
		props: { diagnostics },
	});
	try {
		await tick();
		return await component.probe();
	} finally {
		await unmount(component);
		target.remove();
	}
}

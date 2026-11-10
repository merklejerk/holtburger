import { mount, tick, unmount } from "svelte";
import PerformanceSurfaceHarness from "./PerformanceSurfaceHarness.svelte";
import type { RendererFrameDiagnosticsSnapshot } from "../../lib/game/renderer/renderer";

/** Exercise the unsupported-device presentation using real diagnostic facts, not invented metrics. */
export async function probeUnsupportedGpuSurfaces(
	diagnostics: RendererFrameDiagnosticsSnapshot,
): Promise<{ passed: true; modes: string[] }> {
	if (!diagnostics.profile)
		throw new Error("A renderer profile is required for capability coverage.");
	const target = document.createElement("div");
	document.body.append(target);
	const component = mount(PerformanceSurfaceHarness, {
		target,
		props: {
			diagnostics: {
				...diagnostics,
				profile: { ...diagnostics.profile, gpu: { kind: "unsupported" } },
			},
		},
	});
	try {
		await tick();
		return await component.probe();
	} finally {
		await unmount(component);
		target.remove();
	}
}

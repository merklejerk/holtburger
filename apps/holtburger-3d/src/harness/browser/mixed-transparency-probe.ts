import type { GamePresentationRuntime } from "../../lib/game/runtime/game-presentation-runtime";
import type { DynamicEntityView } from "../../lib/game/runtime/dynamic-entity-feed";
import type { FrameSettings } from "../../lib/game/renderer/renderer";
import { SYNTHETIC_BLEND_PALETTE_BASE } from "./synthetic-nameplate-workload";
import { SHARED_FRONTEND_TUNING } from "../../lib/frontend-tuning";

/** Compare production static/dynamic composition with independently captured single layers. */
export async function probeMixedTransparency(
	runtime: GamePresentationRuntime,
	current: DynamicEntityView,
	canvas: HTMLCanvasElement,
	settings: FrameSettings,
) {
	if (current.placement.kind !== "world")
		throw new Error("Mixed fixture needs a world entity.");
	const placement = current.placement;
	// occlusion-open places its sole root eight metres forward of the harness camera.
	const cameraY = placement.pose.coords.y - 8;
	const nearDistance =
		SHARED_FRONTEND_TUNING.rendering.transparentObjects.nearDistance;
	const staticsAreFar = 120 - cameraY > nearDistance;
	const readback = document.createElement("canvas");
	readback.width = canvas.width;
	readback.height = canvas.height;
	const context = readback.getContext("2d");
	if (context === null) throw new Error("Mixed fixture needs pixel readback.");
	const capture = async (buildings: boolean, hidden: boolean, y: number) => {
		runtime.setFrameSettings({
			...settings,
			distanceFogEnabled: false,
			colorGrade: { ...settings.colorGrade, enabled: false },
			layerVisibility: {
				...settings.layerVisibility,
				buildings,
				terrain: false,
			},
		});
		const entity: DynamicEntityView = {
			...current,
			physics: { ...current.physics, translucency: hidden ? 1 : 0 },
			placement: {
				...placement,
				pose: { ...placement.pose, coords: { ...placement.pose.coords, y } },
			},
			presentation: {
				...current.presentation,
				appearance: {
					...current.presentation.appearance,
					paletteDid: SYNTHETIC_BLEND_PALETTE_BASE + 0x100,
				},
			},
		};
		if ((await runtime.upsertDynamicEntity(entity)) !== "installed")
			throw new Error("Mixed fixture appearance was not installed.");
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
		);
		context.drawImage(canvas, 0, 0);
		const diagnostics = runtime.getRendererFrameDiagnostics();
		if (diagnostics === null)
			throw new Error("Mixed fixture lacks diagnostics.");
		if (
			diagnostics.selectionMetrics.envCellRenderMode !==
			settings.envCellRenderMode
		)
			throw new Error("Mixed fixture captured the wrong renderer mode.");
		return {
			pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
			image: canvas.toDataURL("image/png"),
			metrics: diagnostics.selectionMetrics,
		};
	};
	try {
		// The blended building fixture's second triangle is centered at local (89.5, 2.5, -120).
		const background = await capture(false, true, 118);
		const staticOnly = await capture(true, true, 118);
		const results = [];
		for (const y of [118, 122, 120 + nearDistance]) {
			const dynamicOnly = await capture(false, false, y);
			const mixed = await capture(true, false, y);
			const offset =
				(Math.floor(canvas.height / 2) * canvas.width +
					Math.floor(canvas.width / 2)) *
				4;
			const rgb = (pixels: Uint8ClampedArray) => [
				...pixels.slice(offset, offset + 3),
			];
			const bg = rgb(background.pixels),
				stat = rgb(staticOnly.pixels),
				dyn = rgb(dynamicOnly.pixels),
				actual = rgb(mixed.pixels);
			if (
				dyn.every((v, c) => Math.abs(v - bg[c]) < 5) ||
				stat.every((v, c) => Math.abs(v - bg[c]) < 5)
			)
				throw new Error("Mixed fixture center must cover both layers.");
			const staticOverDynamic = stat.map((v, c) =>
				Math.round(v + 0.5 * (dyn[c] - bg[c])),
			);
			const dynamicOverStatic = dyn.map((v, c) =>
				Math.round(v + 0.75 * (stat[c] - bg[c])),
			);
			// Far static cohorts precede the appended dynamic cohort; only near ranges depth-sort.
			const expected =
				staticsAreFar || y < 120 ? dynamicOverStatic : staticOverDynamic;
			if (actual.some((v, c) => Math.abs(v - expected[c]) > 2))
				throw new Error(
					`Mixed y=${y}: actual=${actual}, expected=${expected}, static-over=${staticOverDynamic}, dynamic-over=${dynamicOverStatic}.`,
				);
			const expectedFar =
				(staticsAreFar ? 3 : 0) + Number(y - cameraY > nearDistance);
			if (
				mixed.metrics.submittedDynamicDrawCount !== 1 ||
				mixed.metrics.submittedStaticObjectDrawCount !== 6 ||
				mixed.metrics.submittedTransparentObjectDrawCount !== 4 ||
				mixed.metrics.submittedAdditiveObjectDrawCount !== 3 ||
				mixed.metrics.farTransparentObjectCandidateCount !== expectedFar ||
				mixed.metrics.nearTransparentObjectCandidateCount !== 4 - expectedFar
			)
				throw new Error(
					"Mixed fixture lost geometry or routed an incorrect near/far population.",
				);
			results.push({
				y,
				actual,
				expected,
				staticOverDynamic,
				dynamicOverStatic,
				image: mixed.image,
				metrics: mixed.metrics,
			});
		}
		return { results };
	} finally {
		await runtime.upsertDynamicEntity(current);
		runtime.setFrameSettings(settings);
	}
}

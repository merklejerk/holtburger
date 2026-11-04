import type { GamePresentationRuntime } from "../../lib/game/runtime/game-presentation-runtime";
import type { DynamicEntityView } from "../../lib/game/runtime/dynamic-entity-feed";
import type { FrameSettings } from "../../lib/game/renderer/renderer";
import { SYNTHETIC_BLEND_PALETTE_BASE } from "./synthetic-nameplate-workload";
import {
	CUTOUT_PALETTE,
	CUTOUT_REFERENCE_PALETTE,
} from "./synthetic-cutout-texture";

/** Verify actual merged color routing against independent fixed-function blend equations. */
export async function probeDynamicBlendFlags(
	runtime: GamePresentationRuntime,
	current: DynamicEntityView,
	canvas: HTMLCanvasElement,
	settings: FrameSettings,
) {
	const readback = document.createElement("canvas");
	readback.width = canvas.width;
	readback.height = canvas.height;
	const context = readback.getContext("2d");
	if (context === null)
		throw new Error("Blend probe requires canvas readback.");
	const capture = async (paletteDid: number, hidden: boolean) => {
		const entity = {
			...current,
			physics: { ...current.physics, translucency: hidden ? 1 : 0 },
			presentation: {
				...current.presentation,
				appearance: {
					...current.presentation.appearance,
					paletteDid,
				},
			},
		};
		if ((await runtime.upsertDynamicEntity(entity)) !== "installed")
			throw new Error("Blend fixture appearance was not installed.");
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
		);
		context.drawImage(canvas, 0, 0);
		const diagnostics = runtime.getRendererFrameDiagnostics();
		if (diagnostics === null)
			throw new Error("Blend probe lacks frame diagnostics.");
		if (
			diagnostics.selectionMetrics.envCellRenderMode !==
			settings.envCellRenderMode
		)
			throw new Error("Blend probe captured the wrong renderer mode.");
		return {
			pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
			image: canvas.toDataURL("image/png"),
			draws: diagnostics.selectionMetrics.submittedDynamicDrawCount,
			transparent:
				diagnostics.selectionMetrics.submittedTransparentObjectDrawCount,
			additive: diagnostics.selectionMetrics.submittedAdditiveObjectDrawCount,
		};
	};
	try {
		runtime.setFrameSettings({
			...settings,
			quality: { ...settings.quality, textureFiltering: "nearest" },
			distanceFogEnabled: false,
			colorGrade: { ...settings.colorGrade, enabled: false },
		});
		const background = await capture(SYNTHETIC_BLEND_PALETTE_BASE, true);
		const opaque = await capture(SYNTHETIC_BLEND_PALETTE_BASE, false);
		// Choose a covered pixel independently from the camera's screen projection; exclude labels.
		let offset = -1;
		let difference = 0;
		for (let i = 0; i < opaque.pixels.length; i += 4) {
			const delta = Math.abs(opaque.pixels[i + 2] - background.pixels[i + 2]);
			if (delta > difference) {
				difference = delta;
				offset = i;
			}
		}
		if (
			offset < 0 ||
			difference < 20 ||
			opaque.draws !== 1 ||
			background.draws !== 0
		)
			throw new Error(
				"Blend fixture needs exactly one visible dynamic triangle.",
			);
		const source = [...opaque.pixels.slice(offset, offset + 3)];
		const destination = [...background.pixels.slice(offset, offset + 3)];
		const results = [];
		for (const [flags, sourceFactor, destinationFactor] of [
			[0x10, 0.25, 0.75],
			[0x100, 0.25, 0.75],
			[0x200, 0.75, 0.25],
			[0x10000, 1, 1],
			[0x10100, 0.25, 1],
			[0x10200, 0.75, 1],
		] as const) {
			const sample = await capture(SYNTHETIC_BLEND_PALETTE_BASE + flags, false);
			const actual = [...sample.pixels.slice(offset, offset + 3)];
			const expected = source.map((value, channel) =>
				Math.min(
					255,
					Math.round(
						value * sourceFactor + destination[channel] * destinationFactor,
					),
				),
			);
			const additive = (flags & 0x10000) !== 0;
			if (
				sample.draws !== 1 ||
				sample.additive !== Number(additive) ||
				sample.transparent !== Number(!additive)
			)
				throw new Error(
					`Blend flags ${flags}: wrong production phase routing.`,
				);
			if (
				actual.some((value, channel) => Math.abs(value - expected[channel]) > 2)
			)
				throw new Error(
					`Blend flags ${flags}: pixel ${actual} differs from ${expected}; source=${source}, background=${destination}.`,
				);
			results.push({ flags, actual, expected, image: sample.image });
		}
		const reference = await capture(CUTOUT_REFERENCE_PALETTE, false);
		const cutout = await capture(CUTOUT_PALETTE, false);
		let retainedPixels = 0;
		let holePixels = 0;
		// Compare only solid-reference interiors; edges and labels are not texture evidence.
		for (let i = 0; i < reference.pixels.length; i += 4) {
			if (
				!source.every(
					(value, channel) => reference.pixels[i + channel] === value,
				)
			)
				continue;
			if (
				source.every(
					(value, channel) => background.pixels[i + channel] === value,
				)
			)
				continue;
			if (
				source.every((value, channel) => cutout.pixels[i + channel] === value)
			)
				retainedPixels++;
			else if (
				source.every(
					(_, channel) =>
						cutout.pixels[i + channel] === background.pixels[i + channel],
				)
			)
				holePixels++;
			else
				throw new Error(
					`Cutout pixel ${i / 4} is neither opaque source nor background.`,
				);
		}
		if (
			reference.draws !== 1 ||
			cutout.draws !== 1 ||
			cutout.transparent !== 0 ||
			cutout.additive !== 0 ||
			retainedPixels < 100 ||
			holePixels < 100
		)
			throw new Error(
				`Cutout needs one alpha-test draw with substantial solid and hole regions: retained=${retainedPixels}, holes=${holePixels}, draws=${cutout.draws}, transparent=${cutout.transparent}, additive=${cutout.additive}.`,
			);
		return {
			cutout: {
				retainedPixels,
				holePixels,
				referenceImage: reference.image,
				image: cutout.image,
			},
			mode: settings.envCellRenderMode,
			source,
			destination,
			pixel: [
				(offset / 4) % canvas.width,
				Math.floor(offset / 4 / canvas.width),
			],
			results,
		};
	} finally {
		await runtime.upsertDynamicEntity(current);
		runtime.setFrameSettings(settings);
	}
}

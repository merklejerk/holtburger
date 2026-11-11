import type { GamePresentationRuntime } from "../../lib/game/runtime/game-presentation-runtime";
import type { DynamicEntityView } from "../../lib/game/runtime/dynamic-entity-feed";
import { cellId } from "../../lib/game/runtime/dynamic-entity-feed";
import type { FrameSettings } from "../../lib/game/renderer/renderer";
import { SYNTHETIC_BLEND_PALETTE_BASE } from "./synthetic-nameplate-workload";

/** Verify admission scopes do not multiply entity color draws or alter admitted mesh pixels. */
export async function probeDynamicDomains(
	runtime: GamePresentationRuntime,
	current: DynamicEntityView,
	canvas: HTMLCanvasElement,
	settings: FrameSettings,
) {
	if (
		current.placement.kind !== "world" ||
		settings.envCellRenderMode !== "portal"
	)
		throw new Error("Domain probe requires a portal-mode world entity.");
	const placement = current.placement;
	const membership = placement.spatialMembership;
	if (!membership.reachesOutdoors || membership.reachedEnvCellIds.length !== 1)
		throw new Error(
			"Domain probe requires one interior and outdoor membership.",
		);
	const readback = document.createElement("canvas");
	readback.width = canvas.width;
	readback.height = canvas.height;
	const context = readback.getContext("2d");
	if (context === null)
		throw new Error("Domain probe requires pixel readback.");
	const capture = async (
		domain: "interior" | "outdoor" | "plural",
		flags: number,
		hidden: boolean,
	) => {
		const entity: DynamicEntityView = {
			...current,
			placement: {
				...placement,
				// Membership must include its resident scope; change only cell authority, not the pose.
				pose: {
					...placement.pose,
					landblockId:
						domain === "outdoor"
							? cellId(((placement.pose.landblockId & 0xffff0000) | 1) >>> 0)
							: placement.pose.landblockId,
				},
				spatialMembership: {
					reachesOutdoors: domain !== "interior",
					reachedEnvCellIds:
						domain === "outdoor" ? [] : membership.reachedEnvCellIds,
				},
			},
			physics: { ...current.physics, translucency: hidden ? 1 : 0 },
			presentation: {
				...current.presentation,
				appearance: {
					...current.presentation.appearance,
					paletteDid: SYNTHETIC_BLEND_PALETTE_BASE + flags,
				},
			},
		};
		if ((await runtime.upsertDynamicEntity(entity)) !== "installed")
			throw new Error("Domain appearance was not installed.");
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
		);
		context.drawImage(canvas, 0, 0);
		const diagnostics = runtime.getRendererFrameDiagnostics();
		if (
			diagnostics === null ||
			diagnostics.selectionMetrics.envCellRenderMode !== "portal"
		)
			throw new Error("Domain capture is missing portal diagnostics.");
		return {
			pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
			image: canvas.toDataURL("image/png"),
			metrics: diagnostics.selectionMetrics,
			nameplates: diagnostics.nameplates,
			poseBytes: diagnostics.dynamicResources.poses.uploadedBytes,
		};
	};
	try {
		runtime.setFrameSettings({
			...settings,
			// The opaque reference identifies source color; AO would darken that mask but not blends.
			ambientOcclusion: { ...settings.ambientOcclusion, enabled: false },
			distanceFogEnabled: false,
			colorGrade: { ...settings.colorGrade, enabled: false },
		});
		const background = await capture("plural", 0, true);
		const opaque = await capture("plural", 0, false);
		const offsets: number[] = [];
		// The emissive solid reference identifies actor interiors without camera projection guesses.
		for (let i = 0; i < opaque.pixels.length; i += 4)
			if (
				[51, 102, 153].every((v, c) => opaque.pixels[i + c] === v) &&
				[51, 102, 153].some(
					(v, c) => Math.abs(background.pixels[i + c] - v) > 10,
				)
			)
				offsets.push(i);
		if (offsets.length < 100)
			throw new Error(
				`Domain fixture lacks reference coverage: ${offsets.length} pixels.`,
			);
		const results = [];
		for (const flags of [0, 0x10, 0x100, 0x200, 0x10000]) {
			const interior = await capture("interior", flags, false);
			const outdoor = await capture("outdoor", flags, false);
			const plural = await capture("plural", flags, false);
			const draws = (sample: typeof plural) =>
				sample.metrics.submittedDynamicDrawCount -
				background.metrics.submittedDynamicDrawCount;
			if (
				draws(interior) !== 1 ||
				draws(outdoor) !== 1 ||
				draws(plural) !== 1 ||
				interior.poseBytes !== plural.poseBytes ||
				outdoor.poseBytes !== plural.poseBytes
			)
				throw new Error("Domain draw/pose union is incorrect.");
			const transparentDraws = flags !== 0 && flags !== 0x10000 ? 1 : 0;
			const additiveDraws = flags === 0x10000 ? 1 : 0;
			if (
				plural.metrics.submittedTransparentObjectDrawCount -
					background.metrics.submittedTransparentObjectDrawCount !==
					transparentDraws ||
				plural.metrics.submittedAdditiveObjectDrawCount -
					background.metrics.submittedAdditiveObjectDrawCount !==
					additiveDraws
			)
				throw new Error("Plural material reached the wrong color phase.");
			let interiorPixels = 0,
				outdoorPixels = 0;
			for (const offset of offsets) {
				const matches = (sample: typeof plural) =>
					[0, 1, 2].every(
						(c) =>
							Math.abs(plural.pixels[offset + c] - sample.pixels[offset + c]) <=
							2,
					);
				const matchesInterior = matches(interior),
					matchesOutdoor = matches(outdoor);
				if (!matchesInterior || !matchesOutdoor)
					throw new Error(
						`Plural flags ${flags} pixel ${offset / 4} differs from an admitted single-scope control: interior=${interior.pixels.slice(offset, offset + 3)}, outdoor=${outdoor.pixels.slice(offset, offset + 3)}, plural=${plural.pixels.slice(offset, offset + 3)}, background=${background.pixels.slice(offset, offset + 3)}.`,
					);
				if (matchesInterior) interiorPixels++;
				if (matchesOutdoor) outdoorPixels++;
			}
			results.push({
				flags,
				interiorPixels,
				outdoorPixels,
				checkedPixels: offsets.length,
				draws: [draws(interior), draws(outdoor), draws(plural)],
				poseBytes: plural.poseBytes,
				image: plural.image,
			});
		}
		const gl = canvas.getContext("webgl2");
		if (gl === null) throw new Error("Overlay probe requires WebGL2.");
		const draw = gl.drawArraysInstanced;
		const overlayDraws: {
			depthTest: boolean;
			scoped: boolean;
			instances: number;
		}[] = [];
		gl.drawArraysInstanced = function (mode, first, count, instances) {
			const program = gl.getParameter(
				gl.CURRENT_PROGRAM,
			) as WebGLProgram | null;
			if (
				program !== null &&
				gl.getUniformLocation(program, "uNameplateClipFromAnchor") !== null
			) {
				const scoped =
					gl.getUniformLocation(program, "uPortalRenderDomain") !== null;
				overlayDraws.push({
					depthTest: gl.isEnabled(gl.DEPTH_TEST),
					scoped,
					instances,
				});
			}
			draw.call(gl, mode, first, count, instances);
		};
		try {
			for (const treatment of ["selected", "hovered"] as const) {
				runtime.setSelectedEntityGuid(
					treatment === "selected" ? current.identity.guid : null,
				);
				runtime.setHoveredEntityGuid(
					treatment === "hovered" ? current.identity.guid : null,
				);
				overlayDraws.length = 0;
				const sample = await capture("plural", 0, false);
				if (
					sample.nameplates.submittedInstanceCount !== 1 ||
					overlayDraws.length === 0 ||
					overlayDraws.some(
						(sample) =>
							sample.depthTest || sample.scoped || sample.instances !== 1,
					)
				)
					throw new Error(
						`${treatment} label did not draw once per frame as an unscoped overlay.`,
					);
			}
		} finally {
			gl.drawArraysInstanced = draw;
			runtime.setSelectedEntityGuid(null);
			runtime.setHoveredEntityGuid(null);
		}
		return { results };
	} finally {
		await runtime.upsertDynamicEntity(current);
		runtime.setFrameSettings(settings);
	}
}

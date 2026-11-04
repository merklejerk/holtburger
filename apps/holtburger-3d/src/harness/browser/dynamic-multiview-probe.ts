import { createCameraRotationRadians } from "../../lib/game/math/camera-orientation";
import type {
	FrameInput,
	FrameViewInput,
} from "../../lib/game/renderer/renderer";
import type { WebGL2Renderer } from "../../lib/game/renderer/webgl2-renderer";

/** Capture a real runtime publication without changing its camera, tick, or renderer feedback. */
function nextFrame(renderer: WebGL2Renderer): Promise<FrameInput> {
	const draw = renderer.drawFrame;
	return new Promise((resolve, reject) => {
		const timeout = window.setTimeout(() => {
			renderer.drawFrame = draw;
			reject(new Error("Multi-view probe did not receive a runtime frame."));
		}, 5000);
		renderer.drawFrame = (input) => {
			renderer.drawFrame = draw;
			window.clearTimeout(timeout);
			try {
				const feedback = draw.call(renderer, input);
				resolve(input);
				return feedback;
			} catch (cause) {
				reject(cause);
				throw cause;
			}
		};
	});
}

/** Exercise retained per-view plans against one frozen real-world pose and particle publication. */
export async function probeDynamicViews(
	renderer: WebGL2Renderer,
	canvas: HTMLCanvasElement,
) {
	const input = await nextFrame(renderer);
	const first = input.views[0];
	if (
		first === undefined ||
		input.views.length !== 1 ||
		input.portalTransition !== undefined
	)
		throw new Error("Multi-view probe requires one ordinary runtime camera.");
	const second: FrameViewInput = {
		...first,
		camera: {
			...first.camera,
			placement: {
				...first.camera.placement,
				// Same authoritative cell/position, a different viewing direction; no residency guess.
				rotation: createCameraRotationRadians(Math.PI / 2, 0),
			},
		},
	};
	const results = [];
	try {
		for (const mode of ["flat", "portal"] as const) {
			const draw = (views: readonly FrameViewInput[]) => {
				const feedback = renderer.drawFrame({
					...input,
					views,
					frameSettings: { ...input.frameSettings, envCellRenderMode: mode },
				});
				const diagnostics = renderer.frameDiagnostics.snapshot();
				return {
					selected: [...feedback.selectedDynamicNodeIds].sort(),
					poseUploadBytes: diagnostics.dynamicResources.poses.uploadedBytes,
					dynamicDraws: diagnostics.selectionMetrics.submittedDynamicDrawCount,
					viewCount: diagnostics.selectionMetrics.viewCount,
					image: canvas.toDataURL("image/png"),
				};
			};
			const a = draw([first]);
			const b = draw([second]);
			const ab = draw([first, second]);
			const ba = draw([second, first]);
			const aa = draw([first, first]);
			const union = [...new Set([...a.selected, ...b.selected])].sort();
			if (a.image === b.image || a.dynamicDraws === 0 || b.dynamicDraws === 0)
				throw new Error(
					`${mode}: multi-view fixture needs distinct images with dynamic geometry in both.`,
				);
			if (JSON.stringify(a.selected) === JSON.stringify(b.selected))
				throw new Error(
					`${mode}: multi-view fixture must select different dynamic populations.`,
				);
			for (const combined of [ab, ba]) {
				if (combined.dynamicDraws !== a.dynamicDraws + b.dynamicDraws)
					throw new Error(
						`${mode}: multi-view submission omitted or duplicated a view's dynamic draws.`,
					);
				if (
					combined.viewCount !== 2 ||
					JSON.stringify(combined.selected) !== JSON.stringify(union)
				)
					throw new Error(
						`${mode}: multi-view feedback did not retain both selected populations.`,
					);
				if (
					combined.poseUploadBytes <
						Math.max(a.poseUploadBytes, b.poseUploadBytes) ||
					combined.poseUploadBytes > a.poseUploadBytes + b.poseUploadBytes
				)
					throw new Error(
						`${mode}: multi-view pose upload did not represent the selected union.`,
					);
			}
			if (ab.poseUploadBytes !== ba.poseUploadBytes)
				throw new Error(`${mode}: pose union changed with view order.`);
			if (ab.image !== b.image || ba.image !== a.image)
				throw new Error(
					`${mode}: retained multi-view plans changed standalone pixels.`,
				);
			if (
				aa.viewCount !== 2 ||
				aa.dynamicDraws !== 2 * a.dynamicDraws ||
				aa.poseUploadBytes !== a.poseUploadBytes ||
				aa.image !== a.image ||
				JSON.stringify(aa.selected) !== JSON.stringify(a.selected)
			)
				throw new Error(
					`${mode}: repeated camera duplicated pose uploads or changed publication.`,
				);
			results.push({ mode, a, b, ab, ba, aa });
		}
		return results;
	} finally {
		// Restore the original presentation synchronously; the live runtime camera was never edited.
		renderer.drawFrame(input);
	}
}

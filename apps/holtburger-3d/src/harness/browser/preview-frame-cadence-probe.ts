import {
	BACKGROUND_FRAME_INTERVAL_MS,
	startPresentationFrameLoop,
} from "../../app/presentation-frame-loop";
import type {
	ObjectPreviewHandle,
	ObjectPreviewViewport,
} from "../../lib/game/preview/object-preview-controller";

/** Exercise real browser scheduling and preview draws with controlled focus input. */
export async function probePreviewFrameCadence(
	preview: ObjectPreviewHandle,
	viewport: ObjectPreviewViewport,
) {
	const ownFocus = Object.getOwnPropertyDescriptor(document, "hasFocus");
	let focused = true;
	// An uncapped consumer exercises main-view cadence without claiming renderer work.
	let schedulerFrames = 0;
	Object.defineProperty(document, "hasFocus", {
		configurable: true,
		value: () => focused,
	});
	const stop = startPresentationFrameLoop(
		() => schedulerFrames++,
		() => 0,
	);
	const frameCount = (): number => {
		const diagnostics = preview.diagnostics();
		if (diagnostics === null)
			throw new Error("Cadence probe lost its preview.");
		return diagnostics.frameCount;
	};
	const sample = async () => {
		const initialPreview = frameCount();
		const initialScheduler = schedulerFrames;
		const startedAt = performance.now();
		await new Promise<void>((resolve) =>
			setTimeout(resolve, BACKGROUND_FRAME_INTERVAL_MS * 6),
		);
		return {
			elapsedMs: performance.now() - startedAt,
			previewFrames: frameCount() - initialPreview,
			schedulerFrames: schedulerFrames - initialScheduler,
		};
	};
	try {
		preview.setViewport(viewport);
		const foreground = await sample();
		if (foreground.previewFrames === 0 || foreground.schedulerFrames === 0)
			throw new Error("Focused presentation did not advance.");
		focused = false;
		const background = await sample();
		const maximumFrames =
			Math.floor(background.elapsedMs / BACKGROUND_FRAME_INTERVAL_MS) + 1;
		if (background.previewFrames > maximumFrames)
			throw new Error("Preview bypassed the background frame limit.");
		if (background.schedulerFrames > maximumFrames)
			throw new Error(
				"Scheduler callback bypassed the background frame limit.",
			);
		if (background.previewFrames === 0 || background.schedulerFrames === 0)
			throw new Error("Background presentation stopped advancing.");
		preview.setViewport(null);
		const hidden = await sample();
		if (hidden.previewFrames !== 0)
			throw new Error("Suspended preview continued drawing.");
		focused = true;
		preview.setViewport(viewport);
		const resumed = await sample();
		if (resumed.previewFrames === 0 || resumed.schedulerFrames === 0)
			throw new Error("Presentation did not resume after restoring focus.");
		return { foreground, background, hidden, resumed };
	} finally {
		stop();
		if (ownFocus === undefined) Reflect.deleteProperty(document, "hasFocus");
		else Object.defineProperty(document, "hasFocus", ownFocus);
	}
}

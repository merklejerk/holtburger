import { applyUiScale, uiLocalSize } from "../../app/ui-scale";
import { showUiDragGhost, positionUiDragGhost } from "../../app/ui-drag-ghost";

/** Numerical proof of Chromium's ordinary/top-layer sizing and measurement contract. */
export async function probeUiScaleBoundary() {
	const root = document.createElement("section");
	root.style.cssText = "position:fixed;inset:0;pointer-events:none";
	root.innerHTML = `<div data-box style="position:absolute;left:20px;top:30px;width:100px;height:50px"></div>
		<dialog style="box-sizing:border-box;width:min(200px,var(--ui-viewport-width));height:80px;padding:0;border:0;max-width:none;max-height:none"></dialog>
		<div popover="manual" style="position:fixed;inset:auto;left:20px;top:30px;width:60px;height:40px;margin:0;padding:0;border:0">
			<div popover="manual" style="position:fixed;inset:auto;left:80px;top:30px;width:40px;height:20px;margin:0;padding:0;border:0"></div>
		</div>`;
	document.body.append(root);
	// Both production drag owners host ghosts under the unscaled appearance/interaction root.
	const ghost = document.createElement("div");
	ghost.popover = "manual";
	ghost.style.cssText =
		"position:fixed;inset:0 auto auto 0;margin:0;padding:0;border:0;pointer-events:none";
	document.body.append(ghost);
	const scale = applyUiScale(root, 1);
	const box = root.querySelector<HTMLElement>("[data-box]");
	const modal = root.querySelector("dialog");
	const pops = root.querySelectorAll<HTMLElement>("[popover]");
	if (!box || !modal || pops.length !== 2)
		throw new Error("Missing UI scale boundary fixture");
	const close = (actual: number, expected: number, message: string) => {
		if (Math.abs(actual - expected) > 0.1)
			throw new Error(`${message}: ${actual} vs ${expected}`);
	};
	let observedWidth = 0;
	const observer = new ResizeObserver(([entry]) => {
		if (entry) observedWidth = entry.contentRect.width;
	});
	observer.observe(box);
	try {
		const samples = [];
		for (const value of [1, 1.25, 2]) {
			scale.update(value);
			ghost.style.setProperty("--ui-scale", String(value));
			modal.showModal();
			for (const pop of pops) pop.showPopover();
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			);
			const bounds = box.getBoundingClientRect();
			close(bounds.left, 20 * value, "UI point conversion");
			close(bounds.width, 100 * value, "UI length scaling");
			close(uiLocalSize(box).width, 100, "Logical UI measurement");
			close(
				observedWidth,
				100,
				"ResizeObserver must report logical dimensions",
			);
			close(box.offsetWidth, 100, "Offset measurement must remain local");
			showUiDragGhost(ghost, box, "Dragged artwork");
			positionUiDragGhost(ghost, { clientX: 80, clientY: 90 });
			const ghostBounds = ghost.getBoundingClientRect();
			close(
				ghostBounds.width,
				bounds.width,
				"Ghost must retain displayed source size",
			);
			close(ghostBounds.left, 80, "Ghost must follow browser pointer X");
			close(ghostBounds.top, 90, "Ghost must follow browser pointer Y");
			ghost.hidePopover();
			close(
				pops[1].getBoundingClientRect().width,
				40 * value,
				"Nested top-layer scale",
			);
			close(
				pops[1].getBoundingClientRect().left,
				80 * value,
				"Top-layer positioning units",
			);
			const modalBounds = modal.getBoundingClientRect();
			close(
				modalBounds.width,
				Math.min(200 * value, innerWidth),
				"Modal viewport constraint",
			);
			if (modalBounds.left < -0.1 || modalBounds.right > innerWidth + 0.1)
				throw new Error("Scaled native modal escaped viewport");
			samples.push({
				scale: value,
				boxWidth: bounds.width,
				modalWidth: modalBounds.width,
			});
			for (const pop of pops) pop.hidePopover();
			modal.close();
		}
		return samples;
	} finally {
		observer.disconnect();
		modal.close();
		ghost.remove();
		root.remove();
	}
}

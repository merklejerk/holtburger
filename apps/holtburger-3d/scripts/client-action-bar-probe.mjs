import { isolateHudProbe } from "./hud-probe-isolation.mjs";
import assert from "node:assert/strict";

/** Real pointer movement verifies peer snapping independently of inventory scenarios. */
export async function probeHudSnapping(client, evaluateExpression) {
	const { read, point, mouse, click, bounds } = actionBarProbeDriver(
		client,
		evaluateExpression,
	);
	const restore = await isolateHudProbe(read, "[data-action-bar-surface]");
	// Menus and rotation only arrange the fixture; movement below uses native pointer input.
	const clickControl = (selector) =>
		read(`document.querySelector(${JSON.stringify(selector)}).click()`);
	const menu = async (sequence, operation) => {
		await clickControl(`button[aria-label^="Action bar ${sequence} menu"]`);
		await read(`(() => {
			const button = [...document.querySelectorAll('[role="menu"]:popover-open button')]
				.find(button => button.textContent.trim() === ${JSON.stringify(operation)});
			if (!button) throw new Error('Missing action menu operation');
			button.click();
		})()`);
	};
	const assertNoOverlap = (rectangles) => {
		const [a, b] = rectangles;
		assert.ok(
			a.right <= b.left ||
				b.right <= a.left ||
				a.bottom <= b.top ||
				b.bottom <= a.top,
		);
	};
	try {
		const initiallyLocked = await read(
			`document.querySelector('button[aria-label="Unlock UI layout"]') !== null`,
		);
		if (initiallyLocked)
			await clickControl('button[aria-label="Unlock UI layout"]');
		const snapTuning = await read(
			`import('/src/client/client-tuning.ts').then(module => module.CLIENT_HUD_SNAP_TUNING)`,
		);
		const originalBounds = (await bounds())[0];
		const moveBar = async (sequence, left, top, verifySnap = null) => {
			const start = await point(
				`button[aria-label="Move Action bar ${sequence}"]`,
			);
			const before = (await bounds())[sequence - 1];
			const end = {
				x: start.x + left - before.left,
				y: start.y + top - before.top,
			};
			await mouse("mousePressed", start, 1);
			await mouse("mouseMoved", end, 1);
			if (verifySnap !== null) await verifySnap(end);
			await mouse("mouseReleased", end, 0);
		};
		await moveBar(1, 100, 140);
		await menu(1, "Clone");
		const fixed = (await bounds())[0];
		const attraction = snapTuning.distance / 2;
		await moveBar(
			2,
			fixed.left + attraction,
			fixed.bottom + snapTuning.gap + attraction,
			async (end) => {
				const snapped = (await bounds())[1];
				assert.equal(snapped.left, fixed.left, "Stack snaps matching edges");
				assert.equal(
					snapped.top,
					fixed.bottom + snapTuning.gap,
					"Stack snaps below peer",
				);
				// A second move within the SAME gesture must use raw pointer displacement.
				const release = snapTuning.distance * 3;
				end.x += release;
				end.y += release;
				await mouse("mouseMoved", end, 1);
				const released = (await bounds())[1];
				assert.equal(released.left, fixed.left + attraction + release);
				assert.equal(
					released.top,
					fixed.bottom + snapTuning.gap + attraction + release,
				);
			},
		);
		const moving = (await bounds())[1];
		await moveBar(
			2,
			fixed.left + attraction,
			fixed.top - (moving.bottom - moving.top) - snapTuning.gap + attraction,
		);
		assert.equal(
			(await bounds())[1].bottom,
			fixed.top - snapTuning.gap,
			"Stack snaps above peer",
		);
		await click(await point('button[aria-label="Rotate action bar 2"]'));
		await moveBar(
			2,
			fixed.right + snapTuning.gap + attraction,
			fixed.top + attraction,
		);
		const beside = (await bounds())[1];
		assert.equal(
			beside.left,
			fixed.right + snapTuning.gap,
			"Mixed orientations snap beside peer",
		);
		assert.equal(beside.top, fixed.top);
		assertNoOverlap(await bounds());
		await menu(2, "Delete");
		await moveBar(1, originalBounds.left, originalBounds.top);

		if (initiallyLocked) {
			await clickControl('button[aria-label="Lock UI layout"]');
			assert.equal(
				await read(
					`document.querySelector('button[aria-label="Move Action bar 1"]')`,
				),
				null,
			);
		}
		return {
			stackAbove: true,
			stackBelow: true,
			mixedOrientationAdjacency: true,
			pointerRelease: true,
			cleanup: true,
		};
	} finally {
		await restore();
	}
}

/** Common native pointer driver; each scenario retains its own setup and menu policy. */
function actionBarProbeDriver(client, evaluateExpression) {
	const read = (expression) => evaluateExpression(client, expression);
	const point = (selector) =>
		read(`(() => {
		const element = document.querySelector(${JSON.stringify(selector)});
		if (!element) throw new Error('Missing action-bar probe control: ' + ${JSON.stringify(selector)});
		element.scrollIntoView({block:'nearest',inline:'nearest'});
		const r = element.getBoundingClientRect();
		const point = {x:r.left+r.width/2, y:r.top+r.height/2};
		const hit = document.elementFromPoint(point.x, point.y);
		if (!element.contains(hit)) throw new Error('Action-bar probe control obscured: ' + hit?.outerHTML);
		return point;
	})()`);
	const mouse = (type, position, buttons) =>
		client.send("Input.dispatchMouseEvent", {
			type,
			...position,
			button: "left",
			buttons,
			clickCount: 1,
		});
	const click = async (position) => {
		await mouse("mousePressed", position, 1);
		await mouse("mouseReleased", position, 0);
	};
	const bounds = () =>
		read(`Array.from(document.querySelectorAll('[data-action-bar-surface]'), element => {
		const r = element.getBoundingClientRect(); return {left:r.left, top:r.top, right:r.right, bottom:r.bottom};
	})`);
	return { read, point, mouse, click, bounds };
}

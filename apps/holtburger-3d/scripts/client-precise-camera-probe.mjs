/** Real browser pointer capture: precise clicks launch, drags orbit, mode exit cancels. */
export async function probePreciseJumpCamera(
	client,
	evaluate,
	evaluateExpression,
) {
	const owner = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const capture = () => evaluate(client, `${owner}.capture`, []);
	const settle = () =>
		evaluateExpression(
			client,
			"new Promise(resolve => requestAnimationFrame(resolve))",
		);
	const require = (condition, message) => {
		if (!condition) throw new Error(message);
	};
	await evaluate(client, `${owner}.setPreciseJumpActive`, [true]);
	await settle();
	const initial = await capture();
	const point = {
		x: initial.gameCanvas.left + initial.gameCanvas.width / 2,
		y: initial.gameCanvas.top + initial.gameCanvas.height / 2,
	};
	const mouse = (type, x, y, down) =>
		client.send("Input.dispatchMouseEvent", {
			type,
			x,
			y,
			button: "left",
			buttons: down ? 1 : 0,
			clickCount: 1,
		});
	try {
		const passThrough = await evaluateExpression(
			client,
			`(() => {
            for (const selector of ['.jump-mode-label', '.jump-power-readout', '.jump-power-caption']) {
                const node = document.querySelector(selector);
                if (!node) throw new Error('Missing HUD label: ' + selector);
                const rect = node.getBoundingClientRect();
                const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                if (!hit?.matches('.client-canvas')) throw new Error(selector + ' blocks the viewport: ' + hit?.outerHTML);
            }
            return true;
        })()`,
		);
		require(passThrough, "HUD labels blocked viewport pointer input");

		const bar = await evaluateExpression(
			client,
			`(() => {
            const input = document.querySelector('.jump-power-input');
            if (!input) throw new Error('Missing runtime jump power control');
            const bounds = input.getBoundingClientRect();
            globalThis.__jumpPowerFocus = document.activeElement;
            return {x: bounds.left + bounds.width / 2, y: bounds.bottom - bounds.height * 0.75};
        })()`,
		);
		await mouse("mousePressed", bar.x, bar.y, true);
		await mouse("mouseReleased", bar.x, bar.y, false);
		await settle();
		const selectedPower = await evaluateExpression(
			client,
			`({value: document.querySelector('.jump-power-input').valueAsNumber, focusRetained: document.activeElement === globalThis.__jumpPowerFocus})`,
		);
		require(Math.abs(selectedPower.value - 0.75) < 0.002 &&
			selectedPower.focusRetained, "Power bar click did not set power while retaining keyboard ownership");
		require((await capture()).preciseJumpActivationCount ===
			initial.preciseJumpActivationCount, "Power bar click launched a jump");

		await mouse("mouseMoved", point.x, point.y, false);
		await mouse("mousePressed", point.x, point.y, true);
		require((await capture()).preciseJumpActivationCount ===
			initial.preciseJumpActivationCount, "Pointer-down launched before drag classification");
		await mouse("mouseMoved", point.x + 30, point.y + 12, true);
		await mouse("mouseReleased", point.x + 30, point.y + 12, false);
		const dragged = await capture();
		require(dragged.orbitDeltas.length >
			initial.orbitDeltas.length, "Precise drag did not orbit the camera");
		require(dragged.preciseJumpActivationCount ===
			initial.preciseJumpActivationCount, "Precise camera drag launched a jump");
		require(dragged.viewportSelectionPoints.length ===
			initial.viewportSelectionPoints
				.length, "Precise drag selected an entity");
		await mouse("mouseMoved", point.x, point.y, false);
		const beforeClick = await capture();
		await mouse("mousePressed", point.x, point.y, true);
		await mouse("mouseMoved", point.x + 1, point.y + 1, true);
		await mouse("mouseReleased", point.x + 1, point.y + 1, false);
		const clicked = await capture();
		require(clicked.preciseJumpActivationCount ===
			initial.preciseJumpActivationCount +
				1, "Precise click did not launch exactly once");
		require(clicked.preciseJumpAimCount ===
			beforeClick.preciseJumpAimCount, "Click jitter replaced the displayed target");
		await mouse("mousePressed", point.x, point.y, true);
		await evaluate(client, `${owner}.setPreciseJumpActive`, [false]);
		await settle();
		await mouse("mouseReleased", point.x, point.y, false);
		const cancelled = await capture();
		require(cancelled.preciseJumpActivationCount ===
			clicked.preciseJumpActivationCount &&
			cancelled.viewportSelectionPoints.length ===
				clicked.viewportSelectionPoints
					.length, "Mode exit retained a pending click");
		return {
			passed: true,
			orbit: true,
			stableClick: true,
			modeCancellation: true,
			barClick: true,
			labelPassthrough: true,
		};
	} finally {
		await evaluateExpression(client, "delete globalThis.__jumpPowerFocus");
		await mouse("mouseReleased", point.x, point.y, false);
		await evaluate(client, `${owner}.setPreciseJumpActive`, [false]);
	}
}

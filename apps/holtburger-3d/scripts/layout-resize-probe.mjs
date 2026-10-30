import assert from "node:assert/strict";

/** Exercise unlocked border gestures through browser hit testing and native pointer input. */
export async function probeLayoutResizing(client, evaluate) {
	const read = (expression) => evaluate(client, expression);
	const settle = () =>
		read(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
	const toggle = async (text) => {
		await read(
			`([...document.querySelectorAll('button')].find(node => node.textContent.trim() === ${JSON.stringify(text)}).click())`,
		);
		await settle();
	};
	const rectangle = (selector) =>
		read(
			`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`,
		);
	const outlineOutset = (selector) =>
		read(
			`(() => { const style = getComputedStyle(document.querySelector(${JSON.stringify(selector)})); return parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth) / 2; })()`,
		);
	const drag = async (point, dx, dy) => {
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			...point,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			button: "left",
			buttons: 1,
			clickCount: 1,
			...point,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			buttons: 1,
			x: point.x + dx,
			y: point.y + dy,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			button: "left",
			buttons: 0,
			clickCount: 1,
			x: point.x + dx,
			y: point.y + dy,
		});
		await settle();
	};
	const close = (actual, expected, label) =>
		assert.ok(
			Math.abs(actual - expected) < 1,
			`${label}: ${actual} != ${expected}`,
		);
	await toggle("Unlock UI layout");
	assert.equal(
		await read(
			`document.querySelector('[aria-label="Game shortcuts"] .resize-border') !== null`,
		),
		false,
	);
	const evidence = [];
	const allBorders = [
		"top",
		"right",
		"bottom",
		"left",
		"top-left",
		"top-right",
		"bottom-right",
		"bottom-left",
	];
	for (const label of ["Character HUD", "Party HUD", "Minimap"]) {
		const borders = label === "Character HUD" ? ["right", "left"] : allBorders;
		const selector = `section[aria-label="${label}"]`;
		// Promote only this diagnostic subject so neighboring HUDs cannot obscure the border under test.
		const previousZ = await read(
			`(() => { const node = document.querySelector(${JSON.stringify(selector)}); const previous = node.style.zIndex; node.style.zIndex = '1000'; return previous; })()`,
		);
		if (label === "Character HUD") {
			// Content height must own the hit area even when a retained preferred height is larger.
			const naturalHeight = async () =>
				(await rectangle(`${selector} .character-hud`)).height;
			close(
				(await rectangle(selector)).height,
				await naturalHeight(),
				"Vitals border follows content",
			);
			const initialHeight = await naturalHeight();
			await read(
				`document.querySelector('.character-hud').style.setProperty('--ui-text-scale', '1.6')`,
			);
			await settle();
			assert.ok(
				(await naturalHeight()) > initialHeight,
				"Text scaling changes intrinsic vitals height",
			);
			close(
				(await rectangle(selector)).height,
				await naturalHeight(),
				"Vitals border follows text scaling",
			);
			await read(
				`document.querySelector('.character-hud').style.removeProperty('--ui-text-scale')`,
			);
			await settle();
			close(
				(await rectangle(selector)).height,
				initialHeight,
				"Vitals height shrinks with content",
			);
		}
		const outset = await outlineOutset(selector);
		const original = await rectangle(selector);
		const movePoint = async () => {
			const rect = await rectangle(`${selector} .layout-move`);
			return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		};
		const viewport = await read(
			`document.querySelector('[data-game-viewport]').getBoundingClientRect().toJSON()`,
		);
		await drag(
			await movePoint(),
			viewport.left + (viewport.width - original.width) / 2 - original.left,
			viewport.top + (viewport.height - original.height) / 2 - original.top,
		);
		assert.equal(
			await read(
				`document.querySelectorAll(${JSON.stringify(`${selector} .resize-border`)}).length`,
			),
			borders.length,
		);
		for (const name of borders) {
			const borderPoint = async () => {
				const rect = await rectangle(selector);
				// Read the painted outline geometry so the gesture remains valid when its styling changes.
				const point = {
					x: name.includes("left")
						? rect.left - outset
						: name.includes("right")
							? rect.right + outset
							: rect.left + rect.width / 2,
					y: name.includes("top")
						? rect.top - outset
						: name.includes("bottom")
							? rect.bottom + outset
							: rect.top + rect.height / 2,
				};
				assert.equal(
					await read(
						`document.elementFromPoint(${point.x}, ${point.y})?.classList.contains(${JSON.stringify(`resize-border-${name}`)})`,
					),
					true,
					`${label} ${name} outline hit`,
				);
				return point;
			};
			const before = await rectangle(selector);
			if (label === "Character HUD") {
				await drag(await borderPoint(), 0, 24);
				const verticallyDragged = await rectangle(selector);
				for (const field of ["left", "top", "width", "height"])
					close(
						verticallyDragged[field],
						before[field],
						`Vitals vertical pointer displacement preserves ${field}`,
					);
			}
			const amount = 16;
			const dx = name.includes("left")
				? -amount
				: name.includes("right")
					? amount
					: 0;
			const dy = name.includes("top")
				? -amount
				: name.includes("bottom")
					? amount
					: 0;
			await drag(await borderPoint(), dx, dy);
			const after = await rectangle(selector);
			const square = label === "Minimap";
			close(
				after.width,
				before.width + (square || dx !== 0 ? amount : 0),
				`${label} ${name} width`,
			);
			close(
				after.height,
				before.height + (square || dy !== 0 ? amount : 0),
				`${label} ${name} height`,
			);
			close(after.left, before.left + Math.min(dx, 0), `${label} ${name} left`);
			close(after.top, before.top + Math.min(dy, 0), `${label} ${name} top`);
			await drag(await borderPoint(), -dx, -dy);
			const restored = await rectangle(selector);
			for (const field of ["left", "top", "width", "height"])
				close(
					restored[field],
					before[field],
					`${label} ${name} restored ${field}`,
				);
		}
		if (label === "Minimap") {
			const before = await rectangle(selector);
			await drag(
				{ x: before.left - outset, y: before.top + before.height / 2 },
				-(before.left - viewport.left - 8),
				0,
			);
			const constrained = await rectangle(selector);
			assert.ok(
				constrained.width > before.width,
				`Boundary drag resized minimap: ${JSON.stringify({ before, constrained, viewport })}`,
			);
			close(
				constrained.right,
				before.right,
				"Minimap viewport clamp preserves opposite border",
			);
			close(
				constrained.top,
				before.top,
				"Minimap horizontal resizing preserves top at viewport limit",
			);
			assert.ok(
				constrained.left >= viewport.left,
				"Minimap stays within viewport",
			);
			await drag(
				{
					x: constrained.left - outset,
					y: constrained.top + constrained.height / 2,
				},
				constrained.width - before.width,
				0,
			);
		}
		const current = await rectangle(selector);
		await drag(
			await movePoint(),
			original.left - current.left,
			original.top - current.top,
		);
		await read(
			`document.querySelector(${JSON.stringify(selector)}).style.zIndex = ${JSON.stringify(previousZ)}`,
		);
		evidence.push({ label, borders: borders.length });
	}
	await toggle("Lock UI layout");
	assert.equal(
		await read(
			"document.querySelectorAll('.hud-panel .resize-border, .minimap .resize-border').length",
		),
		0,
	);
	return evidence;
}

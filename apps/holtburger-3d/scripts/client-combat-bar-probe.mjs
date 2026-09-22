import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

/** Exercise the production combat HUD through the browser harness boundary. */
export async function probeCombatBar(
	client,
	evaluateExpression,
	screenshotPath,
) {
	const read = (expression) => evaluateExpression(client, expression);
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.combatBarProbe";
	const settle = () =>
		read(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
	const opacityTiming = await read(`(() => {
		const styles = getComputedStyle(document.documentElement);
		const milliseconds = (name) => {
			const value = styles.getPropertyValue(name).trim();
			return value.endsWith('ms')
				? Number.parseFloat(value)
				: Number.parseFloat(value) * 1000;
		};
		return {
			idle: styles.getPropertyValue('--ui-combat-idle-opacity').trim(),
			emphasisMs: milliseconds('--ui-combat-emphasis-duration'),
			transitionMs: milliseconds('--ui-combat-opacity-transition-duration'),
		};
	})()`);
	const arcPoint = (value) =>
		read(`(() => {
			const gauge = document.querySelector('.gauge');
			const arc = gauge.querySelector('.power-hit-area');
			const bounds = gauge.getBoundingClientRect();
			const viewBox = gauge.viewBox.baseVal;
			const arcBounds = arc.getBBox();
			const radiusX = arcBounds.width / 2;
			const radiusY = arcBounds.height;
			const centerX = arcBounds.x + radiusX;
			const centerY = arcBounds.y + radiusY;
			const x = centerX - radiusX * Math.cos(Math.PI * ${value});
			const y = centerY - radiusY * Math.sin(Math.PI * ${value});
			return {
				x: bounds.left + (x - viewBox.x) / viewBox.width * bounds.width,
				y: bounds.top + (y - viewBox.y) / viewBox.height * bounds.height,
			};
		})()`);
	const dragArc = async (from, to) => {
		const start = await arcPoint(from);
		const end = await arcPoint(to);
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: start.x,
			y: start.y,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			x: start.x,
			y: start.y,
			button: "left",
			clickCount: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: end.x,
			y: end.y,
			button: "left",
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x: end.x,
			y: end.y,
			button: "left",
			clickCount: 1,
		});
	};
	const capture = async (name) => {
		if (!screenshotPath) return;
		const shot = await client.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		await writeFile(
			`${screenshotPath}.${name}.png`,
			Buffer.from(shot.data, "base64"),
		);
	};

	await read(`${api}.begin('melee')`);
	await settle();
	assert.equal(
		await read("document.querySelectorAll('.combat-bar').length"),
		1,
	);
	assert.equal(
		await read("document.querySelector('.combat-bar').dataset.combatMode"),
		"melee",
	);
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: 900,
		y: 300,
	});
	await read("new Promise(resolve => setTimeout(resolve, 150))");
	assert.equal(
		await read(
			"getComputedStyle(document.querySelector('.breakpoint-3')).opacity",
		),
		"0",
	);
	assert.equal(
		await read(
			"getComputedStyle(document.querySelector('.breakpoint-3')).pointerEvents",
		),
		"none",
	);
	assert.equal(
		await read("document.querySelector('.breakpoint-3').title"),
		"Melee power: 50%\nKey: 3",
	);
	assert.equal(
		await read("document.querySelector('.height.high').title"),
		"High attack — Shift + 1",
	);
	assert.equal(
		await read(
			"getComputedStyle(document.querySelector('.combat-bar')).opacity",
		),
		opacityTiming.idle,
	);
	assert.equal(
		await read(
			"document.querySelector('.power-control').getAttribute('aria-valuenow')",
		),
		"50",
	);
	assert.deepEqual(
		await read(`(() => {
			const combat = document.querySelector('.combat-bar').getBoundingClientRect();
			const backdrop = document.querySelector('.gauge-background').getBoundingClientRect();
			const height = document.querySelector('.height.medium').getBoundingClientRect();
			const hitsCombat = (x, y) =>
				Boolean(document.elementFromPoint(x, y)?.closest('.combat-bar'));
			return {
				transparentMargin: hitsCombat(combat.left + 2, combat.top + 2),
				backdropOnly: hitsCombat(backdrop.left + 2, backdrop.top + backdrop.height / 2),
				heightButton: hitsCombat(height.left + height.width / 2, height.top + height.height / 2),
			};
		})()`),
		{
			transparentMargin: false,
			backdropOnly: false,
			heightButton: true,
		},
	);
	const initialArcPoint = await arcPoint(0.5);
	assert.deepEqual(
		await read(`(() => {
			const target = document.elementFromPoint(${initialArcPoint.x}, ${initialArcPoint.y});
			return {
				hitsCombat: Boolean(target?.closest('.combat-bar')),
				cursor: target === null ? null : getComputedStyle(target).cursor,
			};
		})()`),
		{ hitsCombat: true, cursor: "pointer" },
	);
	await dragArc(0.5, 0.25);
	await settle();
	assert.equal(await read(`${api}.status().desired.target`), 7);
	assert.equal(
		await read(
			"document.querySelector('.power-control').getAttribute('aria-valuenow')",
		),
		"25",
	);
	await read("new Promise(resolve => setTimeout(resolve, 150))");
	assert.match(
		await read(
			"getComputedStyle(document.querySelector('.power-handle')).transform",
		),
		/^matrix\(1\.12, 0, 0, 1\.12,/,
	);
	assert.deepEqual(
		await read(
			"[...document.querySelectorAll('.height')].map(button => ({ shortcut: button.dataset.shortcut, opacity: getComputedStyle(button, '::after').opacity }))",
		),
		[
			{ shortcut: "S1", opacity: "1" },
			{ shortcut: "S2", opacity: "1" },
			{ shortcut: "S3", opacity: "1" },
		],
	);
	assert.equal(
		await read(`(() => {
			const hint = document.querySelector('.breakpoint-1').getBoundingClientRect();
			return Boolean(
				document
					.elementFromPoint(hint.left + hint.width / 2, hint.top + hint.height / 2)
					?.closest('.breakpoint-1'),
			);
		})()`),
		true,
	);
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: 900,
		y: 300,
	});
	// Trigger and observe the hold within one browser task, independent of CDP latency.
	assert.equal(
		await read(`(async () => {
			document.querySelector('.height.high').click();
			await new Promise(resolve => requestAnimationFrame(resolve));
			return document.querySelector('.combat-bar').classList.contains('profile-emphasized');
		})()`),
		true,
	);
	const selectedPoint = await arcPoint(0.25);
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: selectedPoint.x,
		y: selectedPoint.y,
	});
	await read("new Promise(resolve => setTimeout(resolve, 150))");
	await capture("combat-melee");
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: 900,
		y: 300,
	});
	await read(
		`new Promise(resolve => setTimeout(resolve, ${opacityTiming.emphasisMs + opacityTiming.transitionMs + 50}))`,
	);
	assert.equal(
		await read(
			"getComputedStyle(document.querySelector('.combat-bar')).opacity",
		),
		opacityTiming.idle,
	);
	assert.deepEqual(
		await read(`(async () => {
			window.dispatchEvent(new KeyboardEvent('keydown', {
				key: '2',
				code: 'Digit2',
				bubbles: true,
				cancelable: true,
			}));
			await new Promise(resolve => requestAnimationFrame(resolve));
			return {
				emphasized: document.querySelector('.combat-bar').classList.contains('profile-emphasized'),
				value: document.querySelector('.power-control').getAttribute('aria-valuenow'),
			};
		})()`),
		{ emphasized: true, value: "25" },
	);

	await read(`${api}.active('missile')`);
	await settle();
	assert.equal(
		await read("document.querySelector('.combat-bar').dataset.combatMode"),
		"missile",
	);
	assert.equal(
		await read("document.querySelector('.breakpoint-5').title"),
		"Missile accuracy: 100%\nKey: 5",
	);
	const chargeLength = await read(
		"parseFloat(document.querySelector('.gauge-fill').style.strokeDasharray)",
	);
	assert.ok(
		chargeLength > 0 && chargeLength < 50,
		"Charge fill must advance independently toward the 50% slider endpoint",
	);
	await dragArc(0.5, 0.62);
	await settle();
	assert.equal(
		await read(
			"document.querySelector('.power-control').getAttribute('aria-valuenow')",
		),
		"62",
	);
	await read(`${api}.begin('missile')`);
	await settle();
	assert.equal(await read(`${api}.status().desired`), null);
	await read("document.querySelector('.height.high').click()");
	await settle();
	assert.equal(await read(`${api}.status().desired.target`), 7);
	assert.equal(
		await read(
			"document.querySelector('.height.high').getAttribute('aria-pressed')",
		),
		"true",
	);
	await capture("combat-missile");
	for (const [supply, expected] of [
		[{ kind: "finite", count: 147 }, "147"],
		[{ kind: "finite", count: 146 }, "146"],
		[{ kind: "finite", count: 1 }, "1"],
		[{ kind: "finite", count: 0 }, "0"],
		[{ kind: "unlimited" }, "∞"],
		[{ kind: "pending", appraisal: null }, null],
		[{ kind: "not-applicable" }, null],
	]) {
		await read(`${api}.supply(${JSON.stringify(supply)})`);
		assert.equal(
			await read(
				"document.querySelector('.projectile-supply strong')?.textContent ?? null",
			),
			expected,
		);
	}
	await read(`${api}.supply({kind: 'finite', count: 147})`);
	await capture("combat-projectiles");
	await read(`${api}.begin('melee')`);
	await settle();
	assert.equal(
		await read("document.querySelector('.projectile-supply')"),
		null,
	);

	await read(`${api}.end()`);
	await settle();
	assert.equal(
		await read("document.querySelectorAll('.combat-bar').length"),
		0,
	);
	return { immediateEngagement: true, precisePower: 0.62 };
}

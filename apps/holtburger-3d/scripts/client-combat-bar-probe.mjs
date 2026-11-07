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
	const helpOpacity = () =>
		read("getComputedStyle(document.querySelector('.power-label')).opacity");
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
			appearanceHoldMs: milliseconds('--ui-combat-appearance-hold-duration'),
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
		assert.equal(
			await read(
				"document.querySelector('.power-handle-pulse').getAnimations().length",
			),
			0,
			"Drag preview must not pulse",
		);
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
	await read(`${api}.theme("Traveler’s Kit")`);
	const range = await read(`${api}.range`);
	const cue = () =>
		read("document.querySelector('.recklessness-skull-face') !== null");
	// Training changes must update both physical-combat gauges with the character panel closed.
	for (const mode of ["melee", "missile"]) {
		await read(`${api}.active('${mode}')`);
		for (const training of [
			null,
			"Unusable",
			"Untrained",
			"Trained",
			"Specialized",
		]) {
			await read(`${api}.recklessness(${JSON.stringify(training)})`);
			assert.equal(
				await read("document.querySelectorAll('.recklessness-range').length"),
				training === "Trained" || training === "Specialized" ? 1 : 0,
			);
			const trained = training === "Trained" || training === "Specialized";
			assert.equal(await cue(), trained);
			assert.equal(
				await read("document.querySelector('.power-label').textContent.trim()"),
				trained ? "Reckless" : mode === "melee" ? "Power" : "Accuracy",
			);
			assert.equal(
				await read(`(() => {
				const handle = document.querySelector('.power-handle');
				const art = handle.querySelector('svg').getBoundingClientRect();
				const hit = handle.querySelector('.power-handle-hit-area').getBoundingClientRect();
				const scale = handle.querySelector('.recklessness-skull-art') === null ? 1 : Number(getComputedStyle(handle).getPropertyValue('--ui-combat-recklessness-handle-scale'));
				const marginX = hit.width * (scale - 1) / 2;
				const marginY = hit.height * (scale - 1) / 2;
				return art.width > 0 && art.height > 0 && art.left >= hit.left - marginX - 0.1 && art.top >= hit.top - marginY - 0.1 && art.right <= hit.right + marginX + 0.1 && art.bottom <= hit.bottom + marginY + 0.1;
			})()`),
				true,
				"Handle artwork must stay centered at its themed size",
			);
		}
		for (const [setting, active] of [
			[0, false],
			[range.min, true],
			[range.max, true],
			[1, false],
		]) {
			await read(
				`${api}.select(${JSON.stringify({ kind: mode, height: "medium", [mode === "melee" ? "power" : "accuracy"]: setting })})`,
			);
			await settle();
			assert.equal(await cue(), active);
			assert.equal(
				await read("document.querySelector('.power-label').textContent.trim()"),
				active ? "Reckless" : mode === "melee" ? "Power" : "Accuracy",
			);
		}
		// Idle charge must not retire a cue selected by the power/accuracy setting.
		await read(
			`${api}.select(${JSON.stringify({ kind: mode, height: "medium", [mode === "melee" ? "power" : "accuracy"]: (range.min + range.max) / 2 })})`,
		);
		await read(`${api}.begin('${mode}')`);
		await settle();
		assert.equal(await cue(), true);
		assert.equal(
			await read(`(async () => {
			const api = ${api};
			const mode = '${mode}';
			const setting = mode === 'melee' ? 'power' : 'accuracy';
			const midpoint = (api.range.min + api.range.max) / 2;
			for (const [target, key] of [[api.range.min, 'ArrowLeft'], [api.range.max, 'ArrowRight']]) {
				api.select({kind: mode, height: 'medium', [setting]: midpoint});
				await new Promise(requestAnimationFrame);
				const slider = document.querySelector('.power-control');
				const maximum = Number(slider.getAttribute('aria-valuemax'));
				for (let count = 0; count < maximum && Number(slider.getAttribute('aria-valuenow')) !== target * maximum; count++) {
					slider.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
					await new Promise(requestAnimationFrame);
				}
				const profile = api.status().desired.profile;
				if (profile[setting] !== target || document.querySelector('.recklessness-skull-face') === null) return false;
			}
			return true;
		})()`),
			true,
			"Keyboard steps must activate Recklessness at both displayed endpoints",
		);
	}
	assert.deepEqual(
		await read(`(() => {
		const bar = document.querySelector('.combat-bar');
		bar.style.setProperty('--ui-combat-recklessness-track-color', '#123456');
		bar.style.setProperty('--ui-combat-recklessness-charge-color', '#abcdef');
		bar.style.setProperty('--ui-combat-recklessness-handle-color', '#fedcba');
		try {
			return {
				track: getComputedStyle(bar.querySelector('.recklessness-track')).stroke,
				charge: getComputedStyle(bar.querySelector('.recklessness-charge')).stroke,
				trackFill: getComputedStyle(bar.querySelector('.recklessness-track')).fill,
				chargeFill: getComputedStyle(bar.querySelector('.recklessness-charge')).fill,
				skull: getComputedStyle(bar.querySelector('.recklessness-skull-face')).fill,
				pointerEvents: getComputedStyle(bar.querySelector('.recklessness-range')).pointerEvents,
			};
		} finally {
			bar.style.removeProperty('--ui-combat-recklessness-track-color');
			bar.style.removeProperty('--ui-combat-recklessness-charge-color');
			bar.style.removeProperty('--ui-combat-recklessness-handle-color');
		}
	})()`),
		{
			track: "rgb(18, 52, 86)",
			charge: "rgb(171, 205, 239)",
			trackFill: "none",
			chargeFill: "none",
			skull: "rgb(254, 220, 186)",
			pointerEvents: "none",
		},
	);
	await capture("recklessness-skull");
	// Rasterize the real tint geometry: checking paint colors alone missed the filled-center report.
	assert.deepEqual(
		await read(`(async () => {
		const range = document.querySelector('.recklessness-range');
		const gauge = range.ownerSVGElement;
		const svg = gauge.cloneNode(false);
		svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
		svg.setAttribute('width', gauge.viewBox.baseVal.width);
		svg.setAttribute('height', gauge.viewBox.baseVal.height);
		svg.removeAttribute('style');
		svg.append(gauge.querySelector('defs').cloneNode(true));
		const paint = range.cloneNode(true);
		// An opaque interior paint must still be confined to the arc by the mask.
		for (const path of paint.querySelectorAll('path')) {
			path.setAttribute('fill', 'white');
			path.setAttribute('stroke', 'white');
		}
		svg.append(paint);
		const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
		try {
			const image = new Image();
			image.src = url;
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = image.width;
			canvas.height = image.height;
			const context = canvas.getContext('2d');
			context.drawImage(image, 0, 0);
			const bounds = range.querySelector('path').getBBox();
			const x = Math.round(bounds.x + bounds.width / 2);
			const alpha = y => context.getImageData(x, Math.round(y), 1, 1).data[3];
			return {
				arcVisible: alpha(bounds.y) > 0,
				centerClear: alpha(bounds.y + bounds.height / 2) === 0,
			};
		} finally { URL.revokeObjectURL(url); }
	})()`),
		{ arcVisible: true, centerClear: true },
	);
	await read(`${api}.theme(null)`);
	// Artwork pulses on committed movement while its hit target stays fixed.
	for (const mode of ["melee", "missile"]) {
		assert.deepEqual(
			await read(`(async () => {
			const api = ${api};
			const mode = '${mode}';
			const setting = mode === 'melee' ? 'power' : 'accuracy';
			const select = (value, height = 'medium') => api.select({kind: mode, height, [setting]: value});
			api.begin(mode);
			select(1);
			await new Promise(requestAnimationFrame);
			const bar = document.querySelector('.combat-bar');
			bar.style.setProperty('--ui-combat-handle-settle-duration', '400ms');
			bar.style.setProperty('--ui-combat-handle-settle-scale', '1.4');
			const pulse = bar.querySelector('.power-handle-pulse');
			const hit = bar.querySelector('.power-handle-hit-area');
			const checks = [];
			try {
				for (const value of [0, (api.range.min + api.range.max) / 2]) {
					select(value);
					await new Promise(requestAnimationFrame);
					const before = hit.getBoundingClientRect();
					const animation = pulse.getAnimations()[0];
					animation.pause();
					animation.currentTime = Number(animation.effect.getTiming().duration) * 0.4;
					const after = hit.getBoundingClientRect();
					checks.push({
						duration: animation.effect.getTiming().duration,
						peak: animation.effect.getKeyframes()[1].transform,
						enlarged: new DOMMatrixReadOnly(getComputedStyle(pulse).transform).a > 1,
						stableHitArea: before.width === after.width && before.height === after.height,
					});
					animation.finish();
					select(value, 'high');
					await new Promise(requestAnimationFrame);
					if (pulse.getAnimations().length !== 0) throw new Error('Unchanged setting or height selection replayed pulse');
				}
				return checks;
			} finally {
				bar.style.removeProperty('--ui-combat-handle-settle-duration');
				bar.style.removeProperty('--ui-combat-handle-settle-scale');
			}
		})()`),
			Array.from({ length: 2 }, () => ({
				duration: 400,
				peak: "scale(1.4)",
				enlarged: true,
				stableHitArea: true,
			})),
		);
	}
	await client.send("Emulation.setEmulatedMedia", {
		features: [{ name: "prefers-reduced-motion", value: "reduce" }],
	});
	await read(`${api}.select({kind: 'missile', height: 'medium', accuracy: 1})`);
	await settle();
	assert.equal(
		await read(
			"document.querySelector('.power-handle-pulse').getAnimations().length",
		),
		0,
	);
	await client.send("Emulation.setEmulatedMedia", { features: [] });
	await read(
		`${api}.select({kind: 'missile', height: 'medium', accuracy: ${(range.min + range.max) / 2}})`,
	);
	await settle();
	await client.send("Emulation.setEmulatedMedia", {
		features: [{ name: "prefers-reduced-motion", value: "reduce" }],
	});
	await settle();
	assert.equal(
		await read(
			"document.querySelector('.power-handle-pulse').getAnimations().length",
		),
		0,
	);
	await client.send("Emulation.setEmulatedMedia", { features: [] });
	await read(
		`${api}.select({kind: 'melee', height: 'medium', power: ${(range.min + range.max) / 2}})`,
	);
	await read(`${api}.end()`);
	await settle();
	await read(`${api}.recklessness(null)`);
	await read(`${api}.begin('melee')`);
	await settle();
	assert.deepEqual(
		await read(`(() => {
		const bar = document.querySelector('.combat-bar');
		return {
			opacity: getComputedStyle(bar).opacity,
			animated: getComputedStyle(bar).animationName.endsWith('combat-pop-in'),
			appearing: bar.classList.contains('appearing'),
		};
	})()`),
		{ opacity: "1", animated: true, appearing: true },
	);
	assert.equal(await helpOpacity(), "0");
	assert.equal(
		await read("document.querySelector('.power-label').textContent.trim()"),
		"Power",
	);
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
	await read(
		`new Promise(resolve => setTimeout(resolve, ${opacityTiming.appearanceHoldMs + opacityTiming.transitionMs + 50}))`,
	);
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
	await read(
		`new Promise(resolve => setTimeout(resolve, ${opacityTiming.transitionMs + 50}))`,
	);
	assert.equal(await helpOpacity(), "1");
	// Inherited theme paint must reach labels and SVG leaders without changing control colors.
	assert.deepEqual(
		await read(`(() => {
		const bar = document.querySelector('.combat-bar');
		const owner = bar.parentElement;
		const originalOwnerStyle = owner.getAttribute('style');
		const originalBarStyle = bar.getAttribute('style');
		const label = bar.querySelector('.power-label');
		const baselineColor = getComputedStyle(label).color;
		const buttonColor = getComputedStyle(bar.querySelector('.engagement-toggle')).color;
		let themed;
		try {
			for (const [property, value] of Object.entries({
				'--ui-combat-help-color': '#123456',
				'--ui-combat-help-arc-letter-spacing': '3px',
				'--ui-combat-help-text-shadow': 'none',
				'--ui-combat-help-leader-color': '#abcdef',
				'--ui-combat-help-leader-width': '3',
				'--ui-combat-help-leader-dasharray': '4 2',
				'--ui-combat-appearance-start-scale': '0.4',
				'--ui-combat-appearance-easing': 'linear',
			})) owner.style.setProperty(property, value);
			// Restart and pause the real CSS animation at its first keyframe for a deterministic sample.
			bar.style.animationName = 'none';
			getComputedStyle(bar).animationName;
			bar.style.removeProperty('animation-name');
			bar.style.animationPlayState = 'paused';
			const animation = bar.getAnimations()[0];
			animation.currentTime = 0;
			const line = getComputedStyle(bar.querySelector('.side-labels svg path'));
			const text = getComputedStyle(label);
			themed = {
				color: text.color, fill: text.fill, spacing: text.letterSpacing, shadow: text.textShadow,
				stroke: line.stroke, width: line.strokeWidth, dashes: line.strokeDasharray,
				easing: getComputedStyle(bar).animationTimingFunction,
				scale: new DOMMatrixReadOnly(getComputedStyle(bar).transform).a,
				controlsUnchanged: getComputedStyle(bar.querySelector('.engagement-toggle')).color === buttonColor,
			};
			owner.style.removeProperty('--ui-combat-help-leader-color');
			themed.leaderInheritsHelp = getComputedStyle(bar.querySelector('.side-labels svg path')).stroke;
			owner.style.removeProperty('--ui-combat-help-color');
			owner.style.removeProperty('--ui-combat-help-text-shadow');
			owner.style.setProperty('--ui-combat-foreground-color', '#345678');
			owner.style.setProperty('--ui-combat-breakpoint-shadow', 'none');
			themed.inheritedForeground = getComputedStyle(label).color;
			themed.inheritedShadow = getComputedStyle(label).textShadow;
		} finally {
			if (originalOwnerStyle === null) owner.removeAttribute('style');
			else owner.setAttribute('style', originalOwnerStyle);
			if (originalBarStyle === null) bar.removeAttribute('style');
			else bar.setAttribute('style', originalBarStyle);
		}
		return { ...themed, restored: getComputedStyle(label).color === baselineColor };
	})()`),
		{
			color: "rgb(18, 52, 86)",
			fill: "rgb(18, 52, 86)",
			spacing: "3px",
			shadow: "none",
			stroke: "rgb(171, 205, 239)",
			width: "3px",
			dashes: "4px, 2px",
			easing: "linear",
			scale: 0.4,
			controlsUnchanged: true,
			leaderInheritsHelp: "rgb(18, 52, 86)",
			inheritedForeground: "rgb(52, 86, 120)",
			inheritedShadow: "none",
			restored: true,
		},
	);
	assert.equal(
		await read(
			"getComputedStyle(document.querySelector('.side-labels')).opacity",
		),
		"1",
	);
	assert.equal(
		await read(
			"getComputedStyle(document.querySelector('.side-labels')).pointerEvents",
		),
		"none",
	);
	await read(`${api}.help(false)`);
	await settle();
	await read(
		`new Promise(resolve => setTimeout(resolve, ${opacityTiming.transitionMs + 50}))`,
	);
	assert.equal(await helpOpacity(), "0");
	// Help preference must not hide existing shortcut hints or reduce hover opacity.
	assert.equal(
		await read(
			"getComputedStyle(document.querySelector('.breakpoint-3')).opacity",
		),
		"1",
	);
	assert.equal(
		await read(
			"getComputedStyle(document.querySelector('.combat-bar')).opacity",
		),
		"1",
	);
	await read(`${api}.help(true)`);
	await settle();
	await read(
		`new Promise(resolve => setTimeout(resolve, ${opacityTiming.transitionMs + 50}))`,
	);
	assert.equal(await helpOpacity(), "1");
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
	await read(
		`new Promise(resolve => setTimeout(resolve, ${opacityTiming.transitionMs + 50}))`,
	);
	await read("document.querySelector('.power-control').focus()");
	await settle();
	await read(
		`new Promise(resolve => setTimeout(resolve, ${opacityTiming.transitionMs + 50}))`,
	);
	assert.equal(await helpOpacity(), "0");
	assert.equal(
		await read(
			"getComputedStyle(document.querySelector('.combat-bar')).opacity",
		),
		"1",
	);
	await read("document.querySelector('.power-control').blur()");
	// Trigger and observe the hold within one browser task, independent of CDP latency.
	assert.equal(
		await read(`(async () => {
			document.querySelector('.height.high').click();
			await new Promise(resolve => requestAnimationFrame(resolve));
			return document.querySelector('.combat-bar').classList.contains('profile-emphasized');
		})()`),
		true,
	);
	assert.equal(await helpOpacity(), "0");
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
		await read("document.querySelector('.power-label').textContent.trim()"),
		"Accuracy",
	);
	assert.equal(
		await read(
			"document.querySelector('.combat-bar').classList.contains('appearing')",
		),
		false,
	);
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

	// Play engages the current profile; cancellation retains it for the next engagement.
	for (const mode of ["melee", "missile"]) {
		await read(`${api}.begin('${mode}')`);
		await settle();
		assert.equal(
			await read("document.querySelector('.engagement-toggle').disabled"),
			false,
		);
		assert.equal(
			await read("document.querySelector('.engagement-label').textContent"),
			"Start attack",
		);
		const expectedProfile = await read(`(() => {
			const bar = document.querySelector('.combat-bar');
			const kind = bar.dataset.combatMode;
			const height = ['high', 'medium', 'low'].find(height => bar.querySelector('.height.selected').classList.contains(height));
			const value = Number(bar.querySelector('.power-control').getAttribute('aria-valuenow')) / 100;
			return kind === 'melee' ? { kind, height, power: value } : { kind, height, accuracy: value };
		})()`);
		await read("document.querySelector('.engagement-toggle').click()");
		await settle();
		const desired = await read(
			`JSON.parse(JSON.stringify(${api}.status().desired))`,
		);
		assert.equal(desired.target, 7);
		assert.equal(desired.profile.kind, expectedProfile.kind);
		assert.equal(desired.profile.height, expectedProfile.height);
		// Pointer-selected fractions retain more precision than the displayed whole percent.
		const setting = mode === "melee" ? "power" : "accuracy";
		assert.equal(
			Math.round(desired.profile[setting] * 100),
			expectedProfile[setting] * 100,
		);
		assert.equal(
			await read(
				"document.querySelector('.engagement-toggle').getAttribute('aria-label')",
			),
			"Cancel attack",
		);
		assert.equal(
			await read("document.querySelector('.engagement-label').textContent"),
			"Cancel attack",
		);
		assert.equal(
			await read("document.querySelector('.engagement-toggle').disabled"),
			false,
		);
		const profile = await read(
			"document.querySelector('.power-control').getAttribute('aria-valuenow')",
		);
		await read("document.querySelector('.engagement-toggle').click()");
		await settle();
		assert.equal(await read(`${api}.status().desired`), null);
		assert.equal(
			await read("document.querySelector('.engagement-toggle').disabled"),
			false,
		);
		assert.equal(
			await read(
				"document.querySelector('.engagement-toggle').getAttribute('aria-label')",
			),
			"Start attack",
		);
		assert.equal(
			await read("document.querySelector('.combat-bar').dataset.combatMode"),
			mode,
		);
		assert.equal(
			await read(
				"document.querySelector('.power-control').getAttribute('aria-valuenow')",
			),
			profile,
		);
	}

	await read(`${api}.end()`);
	await settle();
	assert.equal(
		await read("document.querySelectorAll('.combat-bar').length"),
		0,
	);
	await client.send("Emulation.setEmulatedMedia", {
		features: [{ name: "prefers-reduced-motion", value: "reduce" }],
	});
	// Earlier pointer scenarios can leave the cursor over the remounted bar.
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: 0,
		y: 0,
	});
	await read(`${api}.begin('melee')`);
	await settle();
	assert.equal(
		await read("document.querySelector('.combat-bar').matches(':hover')"),
		false,
	);
	assert.equal(
		await read(
			"getComputedStyle(document.querySelector('.combat-bar')).animationName",
		),
		"none",
	);
	assert.equal(
		await read(
			"getComputedStyle(document.querySelector('.combat-bar')).opacity",
		),
		"1",
	);
	// Reduced motion disables the entrance animation; hover-help opacity still transitions.
	await read(
		"Promise.all(document.querySelector('.power-label').getAnimations().map(animation => animation.finished))",
	);
	assert.equal(await helpOpacity(), "0");
	await read(`${api}.end()`);
	await client.send("Emulation.setEmulatedMedia", { features: [] });
	const targeting = await read(
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeTargeting()",
	);
	await read(
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeActionFeedback()",
	);
	return {
		attackFeedback: true,
		recklessnessTrainingAndTheme: true,
		targetIndicator: targeting.combatTargetIndicator,
		hoverHelp: true,
		appearance: true,
		helpAndAppearanceTheme: true,
		immediateEngagement: true,
		precisePower: 0.62,
		stopEngagement: true,
		startEngagement: true,
	};
}

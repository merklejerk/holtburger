import assert from "node:assert/strict";
import { probeUiShowcasePanels } from "./ui-showcase-panels-probe.mjs";

/** Verify pregame control styles and preference inheritance against the loaded theme. */
async function probePregameThemeBoundary(read) {
	const pregameBoundary = await read(() => {
		const theme = [...document.querySelectorAll('link[rel="stylesheet"]')].find(
			(link) => link.href.includes("travelers-kit") && link.media === "all",
		);
		if (!theme) throw new Error("Traveler’s Kit stylesheet missing");
		const preferences = document.createElement("section");
		preferences.className = "ui-theme";
		preferences.style.cssText =
			"--ui-text-scale:1.4;--ui-icon-scale:1.2;--ui-font-mono:monospace";
		const fixture = document.createElement("main");
		fixture.className = "client-pregame-screen ui-theme";
		fixture.style.cssText = "position:fixed;left:-10000px;top:0";
		fixture.innerHTML = `
			<button class="pregame-action pregame-quiet ui-button">Settings</button>
			<button class="client-character ui-button ui-option" aria-pressed="true">Character</button>
			<button class="pregame-primary ui-button" disabled>Enter world</button>
			<div class="creation-navigation ui-theme"><button class="ui-tab" aria-selected="true">Appearance</button></div>
			<input class="ui-input"><input type="checkbox" checked>
			<input type="range" class="ui-range" style="--ui-range-progress:50%">
			<section class="ui-well"><h2 class="ui-section-heading">Skills</h2></section>
			<dialog class="ui-dialog ui-theme"><header class="ui-frame">Confirmation</header><button class="ui-button">Cancel</button></dialog>`;
		preferences.append(fixture);
		document.querySelector("#app").append(preferences);
		const dialog = fixture.querySelector("dialog");
		const snapshot = () =>
			[fixture, ...fixture.querySelectorAll("*")].flatMap((node) =>
				[
					null,
					"::before",
					"::after",
					"::-webkit-slider-runnable-track",
					"::-webkit-slider-thumb",
				].map((pseudo) => {
					const style = getComputedStyle(node, pseudo);
					return {
						element: `${node.tagName.toLowerCase()}.${node.className}`,
						pseudo,
						style: Object.fromEntries(
							[
								"background",
								"box-shadow",
								"text-shadow",
								"border-image-source",
								"border-radius",
								"color",
								"font-family",
								"filter",
								"appearance",
								"--ui-surface-opacity",
								"--ui-button-background-color",
								"--ui-header-stripe-color",
								"--ui-item-selection-shadow",
							].map((property) => [property, style.getPropertyValue(property)]),
						),
					};
				}),
			);
		try {
			dialog.showModal();
			// Finish control transitions so the comparison measures settled CSS.
			for (const node of fixture.querySelectorAll("*"))
				node.style.transition = "none";
			const themed = snapshot();
			theme.disabled = true;
			const base = snapshot();
			const style = getComputedStyle(fixture);
			const typography = [
				"--ui-text-scale",
				"--ui-icon-scale",
				"--ui-font-mono",
			].map((property) => style.getPropertyValue(property).trim());
			return { themed, base, typography };
		} finally {
			theme.disabled = false;
			dialog.close();
			preferences.remove();
		}
	});
	assert.deepEqual(pregameBoundary.themed, pregameBoundary.base);
	assert.deepEqual(pregameBoundary.typography, ["1.4", "1.2", "monospace"]);
	return true;
}

/** DOM and interaction verification only; visual review belongs to the user. */
export async function probeUiShowcase(client, evaluate) {
	const read = (fn) => evaluate(client, `(${fn.toString()})()`);
	const wait = async (expression) => {
		const deadline = Date.now() + 30_000;
		while (!(await evaluate(client, expression))) {
			if (Date.now() > deadline)
				throw new Error(`Unified showcase timed out: ${expression}`);
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	};
	const click = async (label) =>
		evaluate(
			client,
			`([...document.querySelectorAll('button')].find(node=>node.textContent.trim()===${JSON.stringify(label)}).click())`,
		);
	const key = async (key, code, virtualKey) => {
		await client.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key,
			code,
			windowsVirtualKeyCode: virtualKey,
		});
		await client.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key,
			code,
			windowsVirtualKeyCode: virtualKey,
		});
	};
	// Verify actual hit testing on the painted rim, not just handle rectangles.
	const probeResizeFrame = async () => {
		const targets = await read(() => {
			const panel = document.querySelector(
				'.hud-window[aria-label="Component showcase"]',
			);
			const rect = panel.getBoundingClientRect();
			// Read resolved paint geometry so rem/calc theme lengths remain valid.
			const outset = Number.parseFloat(
				getComputedStyle(panel).borderImageOutset,
			);
			const x = {
				left: rect.left - outset + 0.5,
				right: rect.right + outset - 0.5,
			};
			const y = {
				top: rect.top - outset + 0.5,
				bottom: rect.bottom + outset - 0.5,
			};
			return [...panel.querySelectorAll(".hud-window-resize")].map((handle) => {
				const name = [...handle.classList]
					.find((value) => value.startsWith("hud-window-resize-"))
					.slice("hud-window-resize-".length);
				const point = {
					x: name.includes("left")
						? x.left
						: name.includes("right")
							? x.right
							: rect.left + rect.width / 2,
					y: name.includes("top")
						? y.top
						: name.includes("bottom")
							? y.bottom
							: rect.top + rect.height / 2,
				};
				return {
					name,
					point,
					hit: document.elementFromPoint(point.x, point.y) === handle,
				};
			});
		});
		assert.equal(targets.length, 8);
		for (const target of targets)
			assert.equal(target.hit, true, `Frame resize target: ${target.name}`);
		const right = targets.find((target) => target.name === "right");
		assert.ok(right);
		const width = () =>
			read(
				() =>
					document
						.querySelector('.hud-window[aria-label="Component showcase"]')
						.getBoundingClientRect().width,
			);
		const before = await width();
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			button: "left",
			clickCount: 1,
			...right.point,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			buttons: 1,
			x: right.point.x + 16,
			y: right.point.y,
		});
		await wait(
			`Math.abs(document.querySelector('.hud-window[aria-label="Component showcase"]').getBoundingClientRect().width - ${before + 16}) < 1`,
		);
		// Return to the starting geometry before releasing the same gesture.
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			buttons: 1,
			...right.point,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			button: "left",
			clickCount: 1,
			...right.point,
		});
		assert.ok(Math.abs((await width()) - before) < 1);
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: 0,
			y: 0,
		});
	};
	await wait(
		"document.querySelector('[data-showcase-ready]')?.dataset.showcaseReady === 'true'",
	);
	await wait(
		"document.querySelectorAll('.party-member').length === 8 && document.querySelector('.character-hud progress')?.value === 50",
	);
	await wait(
		"document.querySelector('[aria-label=\"Show waypoint guide\"]').checked && !document.querySelector('.minimap-waypoint-row').hidden && document.querySelector('.minimap-waypoint-pointer').style.display !== 'none'",
	);
	assert.equal(
		await read(
			() => document.querySelector('[aria-label="Showcase theme"]').value,
		),
		"Traveler’s Kit",
	);
	await wait(
		"[...document.querySelectorAll('link[rel=stylesheet]')].some(link => link.href.includes('travelers-kit') && link.media === 'all')",
	);
	const pregameThemeBoundary = await probePregameThemeBoundary(read);
	const baseline = await read(() => {
		const panel = document.querySelector(
			'.hud-window[aria-label="Component showcase"]',
		);
		window.__SHOWCASE_CLIENT_CANVAS__ = document.querySelector(
			"[data-game-viewport]",
		);
		window.__SHOWCASE_MINIMAP__ = document.querySelector(".minimap-frame");
		window.__SHOWCASE_SAMPLE_PANEL__ = panel;
		const input = panel.querySelector("input[placeholder]");
		input.value = "Retained draft";
		const style = getComputedStyle(panel);
		return {
			clientStages: document.querySelectorAll(".client-world").length,
			opacity: style.getPropertyValue("--ui-surface-opacity"),
			vitalColors: [...document.querySelectorAll(".ui-meter > span")].map(
				(node) => getComputedStyle(node).backgroundColor,
			),
		};
	});
	assert.equal(baseline.clientStages, 1);
	assert.equal(
		await read(
			() => document.querySelectorAll("[data-action-bar-surface]").length,
		),
		2,
	);
	assert.equal(
		await read(
			() => !!document.querySelector("[data-action-bar-surface].vertical"),
		),
		true,
	);
	await read(() => {
		const select = document.querySelector('[aria-label="Showcase theme"]');
		select.value = "Traveler’s Kit";
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await wait(
		"!document.querySelector('[aria-label=\"Showcase theme\"]').disabled",
	);
	const materials = await read(async () => {
		const panel = document.querySelector(
			'.hud-window[aria-label="Component showcase"]',
		);
		const check = panel.querySelector("input[type=checkbox]:checked");
		const sources = `${getComputedStyle(panel).borderImageSource},${getComputedStyle(panel.querySelector(".ui-frame")).backgroundImage},${getComputedStyle(check).backgroundImage},${getComputedStyle(document.querySelector(".minimap-frame")).backgroundImage}`;
		const urls = [...sources.matchAll(/url\("([^"]+)"\)/g)].map(
			(match) => match[1],
		);
		for (const url of new Set(urls)) {
			const image = new Image();
			image.src = url;
			await image.decode();
		}
		return {
			decoded: new Set(urls).size,
			opacity: getComputedStyle(panel).getPropertyValue("--ui-surface-opacity"),
			retained: panel === window.__SHOWCASE_SAMPLE_PANEL__,
			draft: panel.querySelector("input[placeholder]").value,
			vitalColors: [...document.querySelectorAll(".ui-meter > span")].map(
				(node) => getComputedStyle(node).backgroundColor,
			),
		};
	});
	assert.equal(materials.decoded, 4);
	assert.equal(materials.opacity, baseline.opacity);
	assert.equal(materials.retained, true);
	assert.equal(materials.draft, "Retained draft");
	assert.deepEqual(materials.vitalColors, baseline.vitalColors);
	await probeResizeFrame();
	// The default preview drives production navigation, including its own clear action.
	await wait(
		"!document.querySelector('.minimap-waypoint-row').hidden && document.querySelector('.minimap-waypoint-pointer').style.display !== 'none' && getComputedStyle(document.querySelector('.minimap-waypoint-pointer')).filter.includes('drop-shadow')",
	);
	assert.equal(
		await read(
			() =>
				window.__SHOWCASE_MINIMAP__ ===
				document.querySelector(".minimap-frame"),
		),
		true,
	);
	await read(() => document.querySelector(".minimap-waypoint-row").click());
	await wait(
		"!document.querySelector('[aria-label=\"Show waypoint guide\"]').checked && document.querySelector('.minimap-waypoint-row').hidden",
	);
	await read(() =>
		document.querySelector('[aria-label="Show waypoint guide"]').click(),
	);
	await wait("!document.querySelector('.minimap-waypoint-row').hidden");
	await read(() =>
		document.querySelector('[aria-label="Show waypoint guide"]').click(),
	);
	await wait(
		"document.querySelector('.minimap-waypoint-row').hidden && document.querySelector('.minimap-waypoint-pointer').style.display === 'none'",
	);
	await read(() =>
		[...document.querySelectorAll("label")]
			.find((label) => label.textContent.trim() === "Opaque override")
			.querySelector("input")
			.click(),
	);
	await wait(
		`getComputedStyle(document.documentElement).getPropertyValue('--ui-surface-opacity') === '1' && !document.querySelector('[aria-label="Showcase theme"]').disabled`,
	);
	await read(() =>
		[...document.querySelectorAll("label")]
			.find((label) => label.textContent.trim() === "Opaque override")
			.querySelector("input")
			.click(),
	);
	await wait(
		`getComputedStyle(document.documentElement).getPropertyValue('--ui-surface-opacity') === ${JSON.stringify(baseline.opacity)} && !document.querySelector('[aria-label="Showcase theme"]').disabled`,
	);
	await click("Reload theme");
	await wait(
		"!document.querySelector('[aria-label=\"Showcase theme\"]').disabled",
	);
	for (const kind of ["health", "stamina", "mana"]) {
		await click(`Low ${kind}`);
		await wait(
			`document.querySelector('.vital-warning-overlay').dataset.vitalWarning === '${kind}'`,
		);
		assert.equal(
			await read(
				() =>
					getComputedStyle(document.querySelector(".vital-warning-overlay"))
						.pointerEvents,
			),
			"none",
		);
		await click("Healthy");
		await wait(
			"document.querySelector('.vital-warning-overlay').dataset.vitalWarning === 'none'",
		);
	}
	const effectBounds = await read(() => {
		const stage = document
				.querySelector(".showcase-stage")
				.getBoundingClientRect(),
			effect = document
				.querySelector(".vital-warning-overlay")
				.getBoundingClientRect();
		return (
			Math.abs(stage.left - effect.left) < 1 &&
			Math.abs(stage.right - effect.right) < 1 &&
			Math.abs(stage.top - effect.top) < 1 &&
			Math.abs(stage.bottom - effect.bottom) < 1
		);
	});
	assert.equal(effectBounds, true);
	await read(() => {
		const input = document.querySelector(
			".showcase-window-body .toggle-field input",
		);
		window.__SHOWCASE_CHECKED__ = input.checked;
		input.click();
	});
	assert.equal(
		await read(
			() =>
				document.querySelector(".showcase-window-body .toggle-field input")
					.checked !== window.__SHOWCASE_CHECKED__,
		),
		true,
	);
	await read(() =>
		document
			.querySelector(".showcase-window-body input[type=range]:not(:disabled)")
			.focus(),
	);
	await key("Home", "Home", 36);
	await wait(
		"document.querySelector('.showcase-window-body input[type=range]:not(:disabled)').style.getPropertyValue('--ui-range-progress') === '0%'",
	);
	await key("End", "End", 35);
	await wait(
		"document.querySelector('.showcase-window-body input[type=range]:not(:disabled)').style.getPropertyValue('--ui-range-progress') === '100%'",
	);
	await click("Reset charge");
	await wait(
		"document.querySelector('.showcase-window-body input[type=range]:not(:disabled)').value === '0.65'",
	);
	await click("Open dialog");
	await wait("!!document.querySelector('.showcase-dialog[open]')");
	await key("Escape", "Escape", 27);
	await wait("!document.querySelector('.showcase-dialog')");
	await read(() =>
		document.querySelector('[aria-label="Preview color: 1"]').click(),
	);
	await wait(
		"!!document.querySelector('[role=menu][aria-label=\"Preview color\"]')",
	);
	await read(() =>
		document
			.querySelector('[aria-label="Preview color"]')
			.querySelectorAll("button")[2]
			.click(),
	);
	await wait("!!document.querySelector('[aria-label=\"Preview color: 3\"]')");
	await click("Open command dropdown");
	await wait(
		"!!document.querySelector('[role=menu][aria-label=\"Showcase commands\"]')",
	);
	assert.equal(
		await read(
			() =>
				!!document.querySelector(
					'[aria-label="Showcase commands"] button:disabled',
				),
		),
		true,
	);
	await read(() =>
		document
			.querySelector('[aria-label="Showcase commands"] [role=menuitemcheckbox]')
			.click(),
	);
	await wait(
		"document.querySelector('[aria-label=\"Showcase commands\"] [role=menuitemcheckbox]').getAttribute('aria-checked') === 'false'",
	);
	await read(() =>
		document
			.querySelector('[aria-label="Showcase commands"] [aria-haspopup=menu]')
			.click(),
	);
	await wait(
		"!!document.querySelector('[role=menu][aria-label=\"Map markers\"]')",
	);
	await read(() =>
		document
			.querySelector('[aria-label="Map markers"]')
			.querySelectorAll("button")[1]
			.click(),
	);
	await wait(
		"document.querySelector('[aria-label=\"Map markers\"]').querySelectorAll('button')[1].getAttribute('aria-checked') === 'true'",
	);
	await read(() => document.getElementById("showcase-characters-tab").click());
	await wait(
		"!document.querySelector('[role=menu][aria-label=\"Showcase commands\"]') && document.getElementById('showcase-controls-panel').inert",
	);
	await read(() => document.getElementById("showcase-characters-tab").focus());
	await key("ArrowRight", "ArrowRight", 39);
	await wait("!document.getElementById('showcase-diagnostics-panel').hidden");
	await key("Home", "Home", 36);
	await wait("!document.getElementById('showcase-controls-panel').hidden");
	assert.equal(
		await read(
			() =>
				document.querySelector(".showcase-window-body input[placeholder]")
					.value,
		),
		"Retained draft",
	);
	await click("Hide control samples");
	const panels = await probeUiShowcasePanels(client, evaluate);
	await click("Show control samples");
	await wait(
		"!!document.querySelector('.hud-window[aria-label=\"Component showcase\"]')",
	);
	assert.equal(
		await read(
			() =>
				document.querySelector(
					'.hud-window[aria-label="Component showcase"]',
				) === window.__SHOWCASE_SAMPLE_PANEL__ &&
				document.querySelector(".showcase-window-body input[placeholder]")
					.value === "Retained draft",
		),
		true,
	);
	await read(() => {
		const select = document.querySelector('[aria-label="Showcase theme"]');
		select.value = "base";
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await wait(
		"!document.querySelector('[aria-label=\"Showcase theme\"]').disabled",
	);
	assert.equal(
		await read(() =>
			getComputedStyle(
				document.querySelector(".minimap-waypoint-pointer"),
			).filter.includes("drop-shadow"),
		),
		true,
	);
	const hudFamilies = await read(() => {
		const icon = document.querySelector(".shortcut-dock button");
		const control = document.querySelector(".contents-header");
		const saved = [icon.style.cssText, control.style.cssText];
		try {
			for (const node of [icon, control]) {
				node.style.setProperty("--ui-hud-button-background", "rgb(1,2,3)");
				node.style.setProperty("--ui-hud-control-background", "rgb(4,5,6)");
				node.style.setProperty("--ui-hud-button-indicator-color", "rgb(7,8,9)");
				node.style.setProperty(
					"--ui-hud-control-indicator-color",
					"rgb(10,11,12)",
				);
			}
			return {
				iconBackground:
					getComputedStyle(icon, "::before").backgroundColor === "rgb(1, 2, 3)",
				controlBackground:
					getComputedStyle(control, "::before").backgroundColor ===
					"rgb(4, 5, 6)",
				iconIndicator:
					getComputedStyle(icon).boxShadow.includes("rgb(7, 8, 9)"),
				controlIndicator:
					getComputedStyle(control).boxShadow.includes("rgb(10, 11, 12)"),
			};
		} finally {
			icon.style.cssText = saved[0];
			control.style.cssText = saved[1];
		}
	});
	await probeResizeFrame();
	assert.deepEqual(hudFamilies, {
		iconBackground: true,
		controlBackground: true,
		iconIndicator: true,
		controlIndicator: true,
	});

	assert.equal(
		await read(
			() =>
				window.__SHOWCASE_CLIENT_CANVAS__ ===
					document.querySelector("[data-game-viewport]") &&
				window.__SHOWCASE_MINIMAP__ ===
					document.querySelector(".minimap-frame"),
		),
		true,
	);
	await read(() => {
		delete window.__SHOWCASE_CLIENT_CANVAS__;
		delete window.__SHOWCASE_MINIMAP__;
		delete window.__SHOWCASE_SAMPLE_PANEL__;
		delete window.__SHOWCASE_CHECKED__;
	});
	return {
		pregameThemeBoundary,
		oneClientStage: true,
		materials,
		halfFullXp: true,
		partyMembers: 8,
		productionActionBars: true,
		vitalEffectPresetsAndBounds: true,
		nativeControlsAndSliderFill: true,
		dialogAndSharedTabs: true,
		dropdowns: true,
		panels,
		baseRestored: true,
		frameResizeTargets: true,
		hudFamilies,
		retainedClientAndMinimap: true,
	};
}

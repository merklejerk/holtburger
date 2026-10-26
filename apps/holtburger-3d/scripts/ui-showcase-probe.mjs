import assert from "node:assert/strict";
import { probeUiShowcasePanels } from "./ui-showcase-panels-probe.mjs";

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
	await wait(
		"document.querySelector('[data-showcase-ready]')?.dataset.showcaseReady === 'true'",
	);
	await wait(
		"document.querySelectorAll('.party-member').length === 8 && document.querySelector('.character-hud progress')?.value === 50",
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
	// The new preview drives production navigation, including its own clear action.
	await read(() =>
		document.querySelector('[aria-label="Show waypoint guide"]').click(),
	);
	await wait(
		"!document.querySelector('.minimap-waypoint-row').hidden && document.querySelector('.minimap-waypoint-pointer').style.display !== 'none'",
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
		hudFamilies,
		retainedClientAndMinimap: true,
	};
}

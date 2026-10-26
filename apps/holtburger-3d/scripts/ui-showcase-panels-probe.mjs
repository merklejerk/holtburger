import assert from "node:assert/strict";

/** All panels open inside the same mounted client; appearance never owns their lifetime. */
export async function probeUiShowcasePanels(client, evaluate) {
	const read = (fn) => evaluate(client, `(${fn.toString()})()`);
	const wait = async (expression) => {
		const deadline = Date.now() + 30_000;
		while (!(await evaluate(client, expression))) {
			const error = await read(() =>
				[...document.querySelectorAll("[role=alert]")]
					.filter((node) => node.getClientRects().length)
					.map((node) => node.textContent)
					.join("\n"),
			);
			if (error) throw new Error(error);
			if (Date.now() > deadline)
				throw new Error(`Showcase panel timed out: ${expression}`);
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	};
	const selectors = {
		inventory: '[aria-label="Equipped items"]',
		vendor: "[data-vendor-panel]",
		trade: ".trade-panel",
		inspection: ".inspection-facts",
		book: ".book-scroll",
		spells: ".spell-bar",
		combat: ".combat-bar",
		salvage: ".salvage-panel",
	};
	const panels = await read(() =>
		[...document.querySelectorAll("button[data-showcase-panel]")].map(
			(node) => node.dataset.showcasePanel,
		),
	);
	assert.equal(panels.length, Object.keys(selectors).length);
	const candidate = await read(
		() => document.querySelector('[aria-label="Showcase theme"]').value,
	);
	const results = [];
	for (const panel of panels) {
		const selector = selectors[panel];
		if (selector === undefined)
			throw new Error(`Missing showcase panel assertion: ${panel}`);
		await evaluate(
			client,
			`document.querySelector('button[data-showcase-panel="${panel}"]').click()`,
		);
		await wait(
			`document.querySelector('[data-showcase-ready]').dataset.showcasePending === 'false' && !!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`,
		);
		await evaluate(
			client,
			`window.__SHOWCASE_PANEL_NODE__ = document.querySelector(${JSON.stringify(selector)})`,
		);
		for (const id of ["base", candidate]) {
			await evaluate(
				client,
				`(()=>{const select=document.querySelector('[aria-label="Showcase theme"]');select.value=${JSON.stringify(id)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
			);
			await wait(
				"!document.querySelector('[aria-label=\"Showcase theme\"]').disabled",
			);
			assert.equal(
				await evaluate(
					client,
					`window.__SHOWCASE_PANEL_NODE__ === document.querySelector(${JSON.stringify(selector)})`,
				),
				true,
			);
			assert.equal(
				await read(
					() =>
						window.__SHOWCASE_CLIENT_CANVAS__ ===
							document.querySelector("[data-game-viewport]") &&
						window.__SHOWCASE_MINIMAP__ ===
							document.querySelector(".minimap-frame") &&
						document
							.querySelector(".showcase-stage")
							.contains(window.__SHOWCASE_CLIENT_CANVAS__),
				),
				true,
			);
			if (panel === "combat") {
				const chrome = await read(() => {
					const bar = document.querySelector(".combat-bar");
					const decorations = [
						...bar.querySelectorAll(".gauge-decoration,.height-face"),
					];
					return {
						backdrop: getComputedStyle(bar.querySelector(".gauge-background"))
							.display,
						hiddenDecorations: decorations.every(
							(node) => getComputedStyle(node).display === "none",
						),
						visibleDecorations: decorations.every(
							(node) => getComputedStyle(node).display !== "none",
						),
						faces: [...bar.querySelectorAll(".height-face path")].map(
							(node) => ({
								finite: !node.getAttribute("d").includes("NaN"),
								length: node.getTotalLength(),
							}),
						),
						decorationPassthrough: decorations.every(
							(node) => getComputedStyle(node).pointerEvents === "none",
						),
					};
				});
				assert.equal(chrome.decorationPassthrough, true);
				if (id === "base") assert.equal(chrome.hiddenDecorations, true);
				else {
					assert.equal(chrome.backdrop, "none");
					assert.equal(chrome.visibleDecorations, true);
					assert.equal(chrome.faces.length, 3);
					assert.ok(
						chrome.faces.every((face) => face.finite && face.length > 0),
					);
					for (const height of ["high", "medium", "low"]) {
						const point = await evaluate(
							client,
							`(() => { const node=document.querySelector('.combat-bar .height.${height}'); const r=node.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`,
						);
						await client.send("Input.dispatchMouseEvent", {
							type: "mousePressed",
							button: "left",
							clickCount: 1,
							...point,
						});
						await client.send("Input.dispatchMouseEvent", {
							type: "mouseReleased",
							button: "left",
							clickCount: 1,
							...point,
						});
						await wait(
							`document.querySelector('.combat-bar .height.${height}').getAttribute('aria-pressed') === 'true'`,
						);
					}
					await read(() =>
						document.querySelector(".combat-bar .power-control").focus(),
					);
					for (const [key, value] of [
						["Home", "0"],
						["End", "100"],
					]) {
						await client.send("Input.dispatchKeyEvent", {
							type: "keyDown",
							key,
							code: key,
						});
						await client.send("Input.dispatchKeyEvent", {
							type: "keyUp",
							key,
							code: key,
						});
						await wait(
							`document.querySelector('.combat-bar .power-control').getAttribute('aria-valuenow') === '${value}'`,
						);
					}
					await read(() =>
						document.querySelector(".combat-bar .power-control").blur(),
					);
				}
			}
		}
		results.push({
			panel,
			component: true,
			retainedAcrossThemeSwitch: true,
			sameStage: true,
		});
		await evaluate(
			client,
			`(()=>{const window=document.querySelector(${JSON.stringify(selector)}).closest('.hud-window');window?.querySelector('.hud-window-close').click();delete globalThis.__SHOWCASE_PANEL_NODE__;})()`,
		);
	}
	return results;
}

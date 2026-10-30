import assert from "node:assert/strict";

/** Structural browser evidence for top-layer feedback; no screenshot or visual acceptance. */
export async function probeItemCellPulse(client, evaluate) {
	const result = await evaluate(
		client,
		`(${async function () {
			const { pulseItemCell } = await import(
				new URL("/src/app/item-cell-pulse.ts", location.origin).href
			);
			const { bindContentsActivation } = await import(
				new URL("/src/client/client-contents-activation.ts", location.origin)
					.href
			);
			const { contentsFeedback } = await import(
				new URL("/src/client/client-contents-feedback.ts", location.origin).href
			);
			const { entityFacts } = await import(
				new URL(
					"/src/client/client-entity-mirror.test-support.ts",
					location.origin,
				).href
			);
			const check = (value, message) => {
				if (!value) throw new Error(message);
			};
			const frame = () =>
				new Promise((resolve) => requestAnimationFrame(resolve));
			const fixture = document.createElement("div");
			fixture.className = "ui-theme pulse-probe";
			fixture.style.cssText =
				"position:fixed;left:160px;top:120px;width:80px;height:80px;overflow:auto;z-index:2147483647;--ui-item-pulse-duration:10000ms";
			fixture.innerHTML =
				'<style>.pulse-probe .item-grid-cell { color: rgb(12, 34, 56); }</style><div style="height:200px"><button class="item-grid-cell ui-item-cell" data-item-guid="910" style="position:relative;display:block;width:40px;height:40px;margin:0">Item</button></div>';
			document.querySelector("#app").append(fixture);
			const cell = fixture.querySelector("button");
			let state = { kind: "idle" };
			let uses = 0;
			let targets = 0;
			let clicks = 0;
			cell.addEventListener("click", () => {
				clicks++;
			});
			const unbind = bindContentsActivation(
				fixture,
				".ui-item-cell[data-item-guid]",
				{
					snapshot: () => state,
					target: () => {
						targets++;
					},
				},
				() => 910,
				() => {},
				() => {
					uses++;
				},
			);
			const feedback = contentsFeedback(fixture, {
				sections: [],
				pending: false,
			});
			const stop = () => {
				for (const copy of fixture.querySelectorAll(".ui-item-cell-pulse")) {
					for (const animation of copy.getAnimations()) animation.finish();
				}
			};
			try {
				cell.focus();
				const before = cell.getBoundingClientRect();
				cell.click();
				check(
					fixture.querySelector(".ui-item-cell-pulse") === null,
					"Selection must not pulse",
				);
				const focusBefore = document.activeElement;
				cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
				const first = fixture.querySelector(".ui-item-cell-pulse");
				check(
					uses === 1 && first?.matches(":popover-open"),
					"Double-click must activate once and open a top-layer copy",
				);
				check(
					first.inert && first.getAttribute("aria-hidden") === "true",
					"Copy must be inert and inaccessible",
				);
				check(
					fixture.querySelectorAll("[data-item-guid]").length === 1 &&
						fixture.querySelectorAll(".item-grid-cell").length === 1,
					"Copy must not duplicate interaction identities",
				);
				check(
					document.activeElement === focusBefore &&
						getComputedStyle(cell).opacity === "0",
					`Pulse must retain focus while transparent: before=${focusBefore?.outerHTML}, after=${document.activeElement?.outerHTML}, opacity=${getComputedStyle(cell).opacity}`,
				);
				check(
					getComputedStyle(first).color === getComputedStyle(cell).color,
					"Copy must preserve source color after losing interaction selectors",
				);
				check(
					getComputedStyle(first).pointerEvents === "none",
					"Copy must ignore pointer input",
				);
				const hit = document.elementFromPoint(
					before.x + before.width / 2,
					before.y + before.height / 2,
				);
				check(hit === cell, "Original must retain hit testing during pulse");
				const animation = first
					.getAnimations()
					.find((entry) => entry.effect.target === first);
				check(animation !== undefined, "Pulse must have a browser animation");
				animation.currentTime = animation.effect.getTiming().duration * 0.4;
				const expanded = first.getBoundingClientRect();
				check(
					expanded.width > before.width &&
						expanded.left < fixture.getBoundingClientRect().left,
					"Pulse must expand past scroll clipping",
				);
				check(
					cell.getBoundingClientRect().width === before.width,
					"Pulse must preserve grid layout",
				);
				pulseItemCell(cell, "arrival");
				check(
					first === fixture.querySelector(".ui-item-cell-pulse"),
					"Arrival must coalesce with an active interaction",
				);
				cell.click();
				check(clicks === 2, "Repeated clicks must reach original button");
				pulseItemCell(cell, "interaction");
				check(
					!first.isConnected &&
						fixture.querySelectorAll(".ui-item-cell-pulse").length === 1,
					"Interaction must restart without accumulating copies",
				);
				stop();
				await frame();
				check(
					!cell.hasAttribute("data-ui-cell-pulsing") &&
						getComputedStyle(cell).opacity === "1" &&
						!fixture.querySelector(".ui-item-cell-pulse"),
					"Completion must restore original and remove copy",
				);
				state = { kind: "acquiring", generation: 1 };
				cell.click();
				cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
				check(
					targets === 1 && uses === 1,
					"Target acquisition must pulse without double-activating",
				);
				fixture.scrollTop = 10;
				await frame();
				check(
					!fixture.querySelector(".ui-item-cell-pulse"),
					"Scrolling must retire overlay",
				);
				fixture.scrollTop = 0;
				pulseItemCell(cell, "interaction");
				fixture.hidden = true;
				await frame();
				check(
					!fixture.querySelector(".ui-item-cell-pulse"),
					"Hiding a panel must retire overlay",
				);
				fixture.hidden = false;
				const section = (items) => ({
					container: entityFacts(900, {
						storage: {
							kind: "container",
							roster: "announced",
							itemCapacity: 24,
							packCapacity: 7,
						},
					}),
					rootSection: true,
					items,
					packs: [],
					unslotted: [],
				});
				feedback.update({ sections: [section([])], pending: false });
				await frame();
				feedback.update({
					sections: [section([entityFacts(910)])],
					pending: false,
				});
				// A second publication before the DOM commit must retain the membership change.
				feedback.update({
					sections: [section([entityFacts(910)])],
					pending: false,
				});
				await frame();
				check(
					!!fixture.querySelector(".ui-item-cell-pulse"),
					"Contents arrival must survive superseding view publications before DOM commit",
				);
				stop();
				await frame();
				feedback.update({
					sections: [section([entityFacts(910)])],
					pending: true,
				});
				feedback.update({
					sections: [section([entityFacts(910)])],
					pending: false,
				});
				await frame();
				check(
					!fixture.querySelector(".ui-item-cell-pulse"),
					"Same-flush recovery must establish a quiet baseline",
				);
				pulseItemCell(cell, "interaction");
				cell.remove();
				await frame();
				check(
					!fixture.querySelector(".ui-item-cell-pulse"),
					"Unmounting source must retire overlay",
				);
				return {
					topLayer: true,
					layoutAndInputRetained: true,
					restartAndCoalescing: true,
					targeting: true,
					arrivals: true,
					lifecycleCleanup: true,
				};
			} finally {
				stop();
				feedback.destroy();
				unbind();
				fixture.remove();
			}
		}})()`,
	);
	assert.equal(result.topLayer, true);
	const reduced = await (async () => {
		await client.send("Emulation.setEmulatedMedia", {
			features: [{ name: "prefers-reduced-motion", value: "reduce" }],
		});
		try {
			return await evaluate(
				client,
				`(${async function () {
					const { pulseItemCell } = await import(
						new URL("/src/app/item-cell-pulse.ts", location.origin).href
					);
					const cell = document.createElement("button");
					cell.className = "ui-item-cell";
					cell.textContent = "Reduced motion";
					document.body.append(cell);
					try {
						pulseItemCell(cell, "interaction");
						return (
							!cell.hasAttribute("data-ui-cell-pulsing") &&
							!document.querySelector(".ui-item-cell-pulse")
						);
					} finally {
						cell.remove();
					}
				}})()`,
			);
		} finally {
			await client.send("Emulation.setEmulatedMedia", { features: [] });
		}
	})();
	assert.equal(reduced, true);
	return { ...result, reducedMotion: true };
}

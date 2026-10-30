import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/** Native clicks exercise the production inventory entry point and frontend-owned confirmation. */
export async function probeItemUse(client, evaluateExpression) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const read = (expression) => evaluateExpression(client, expression);
	const state = () => read(api + ".itemUseProbe().snapshot()");
	const point = (selector) =>
		read(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error('Missing use-probe element');
        element.scrollIntoView({ block: 'nearest' });
        const r = element.getBoundingClientRect(); const p = { x: r.left+r.width/2, y: r.top+r.height/2 };
        const hit = document.elementFromPoint(p.x, p.y);
        if (!element.contains(hit)) throw new Error("Item-use probe target is occluded: " + hit?.closest("button")?.outerHTML);
        return p;
    })()`);
	const click = async (selector, double = false, modifiers = 0) => {
		const p = await point(selector);
		for (let count = 1; count <= (double ? 2 : 1); count++) {
			await client.send("Input.dispatchMouseEvent", {
				type: "mousePressed",
				...p,
				button: "left",
				buttons: 1,
				clickCount: count,
				modifiers,
			});
			await client.send("Input.dispatchMouseEvent", {
				type: "mouseReleased",
				...p,
				button: "left",
				buttons: 0,
				clickCount: count,
				modifiers,
			});
		}
	};
	const reply = async (outcome) => {
		const pending = await state();
		assert.equal(pending.kind, "submitting");
		await read(
			`${api}.itemUseProbe().reply(${JSON.stringify({ sequence: pending.request.sequence, outcome })})`,
		);
		return pending.request;
	};
	const resolveTarget = async (eligible) => {
		const pending = await state();
		assert.equal(pending.kind, "resolving");
		await read(
			`${api}.itemUseProbe().targetReply(${JSON.stringify({ sequence: pending.sequence, eligible })})`,
		);
	};
	const food =
		'.client-inventory .contents-scroll .item-grid-cell[data-item-guid="91"]';
	const tool = '.equipment-row .item-grid-cell[data-item-guid="95"]';
	await read(api + ".beginItemUseProbe()");
	await read(api + ".itemUseProbe().ready()");

	const action = ".action-cell[data-action-cell='1']";
	const bind = async (source, id, destination = action) => {
		const start = await point(source);
		const end = await point(destination);
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...start,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			...end,
			button: "left",
			buttons: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			...end,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
		await read(api + ".itemUseProbe().ready()");
		assert.equal(
			await read(
				`document.querySelector(${JSON.stringify(destination)}).dataset.actionItem`,
			),
			String(id),
		);
	};

	try {
		await read(api + ".itemUseProbe().select(91)");
		await click(food, true);
		assert.equal(await read(api + ".itemUseProbe().selected()"), 91);
		let pending = await state();
		assert.equal(pending.kind, "submitting");
		assert.deepEqual(pending.request.intent, {
			kind: "direct",
			source: 91,
			unrestricted: false,
		});
		await reply({ kind: "executed" });
		const boundFood = ".action-cell[data-action-cell='2']";
		await bind(food, 91, boundFood);
		await bind(tool, 95);
		await click(action);
		await resolveTarget(false);
		assert.equal((await state()).kind, "acquiring");
		// Answer the production compatibility queries for all mounted cells. The same
		// physical item in inventory and on the action bar must share one query.
		const equippedTargetSequence = await read(`(async () => {
			await new Promise(requestAnimationFrame);
			const queries = ${api}.itemUseProbe().queryCommands().map(entry => entry.args.query);
			const cells = queries.filter(query => query.target === 91);
			if (cells.length !== 1) throw new Error('Expected one query for both food cells');
			for (const query of queries)
				${api}.itemUseProbe().targetReply({ sequence: query.sequence, eligible: query.target === 91 });
			await new Promise(requestAnimationFrame);
			const considered = ${api}.itemUseProbe().snapshot().considered?.sequence;
			const equipped = queries.find(query => query.target === 95 && query.sequence !== considered);
			if (!equipped) throw new Error('Missing equipped target compatibility query');
			return equipped.sequence;
		})()`);
		for (const [selector, dimmed] of [
			[food, false],
			[boundFood, false],
			[tool, true],
			[action, true],
			[".action-cell[data-action-cell='3']", true],
		]) {
			assert.equal(
				await read(
					`document.querySelector(${JSON.stringify(selector)}).dataset.combineDimmed`,
				),
				String(dimmed),
			);
		}
		await read(`(async () => {
            const expected = 'Use ' + ${api}.itemUseProbe().snapshot().name + ' on… (Escape to cancel)';
            const deadline = performance.now() + 5000;
            while (performance.now() < deadline) {
                const notification = document.querySelector('[aria-label="Notifications"] .client-toast[role="status"]');
                if (notification?.textContent.trim() === expected) return;
                await new Promise(requestAnimationFrame);
            }
            throw new Error('Target acquisition guidance did not appear in the existing toast surface');
        })()`);

		const hover = async (selector, target, eligible) => {
			await client.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				...(await point(selector)),
				buttons: 0,
			});
			// The viewport clears hover while the pointer is over a panel. Install the
			// fixture hit only after entering the viewport so its timer cannot erase it.
			if (selector === ".client-canvas")
				await read(api + `.itemUseProbe().hoverWorld(${target})`);
			// Viewport picking may publish after the pointer event completes.
			const sequence = await read(`(async () => {
                const deadline = performance.now() + 5000;
                while (performance.now() < deadline) {
                    const state = ${api}.itemUseProbe().snapshot();
                    if (state.kind === 'acquiring' && state.considered?.target === ${target})
                        return state.considered.sequence;
                    await new Promise(requestAnimationFrame);
                }
                throw new Error('Hover did not consider target ' + ${target} + ': ' +
                    JSON.stringify(${api}.itemUseProbe().queryCommands().at(-1)));
            })()`);
			await read(
				`${api}.itemUseProbe().targetReply(${JSON.stringify({ sequence, eligible })})`,
			);
			const asset = eligible
				? "combine-cursor-eligible.svg"
				: "combine-cursor-ineligible.svg";
			const svg = await readFile(
				new URL("../src/client/" + asset, import.meta.url),
				"utf8",
			);
			const color = [...svg.matchAll(/stroke="([^"]+)"/g)].at(-1)?.[1];
			assert.ok(color, "Cursor asset supplies a foreground color");
			// Vite embeds small SVG cursors as data URLs, so inspect the rendered color.
			// Eligibility is accepted by the interaction owner before the cold UI
			// publishes its cursor cue. Observe that publication instead of its pending predecessor.
			await read(`(async () => {
                const deadline = performance.now() + 5000;
                let cursor;
                while (performance.now() < deadline) {
                    cursor = getComputedStyle(document.querySelector(${JSON.stringify(selector)})).cursor;
                    if (decodeURIComponent(cursor).includes(${JSON.stringify(color)})) return;
                    await new Promise(requestAnimationFrame);
                }
                throw new Error('Target eligibility cursor did not update: ' + cursor);
            })()`);
			assert.equal((await state()).kind, "acquiring");
		};
		await hover(food, 91, true);
		// The equipped target's authority verdict must control its effective opacity,
		// including while the pointer is over an item that cannot be equipped there.
		await read(`(async () => {
			${api}.itemUseProbe().targetReply({ sequence: ${equippedTargetSequence}, eligible: true });
			const cell = document.querySelector(${JSON.stringify(tool)});
			const row = cell.closest('.equipment-row');
			const deadline = performance.now() + 5000;
			while (performance.now() < deadline) {
				const opacity = Number(getComputedStyle(cell).opacity) * Number(getComputedStyle(row).opacity);
				if (opacity === 1) return;
				await new Promise(requestAnimationFrame);
			}
			throw new Error('Eligible equipped combine target remained dimmed during inventory hover');
		})()`);
		await hover(boundFood, 91, true);
		await hover(tool, 95, false);
		// Equipment hover still supplies ordinary inventory hints; combine admission
		// takes precedence over those hints on the eligible inventory target.
		await read(`(async () => {
			const cell = document.querySelector(${JSON.stringify(food)});
			const deadline = performance.now() + 5000;
			while (performance.now() < deadline) {
				if (Number(getComputedStyle(cell).opacity) === 1) return;
				await new Promise(requestAnimationFrame);
			}
			throw new Error('Equipment hover overrode eligible inventory combine target opacity');
		})()`);
		await click(tool);
		assert.deepEqual((await state()).request.intent, {
			kind: "targeted",
			source: 95,
			target: 95,
		});
		await reply({
			kind: "rejected",
			reason: "Fixture incompatible equipped target",
		});
		await hover(".client-canvas", 91, true);
		await read(api + ".itemUseProbe().hoverWorld(null)");
		await click(boundFood);
		pending = await state();
		assert.deepEqual(pending.request.intent, {
			kind: "targeted",
			source: 95,
			target: 91,
		});
		await reply({ kind: "rejected", reason: "Fixture incompatible target" });
		assert.equal((await state()).kind, "acquiring");
		await click(food, true);
		await reply({
			kind: "consequence-changed",
			evaluation: {
				kind: "destroy-item",
				target: 91,
				amount: 1,
				name: "Fixture armor",
			},
		});
		assert.equal((await state()).kind, "confirming");
		assert.equal(
			await read(
				"document.querySelector('dialog[open]')?.textContent.includes('Fixture armor')",
			),
			true,
		);
		await read(api + ".itemUseProbe().select(1)");
		await click("dialog[open] button:last-child");
		pending = await state();
		assert.equal(pending.kind, "submitting");
		assert.equal(pending.request.intent.target, 91);
		assert.deepEqual(pending.request.expected, {
			kind: "destroy-item",
			target: 91,
			amount: 1,
		});
		await reply({ kind: "executed" });
		assert.equal(
			await read("document.querySelectorAll('[data-combine-dimmed]').length"),
			0,
		);
		await read(api + ".itemUseProbe().select(95)");
		await click(action);
		await resolveTarget(false);
		await click('button[aria-label="Interact"]');
		// Interact targets the selected worn source while acquisition is active.
		assert.equal((await state()).kind, "submitting");
		await reply({
			kind: "rejected",
			reason: "Fixture incompatible self-target",
		});
		await client.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Escape",
			code: "Escape",
		});
		await client.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Escape",
			code: "Escape",
		});
		assert.equal((await state()).kind, "idle");
		await read(`(async () => {
            const deadline = performance.now() + 1000;
            while (performance.now() < deadline) {
                const notifications = Array.from(document.querySelectorAll('.client-toast'));
                if (!notifications.some(node => node.textContent.includes('Escape to cancel'))) return;
                await new Promise(requestAnimationFrame);
            }
            throw new Error('Cancelled target acquisition retained its toast guidance');
        })()`);

		await read(api + ".itemUseProbe().select(91)");
		const binding = await read(api + ".itemUseProbe().interactBinding");
		assert.ok(binding, "An interact shortcut is configured");
		const key = {
			key: binding.key ?? "Unidentified",
			code: binding.code ?? "",
			modifiers:
				(binding.alt ? 1 : 0) |
				(binding.ctrl ? 2 : 0) |
				(binding.meta ? 4 : 0) |
				(binding.shift ? 8 : 0),
		};
		await client.send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
		await client.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
		assert.equal((await state()).request.intent.kind, "direct");
		await reply({ kind: "executed" });

		await bind(food, 91);
		for (const count of [12, 2, 1]) {
			await read(api + `.itemUseProbe().setFoodCount(${count})`);
			await read(api + ".itemUseProbe().ready()");
			assert.equal(
				await read(
					`document.querySelector(${JSON.stringify(action)}).querySelector(".item-count-overlay")?.textContent.trim() ?? null`,
				),
				count > 1 ? String(count) : null,
			);
		}
		await click(action);
		assert.deepEqual((await state()).request.intent, {
			kind: "direct",
			source: 91,
			unrestricted: false,
		});
		await reply({ kind: "executed" });
		await bind(tool, 95);
		for (const current of [40, 10, 0, 50, null]) {
			await read(api + `.itemUseProbe().setToolStructure(${current}, 50)`);
			await read(api + ".itemUseProbe().ready()");
			const overlays = await read(`(() => {
				return [${JSON.stringify(action)}, ${JSON.stringify(tool)}].map(selector => {
					const cell = document.querySelector(selector);
					const fill = cell.querySelector('.item-cell-meter-fill');
					const equipped = cell.querySelector('.item-equipped');
					const count = cell.querySelector('.item-count-overlay');
					return { title: cell.title, height: fill?.style.height ?? null, equipped: equipped !== null,
						overlaps: fill !== null && ((equipped !== null && equipped.getBoundingClientRect().right > fill.getBoundingClientRect().left) || count.getBoundingClientRect().right > fill.getBoundingClientRect().left) };
				});
			})()`);
			for (const [index, overlay] of overlays.entries()) {
				assert.equal(overlay.equipped, index === 0);
				assert.equal(
					overlay.height,
					current === null || current === 50
						? null
						: `${(current / 50) * 100}%`,
				);
				assert.equal(
					overlay.title.includes(`[${current}/50]`),
					current !== null && current !== 50,
				);
				assert.equal(overlay.overlaps, false);
			}
		}

		await click(action);
		await resolveTarget(true);
		assert.deepEqual((await state()).request.intent, {
			kind: "targeted",
			source: 95,
			target: 1,
		});
		await reply({ kind: "executed" });
		await read(api + ".itemUseProbe().select(91)");
		const alternate = await read(api + ".itemUseProbe().alternateModifier");
		await click(
			action,
			false,
			{ alt: 1, ctrl: 2, meta: 4, shift: 8 }[alternate],
		);
		await resolveTarget(true);
		assert.deepEqual((await state()).request.intent, {
			kind: "targeted",
			source: 95,
			target: 91,
		});
		await reply({ kind: "executed" });

		await click(action);
		await resolveTarget(false);
		assert.equal((await state()).kind, "acquiring");
		await click(food);
		assert.deepEqual((await state()).request.intent, {
			kind: "targeted",
			source: 95,
			target: 91,
		});
		await reply({ kind: "executed" });
		await read(api + ".itemUseProbe().select(null)");
		await click(
			action,
			false,
			{ alt: 1, ctrl: 2, meta: 4, shift: 8 }[alternate],
		);
		assert.equal((await state()).kind, "acquiring");

		// A drag that captured the old instance cannot clear its automatic replacement.
		const dragStart = await point(action);
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			...dragStart,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: 5,
			y: 5,
			button: "left",
			buttons: 1,
		});
		await read(api + ".itemUseProbe().depleteSupply()");
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x: 5,
			y: 5,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
		await read(api + ".itemUseProbe().ready()");
		assert.equal(
			await read(
				`document.querySelector(${JSON.stringify(action)}).dataset.actionItem`,
			),
			"995",
		);
		await read(api + ".itemUseProbe().removeSupply()");
		await read(api + ".itemUseProbe().ready()");
		assert.equal(
			await read(
				`document.querySelector(${JSON.stringify(action)}).dataset.actionItem ?? null`,
			),
			null,
		);

		return {
			consumableReplacementAndClearing: true,
			actionStackCounts: true,
			doubleClick: true,
			targetRetry: true,
			localConfirmation: true,
			capturedTarget: true,
			selectedButton: true,
			interactHotkey: true,
			mixedActionBindings: true,
			automaticTargetFallback: true,
			combineEligibilityCursor: true,
			combineCellDimming: true,
			boundCombinationTargets: true,
			equippedCombinationTargetOpacity: true,
			equippedCombinationTargetClick: true,
			combineOpacityOverridesEquipmentHover: true,
			escape: true,
		};
	} finally {
		await read(api + ".itemUseProbe().destroy()");
	}
}

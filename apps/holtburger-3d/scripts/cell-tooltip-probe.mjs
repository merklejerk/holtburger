/** Behavioral checks use real browser input and synthetic DOM; no visual acceptance or DATs. */
export async function probeCellTooltips(client, evaluateExpression) {
	const read = (expression) => evaluateExpression(client, expression);
	const waitFor = async (expression, timeoutMs) => {
		const deadline = Date.now() + timeoutMs;
		while (!(await read(expression))) {
			if (Date.now() > deadline)
				throw new Error(`Tooltip did not settle: ${expression}`);
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	};
	const assert = async (expression, message) => {
		if (!(await read(expression))) throw new Error(message);
	};
	const move = async (selector) => {
		const point = await read(
			`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`,
		);
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			...point,
		});
	};
	const escape = async (repeat = false) => {
		await client.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			autoRepeat: repeat,
		});
	};
	const releaseEscape = () =>
		client.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
		});
	const open =
		'document.querySelector(".cell-tooltip")?.matches(":popover-open")';
	const text = 'document.querySelector(".cell-tooltip")?.textContent';
	await waitFor(
		'Boolean(document.querySelector("[data-tooltip-fixture]"))',
		5000,
	);
	const timing = await read(
		'(async () => (await import("/src/lib/frontend-tuning.ts")).SHARED_FRONTEND_TUNING.tooltips)()',
	);
	const wait = (expression) =>
		waitFor(expression, timing.openDelayMs + timing.closeDelayMs + 5000);
	// Scale only the anchor subtree; the delegated host remains unscaled.
	await read(`(async () => {
		const {applyUiScale} = await import("/src/app/ui-scale.ts");
		const root = document.querySelector("[data-tooltip-fixture]");
		window.tooltipScaleProbe = applyUiScale(root.querySelector("[data-fixture-panel]"), 1);
		root.style.setProperty("--ui-text-scale", "1.3");
	})()`);
	for (const scale of [0.75, 1.25, 2]) {
		await read(`window.tooltipScaleProbe.update(${scale})`);
		await move('[data-cell="a"]');
		await wait(`${open} && ${text}.includes("Alpha")`);
		await assert(
			`(() => {
			const tip = document.querySelector(".cell-tooltip");
			const target = document.querySelector("[data-cell=a]");
			const r = tip.getBoundingClientRect(), a = target.getBoundingClientRect();
			return Math.abs(tip.currentCSSZoom - ${scale}) < 0.001
				&& Math.abs(r.left - a.left) < 1
				&& Math.abs(r.top - a.bottom - 4) < 1
				&& r.right <= innerWidth && r.bottom <= innerHeight
				&& getComputedStyle(tip).getPropertyValue("--ui-text-scale").trim() === "1.3";
		})()`,
			"Scaled tooltip lost its anchor, scale, text preference or viewport bounds",
		);
		await read(`window.tooltipScaleProbe.update(${scale + 0.05})`);
		await wait(`!${open}`);
	}
	await read(`window.tooltipScaleProbe.update(1); delete window.tooltipScaleProbe;
		document.querySelector("[data-tooltip-fixture]").style.removeProperty("--ui-text-scale")`);
	await move('[data-cell="a"]');
	await wait(`${open} && ${text}.includes("Alpha")`);
	await assert(
		'document.querySelector("[data-cell=a]").getAttribute("aria-describedby").includes("existing-description")',
		"Tooltip erased an existing description",
	);
	await assert(
		'(() => { const tip=document.querySelector(".cell-tooltip").getBoundingClientRect(); const clip=document.querySelector(".clip").getBoundingClientRect(); return tip.bottom > clip.bottom && tip.left >= 0 && tip.right <= innerWidth; })()',
		"Tooltip did not escape clipping within the viewport",
	);
	await move('[data-cell="b"]');
	await wait(`${text} === "Beta"`);
	await escape();
	await wait(`!${open}`);
	await escape(true);
	await releaseEscape();
	await assert(
		'!document.querySelector("[data-cell=a]").getAttribute("aria-describedby").split(/\\s+/).some(id => id === document.querySelector(".cell-tooltip").id)',
		"Tooltip description survived target replacement",
	);
	await move('[data-cell="disabled"] span');
	await wait(`${open} && ${text} === "Unavailable equipment slot"`);
	await move('[data-cell="nested"]');
	await wait(`!${open}`);
	await move('[data-cell="a"]');
	await wait(open);
	await move("[data-native-hint]");
	await wait(`!${open}`);
	await move('[data-cell="a"]');
	await wait(open);
	await read(
		'document.querySelector("[data-cell=a]").dataset.uiTooltip = "Updated item"',
	);
	await wait(`${text} === "Updated item"`);
	await read(
		'document.querySelector("[data-cell=a]").setAttribute("aria-describedby", document.querySelector("[data-cell=a]").getAttribute("aria-describedby") + " later-description")',
	);
	await escape();
	await releaseEscape();
	await assert(
		'document.querySelector("[data-cell=a]").getAttribute("aria-describedby") === "existing-description later-description"',
		"Dismissal erased a concurrently added description",
	);
	await read('document.querySelector("[data-cell=b]").focus()');
	await wait(`${open} && ${text} === "Beta"`);
	await escape();
	await wait(`!${open}`);
	await assert(
		'document.activeElement === document.querySelector("[data-cell=b]")',
		"Hint dismissal changed focus",
	);
	await escape(true);
	await releaseEscape();
	await assert(
		'document.querySelector("[data-tooltip-fixture]").dataset.scopeEscapes === "0"',
		"Escape leaked through to the focused scope",
	);
	await escape();
	await releaseEscape();
	await assert(
		'document.querySelector("[data-tooltip-fixture]").dataset.scopeEscapes === "1"',
		"Subsequent Escape did not reach the focused scope",
	);
	await read('document.querySelector("[data-open-modal]").click()');
	await wait(`${open} && ${text} === "Modal item"`);
	await read(`(async () => {
		const {applyUiScale} = await import("/src/app/ui-scale.ts");
		applyUiScale(document.querySelector("dialog:modal"), 1.25);
	})()`);
	await wait(`${open} && ${text} === "Modal item"`);
	await assert(
		`(() => {
		const tip = document.querySelector(".cell-tooltip");
		const target = document.querySelector("[data-modal-cell]");
		const r = tip.getBoundingClientRect(), a = target.getBoundingClientRect();
		return tip.currentCSSZoom === 1.25 && Math.abs(r.left-a.left) < 1
			&& Math.abs(r.top-a.bottom-4) < 1;
	})()`,
		"Modal tooltip doubled its inherited scale or lost its anchor",
	);
	await assert(
		'(() => {const tip=document.querySelector(".cell-tooltip");const r=tip.getBoundingClientRect();return !tip.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})()',
		"Modal tooltip intercepted pointer hit testing",
	);
	await escape();
	await wait(`!${open}`);
	await assert(
		'document.querySelector("dialog")?.open && document.activeElement.matches("[data-modal-cell]")',
		"Hint dismissal closed the modal or changed its focus",
	);
	await escape(true);
	await releaseEscape();
	await escape();
	await releaseEscape();
	await wait(
		'document.querySelector("[data-tooltip-fixture]").dataset.modalDismissals === "1"',
	);
	await read('document.querySelector("[data-open-modal]").click()');
	await wait(`${open} && ${text} === "Modal item"`);
	await read('document.querySelector("[data-open-earlier-modal]").click()');
	await wait(`${open} && ${text} === "Earlier DOM modal item"`);
	await assert(
		'document.querySelectorAll("dialog:modal").length === 2 && document.querySelector("dialog:modal").contains(document.querySelector("[data-earlier-modal-cell]"))',
		"Nested modal fixture did not reverse DOM and opening order",
	);
	await read('document.querySelector("[data-close-earlier-modal]").click()');
	await wait('document.querySelector("[data-earlier-modal-cell]") === null');
	await read('document.querySelector("[data-close-modal]").click()');
	await wait('document.querySelector("dialog:modal") === null');
	await read("document.activeElement?.blur()");
	await move('[data-cell="a"]');
	await wait(open);
	await read('document.querySelector("[data-other-popover]").showPopover()');
	await wait(`!${open}`);
	await read('document.querySelector("[data-other-popover]").hidePopover()');
	await move('[data-cell="b"]');
	await wait(open);
	await read('document.querySelector("[data-fixture-panel]").hidden = true');
	await wait(`!${open}`);
	await read('document.querySelector("[data-fixture-panel]").hidden = false');
	await move('[data-cell="a"]');
	await wait(open);
	await read(
		'(() => { const cell=document.querySelector("[data-cell=a]"); const r=cell.getBoundingClientRect(); const parent=document.createElement("div"); parent.dataset.reparentedCell=""; parent.style.cssText=`position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`; document.querySelector("[data-tooltip-fixture]").append(parent); parent.append(cell); })()',
	);
	await read("new Promise(requestAnimationFrame)");
	await read(
		'document.querySelector("[data-reparented-cell]").style.display = "none"',
	);
	await wait(`!${open}`);
	await read(
		'(() => {const parent=document.querySelector("[data-reparented-cell]"); document.querySelector("[data-fixture-panel]").prepend(parent.firstElementChild); parent.remove();})()',
	);
	await read(`(async () => {
		const {applyUiScale} = await import("/src/app/ui-scale.ts");
		window.longTooltipScaleProbe = applyUiScale(document.querySelector("[data-cell=long]"), 2);
	})()`);
	await move('[data-cell="long"]');
	await wait(open);
	await assert(
		'(() => {const tip=document.querySelector(".cell-tooltip");const r=tip.getBoundingClientRect();return getComputedStyle(tip).overflow === "hidden" && r.top>=0 && r.bottom<=innerHeight;})()',
		"Long tooltip was not bounded and clipped",
	);
	// Place a real control below the still-visible top-layer hint, then click through it.
	const coveredPoint = await read(`(() => {
		const tip = document.querySelector(".cell-tooltip");
		const r = tip.getBoundingClientRect();
		const button = document.createElement("button");
		button.dataset.coveredControl = "";
		button.textContent = "Covered control";
		button.style.cssText = "position:fixed;inset:0;margin:0;width:80px;height:36px";
		document.querySelector("[data-tooltip-fixture]").append(button);
		const x = r.left + r.width / 2, y = r.top + r.height / 2;
		button.style.left = (x / button.currentCSSZoom - 40) + "px";
		button.style.top = (y / button.currentCSSZoom - 18) + "px";
		button.onclick = () => { button.dataset.clicked = "true"; };
		return {x, y};
	})()`);
	await assert(
		`${open} && document.elementFromPoint(${coveredPoint.x}, ${coveredPoint.y}) === document.querySelector("[data-covered-control]")`,
		"Visible tooltip intercepted the underlying control",
	);
	for (const type of ["mousePressed", "mouseReleased"])
		await client.send("Input.dispatchMouseEvent", {
			type,
			...coveredPoint,
			button: "left",
			buttons: type === "mousePressed" ? 1 : 0,
			clickCount: 1,
		});
	await assert(
		'document.querySelector("[data-covered-control]").dataset.clicked === "true"',
		"Click did not reach the control beneath the tooltip",
	);
	await wait(`!${open}`);
	await read('document.querySelector("[data-covered-control]").remove()');
	await read(
		"window.longTooltipScaleProbe.update(1); delete window.longTooltipScaleProbe",
	);
	await read('document.querySelector("[data-clone-artwork]").click()');
	await assert(
		'document.querySelector("[data-fixture-ghost] [data-drag-artwork] svg") !== null',
		"Drag ghost lost unavailable artwork",
	);
	await read('document.querySelector("[data-fixture-ghost]").hidePopover()');
	for (const guid of [1, 2, 3, 4]) {
		await move(`[data-item-guid="${guid}"]`);
		await wait(
			`${open} && ${text}.startsWith("Fixture item ${guid}\\nQuantity: 7\\nStructure: [5/10]\\nEquipped")`,
		);
		await assert(
			`(() => {const cell=document.querySelector('[data-item-guid="${guid}"]');return cell.getAttribute('aria-label').includes('Quantity: 7') && cell.querySelector('.item-count-overlay')?.textContent === '7' && cell.querySelector('.item-cell-meter') !== null && cell.querySelector('.item-equipped') !== null && !cell.disabled;})()`,
			"Artwork state changed item identity, overlays or availability",
		);
	}
	await assert(
		'document.querySelectorAll(".artwork-fixture img.ui-icon").length === 2 && document.querySelector("[data-item-guid=\\"1\\"] [data-artwork-state=loading]") !== null && document.querySelector("[data-item-guid=\\"4\\"] [data-artwork-state=failed]") !== null',
		"Artwork state presentation did not preserve degraded images and distinct placeholders",
	);
	await read('document.querySelector("[data-item-guid=\\"4\\"]").click()');
	await assert(
		'document.querySelector("[data-tooltip-fixture]").dataset.selected === "4"',
		"Failed artwork prevented item selection",
	);
	await move(".spell-cell");
	await wait(
		`${open} && ${text}.includes("Fixture spell") && ${text}.includes("F9")`,
	);
	await move(".action-cell");
	await wait(
		`${open} && ${text}.includes("Fixture action") && ${text}.includes("Alternate: Inspect")`,
	);
	await move(".item-queue-cell");
	await wait(`${open} && ${text} === "Queued fixture item"`);
	await move(".item-cell-remove");
	await wait(`!${open}`);
	await read('document.querySelector(".item-cell-remove").click()');
	await assert(
		'document.querySelector("[data-tooltip-fixture]").dataset.removals === "1"',
		"Queue removal action did not survive tooltip migration",
	);
	await move('[data-cell="a"]');
	await wait(open);
	const heldPoint = await read(
		'(() => {const r=document.querySelector("[data-cell=a]").getBoundingClientRect();return {x:r.left+8,y:r.top+8};})()',
	);
	await client.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		...heldPoint,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	await wait(`!${open}`);
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		...heldPoint,
		buttons: 1,
	});
	await assert(`!${open}`, "Holding a drag press reopened the tooltip");
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		...heldPoint,
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
	await assert(
		`!${open}`,
		"Releasing a drag reopened the tooltip without fresh engagement",
	);
	await move('[data-cell="b"]');
	await wait(open);
	const lock = await client.send("Runtime.evaluate", {
		expression:
			'document.querySelector("[data-tooltip-fixture]").requestPointerLock()',
		awaitPromise: true,
		userGesture: true,
		returnByValue: true,
	});
	if (lock.exceptionDetails)
		throw new Error(
			`Pointer lock fixture failed: ${lock.exceptionDetails.text}`,
		);
	await wait(`document.pointerLockElement !== null && !${open}`);
	await read("document.exitPointerLock()");
	await wait("document.pointerLockElement === null");
	await move('[data-cell="a"]');
	await wait(open);
	await read('document.querySelector("[data-tooltip-fixture]").inert = true');
	await wait(`!${open}`);
	await read('document.querySelector("[data-tooltip-fixture]").inert = false');
	await move('[data-cell="b"]');
	await wait(open);
	await read('document.querySelector("[data-cell=b]").remove()');
	await wait(`!${open}`);
	await move('[data-cell="a"]');
	await wait(open);
	await read('document.querySelector("[data-tooltip-fixture]").remove()');
	await wait(`!${open}`);
	return {
		passed: true,
		checked: [
			"scaled-anchor-and-unscaled-host",
			"scaled-modal-hit-testing",
			"scale-change-dismissal",
			"hover",
			"disabled",
			"clipping",
			"nested-controls",
			"live-labels",
			"descriptions",
			"focused-Escape",
			"modal-Escape",
			"modal-opening-order",
			"covering-popover",
			"retained-panel",
			"reparented-target-visibility",
			"bounded-content-and-click-through",
			"artwork-states-and-overlays",
			"unavailable-artwork-drag-ghost",
			"item-spell-action-queue-cells",
			"pointer-press-and-drag-suppression",
			"pointer-lock",
			"inert-ancestor",
			"target-and-root-removal",
		],
	};
}

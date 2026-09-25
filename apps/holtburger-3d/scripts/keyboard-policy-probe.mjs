import assert from "node:assert/strict";

/** Drive actual browser defaults; DOM-dispatched keyboard events cannot prove focus or native control behavior. */
export async function probeKeyboardPolicy(client, evaluateExpression) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__";
	const evaluate = (expression) => evaluateExpression(client, expression);
	const invoke = (method) => evaluate(`${api}.keyboardProbe().${method}()`);
	const capture = () => invoke("capture");
	const click = async (selector, fraction = 0.5) => {
		const point = await evaluate(`(() => {
			const element = document.querySelector(${JSON.stringify(selector)});
			if (!element) throw new Error('Keyboard probe control is absent: ' + ${JSON.stringify(selector)});
			const rect = element.getBoundingClientRect();
			return { x: rect.left + rect.width * ${fraction}, y: rect.top + rect.height / 2 };
		})()`);
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
	};
	const key = async (type, value, code, virtualKey, extra = {}) => {
		await client.send("Input.dispatchKeyEvent", {
			type,
			key: value,
			code,
			windowsVirtualKeyCode: virtualKey,
			...extra,
		});
	};
	const press = async (value, code, virtualKey, extra = {}) => {
		await key("keyDown", value, code, virtualKey, extra);
		await key("keyUp", value, code, virtualKey);
	};
	await evaluate(`${api}.beginKeyboardProbe()`);
	try {
		await key("keyDown", "w", "KeyW", 87);
		assert.equal(
			(await capture()).movement.forward,
			1,
			"Explorer receives game keys through the app boundary",
		);
		await press("1", "Digit1", 49, { modifiers: 2 });
		assert.equal(
			(await capture()).movement.forward,
			1,
			"Selecting an action bar preserves held movement",
		);
		assert.equal((await capture()).gameActive, true);
		await key("keyUp", "w", "KeyW", 87);
		assert.equal(
			(await capture()).movement.forward,
			0,
			"Movement releases reach the game while a bar is selected",
		);
		await key("keyDown", "w", "KeyW", 87);
		assert.equal(
			(await capture()).movement.forward,
			1,
			"Unrelated presses reach the game while a bar is selected",
		);
		await press("ArrowRight", "ArrowRight", 39);
		assert.equal(
			await evaluate(
				`document.querySelector('.action-cell[aria-pressed="true"]')?.dataset.actionCell`,
			),
			"2",
			"Bar navigation still consumes its own keys",
		);
		await press("Enter", "Enter", 13);
		assert.equal(
			(await capture()).movement.forward,
			1,
			"Completing bar selection preserves held movement",
		);
		await press("1", "Digit1", 49, { modifiers: 2 });
		await invoke("blurWindow");
		assert.equal(
			(await capture()).movement.forward,
			0,
			"Blur cancels movement alongside bar selection",
		);
		await key("keyUp", "w", "KeyW", 87);
		await key("keyDown", "w", "KeyW", 87);
		await click("#keyboard-button");
		let state = await capture();
		assert.equal(state.clicks, 1);
		assert.equal(
			state.movement.forward,
			1,
			"An ordinary button must not cancel movement",
		);
		assert.notEqual(state.focused, "keyboard-button");
		await click("#keyboard-checkbox");
		assert.equal((await capture()).checked, true);
		await click("#keyboard-range", 0.8);
		state = await capture();
		assert.ok(
			state.range > 50,
			"Native range interaction survives focus policy",
		);
		assert.equal(state.movement.forward, 1);
		assert.equal(state.gameActive, true);
		await press("Tab", "Tab", 9);
		await press("Tab", "Tab", 9, { modifiers: 8 });
		assert.equal((await capture()).gameActive, true);

		await click("#keyboard-editor");
		state = await capture();
		assert.equal(state.movement.forward, 0, "Editing cancels held movement");
		assert.equal(
			state.pointerAllowed,
			true,
			"Editing preserves pointer availability",
		);
		await key("keyUp", "w", "KeyW", 87);
		await press("w", "KeyW", 87, { text: "w" });
		state = await capture();
		assert.equal(state.editorValue, "w");
		assert.equal(state.movement.forward, 0);
		await press("Tab", "Tab", 9);
		assert.equal((await capture()).focused, "keyboard-editor");
		await press("F8", "F8", 119, { modifiers: 2 });
		assert.equal(
			(await capture()).focused,
			"keyboard-editor",
			"Editors suppress scope activation commands",
		);

		await click("#keyboard-viewport");
		await key("keyDown", "c", "KeyC", 67, { modifiers: 2 });
		assert.equal(
			(await capture()).movement.right,
			1,
			"Modified gameplay keys retain their configured wildcard semantics without a selection",
		);
		await key("keyUp", "c", "KeyC", 67);
		const ordinarySelectedText = await invoke("selectOrdinaryText");
		assert.equal(
			ordinarySelectedText,
			"Ordinary selectable HUD text",
			"The fixture owns a non-collapsed document selection",
		);
		await press("c", "KeyC", 67, { modifiers: 2 });
		assert.equal(
			(await capture()).movement.right,
			0,
			"Copying ordinary selected UI text must not strafe the character",
		);
		const metaCopyAllowed = await evaluate(`(() => {
			const down = new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', metaKey: true,
				bubbles: true, cancelable: true });
			const allowed = window.dispatchEvent(down);
			window.dispatchEvent(new KeyboardEvent('keyup', { key: 'c', code: 'KeyC', metaKey: true,
				bubbles: true, cancelable: true }));
			return allowed;
		})()`);
		assert.equal(
			metaCopyAllowed,
			true,
			"Command+C remains available to native copy when document text is selected",
		);
		await click("#keyboard-editor");
		await evaluate(`document.querySelector('#keyboard-editor').value = ''`);
		await press("v", "KeyV", 86, { modifiers: 2 });
		assert.equal(
			(await capture()).editorValue,
			ordinarySelectedText,
			"Native copy transfers selected text from an ordinary unscoped UI surface",
		);

		await invoke("openModal");
		assert.equal((await capture()).pointerAllowed, false);
		await press("x", "KeyX", 88);
		assert.equal(
			(await capture()).presses,
			0,
			"Modal input cannot reach a containing scope",
		);
		await click("#keyboard-modal-editor");
		await press("w", "KeyW", 87, { text: "w" });
		assert.equal((await capture()).movement.forward, 0);
		await press("Escape", "Escape", 27);
		state = await capture();
		assert.equal(
			state.focused,
			"keyboard-editor",
			"Modal dismissal restores the prior editor",
		);
		assert.equal(state.pointerAllowed, true);

		await click("#keyboard-viewport");
		await press("F8", "F8", 119, { modifiers: 2 });
		assert.equal((await capture()).focused, "keyboard-bar");
		await press("w", "KeyW", 87);
		assert.equal(
			(await capture()).movement.forward,
			0,
			"Unhandled scope keys never leak into the game",
		);
		await press("x", "KeyX", 88);
		state = await capture();
		assert.equal(state.presses, 1);
		assert.equal(state.releases, 1);
		await invoke("openModal");
		await press("Escape", "Escape", 27);
		assert.equal((await capture()).focused, "keyboard-bar");
		await press("Escape", "Escape", 27);
		assert.equal((await capture()).gameActive, true);

		await press("F8", "F8", 119, { modifiers: 2 });
		await invoke("openModal");
		await invoke("unregisterScope");
		await press("Escape", "Escape", 27);
		assert.equal(
			(await capture()).gameActive,
			true,
			"A removed scope cannot be restored by modal dismissal",
		);

		await click("#keyboard-select");
		await press("ArrowDown", "ArrowDown", 40);
		await press("Enter", "Enter", 13);
		state = await capture();
		assert.equal(
			state.selected,
			"second",
			"Native select retains keyboard operation",
		);
		await click("#keyboard-viewport");
		await key("keyDown", "w", "KeyW", 87);
		await invoke("blurWindow");
		await key("keyDown", "w", "KeyW", 87, { autoRepeat: true });
		assert.equal(
			(await capture()).movement.forward,
			0,
			"Window blur cannot resurrect a held key",
		);
		await key("keyUp", "w", "KeyW", 87);
		await press("w", "KeyW", 87);
		assert.equal((await capture()).movement.forward, 0);

		await click("#keyboard-editor");
		await invoke("removeEditor");
		assert.equal(
			(await capture()).gameActive,
			true,
			"Removing an editor releases its ownership",
		);
		await click("#keyboard-button");
		await press("Enter", "Enter", 13);
		assert.equal(
			(await capture()).focusLabel,
			"Chat message",
			"Chat activation works after a HUD click without canvas focus",
		);
		await invoke("openModal");
		await press("Escape", "Escape", 27);
		assert.equal(
			(await capture()).focusLabel,
			"Chat message",
			"Modal Escape must not also close chat",
		);
		await press("Escape", "Escape", 27);
		assert.equal((await capture()).gameActive, true);
		const chatInput = '[aria-label="Chat message"]';
		const chatValue = () =>
			evaluate(`document.querySelector(${JSON.stringify(chatInput)}).value`);
		for (const sent of ["first send", "second send"]) {
			await click(chatInput);
			await client.send("Input.insertText", { text: sent });
			await evaluate(
				`document.querySelector(${JSON.stringify(chatInput)}).form.requestSubmit()`,
			);
			await evaluate("new Promise(resolve => requestAnimationFrame(resolve))");
		}
		await click(chatInput);
		await client.send("Input.insertText", { text: "unsent draft" });
		await press("ArrowUp", "ArrowUp", 38);
		assert.equal(await chatValue(), "second send");
		await press("ArrowUp", "ArrowUp", 38);
		assert.equal(await chatValue(), "first send");
		await press("ArrowDown", "ArrowDown", 40);
		assert.equal(await chatValue(), "second send");
		await press("ArrowDown", "ArrowDown", 40);
		assert.equal(await chatValue(), "unsent draft");
		await press("ArrowUp", "ArrowUp", 38, { modifiers: 8 });
		assert.equal(await chatValue(), "unsent draft");
		await press("ArrowUp", "ArrowUp", 38);
		await client.send("Input.insertText", { text: " edited" });
		const editedDraft = await chatValue();
		assert.notEqual(editedDraft, "second send");
		await press("ArrowUp", "ArrowUp", 38);
		assert.equal(await chatValue(), "second send");
		await press("ArrowDown", "ArrowDown", 40);
		assert.equal(await chatValue(), editedDraft);
		assert.equal((await capture()).focusLabel, "Chat message");
		await press("Escape", "Escape", 27);

		const historyToggle = '[aria-label="Interact with chat history"]';
		const historyState = () =>
			evaluate(`(() => {
			const buffer = document.querySelector('.chat-buffer');
			return { pointerEvents: getComputedStyle(buffer).pointerEvents,
				pointerHovered: buffer.dataset.pointerHovered,
				backgroundImage: getComputedStyle(buffer).backgroundImage,
				pressed: document.querySelector(${JSON.stringify(historyToggle)}).getAttribute('aria-pressed') };
		})()`);
		const settleHistoryAnimations = () =>
			evaluate(
				`Promise.all(document.querySelector('.chat-buffer').getAnimations({ subtree: true }).map(animation => animation.finished))`,
			);
		const word = await evaluate(`(() => {
			const span = document.querySelector('.chat-buffer p:last-child .chat-message');
			const range = document.createRange();
			range.selectNodeContents(span);
			const rect = range.getClientRects()[0];
			const bufferBounds = span.closest('.chat-buffer').getBoundingClientRect();
			return { x: rect.left + 10, y: rect.top + rect.height / 2,
				outsideX: bufferBounds.right + 1 };
		})()`);
		const idleHistory = await historyState();
		assert.equal(idleHistory.pointerEvents, "none");
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			...word,
		});
		assert.ok(
			await evaluate(
				`document.querySelector('.chat-buffer').getAnimations({ subtree: true }).length > 0`,
			),
			"Chat hover starts a visual transition",
		);
		await settleHistoryAnimations();
		const hoveredHistory = await historyState();
		assert.equal(hoveredHistory.pointerEvents, "none");
		assert.equal(hoveredHistory.pointerHovered, "true");
		assert.notEqual(
			hoveredHistory.backgroundImage,
			idleHistory.backgroundImage,
		);
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: word.outsideX,
			y: word.y,
		});
		await settleHistoryAnimations();
		await click(historyToggle);
		assert.equal((await capture()).focusLabel, "Chat messages");
		assert.equal((await historyState()).pressed, "true");
		assert.equal((await historyState()).pointerEvents, "auto");
		for (const type of ["mousePressed", "mouseReleased"]) {
			await client.send("Input.dispatchMouseEvent", {
				type,
				button: "left",
				clickCount: 2,
				...word,
			});
		}
		const selectedText = await evaluate("getSelection().toString()");
		assert.ok(
			selectedText.length > 0,
			"Chat history supports native mouse text selection",
		);
		await press("c", "KeyC", 67, { modifiers: 2 });
		assert.equal(
			(await capture()).movement.right,
			0,
			"Copy must not strafe the character",
		);
		await click('[aria-label="Chat message"]');
		await press("v", "KeyV", 86, { modifiers: 2 });
		const pasted =
			await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() =>
			resolve(document.querySelector('[aria-label="Chat message"]').value))))`);
		assert.equal(
			pasted,
			selectedText,
			"Native copy/paste transfers the selected chat history",
		);
		await click(historyToggle);
		assert.equal(
			(await capture()).focusLabel,
			"Chat message",
			"Disabling history interaction does not interrupt draft editing",
		);
		assert.equal((await historyState()).pointerEvents, "none");
		await press("Escape", "Escape", 27);
		await click(historyToggle);
		await invoke("openModal");
		await press("Escape", "Escape", 27);
		assert.equal(
			(await capture()).focusLabel,
			"Chat messages",
			"A modal restores history interaction",
		);
		await click("#keyboard-viewport");
		assert.equal((await capture()).gameActive, true);
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			...word,
		});
		assert.equal(
			(await historyState()).pointerEvents,
			"none",
			"Hover styling must not make an unfocused chat buffer intercept pointers",
		);
		assert.equal(
			await evaluate(
				`document.elementFromPoint(${word.x}, ${word.y})?.closest('[data-game-viewport]') !== null`,
			),
			true,
			"An unfocused chat buffer exposes the gameplay viewport beneath it",
		);
		await press("Escape", "Escape", 27);
		assert.equal((await capture()).gameActive, true);
		await click(historyToggle);
		assert.equal((await historyState()).pressed, "false");

		// A real HUD window and an independently active command share one recency order.
		await click("#keyboard-viewport");
		// Keep the fixture controls out of the production window's pointer hit area.
		await evaluate(
			`document.querySelector('#keyboard-viewport').parentElement.style.inset = '180px auto auto 20px'`,
		);
		const inventoryWindow = '.hud-window[aria-label="Inventory"]';
		const inventoryOpen = () =>
			evaluate(`document.querySelector('${inventoryWindow}') !== null`);
		await click('.shortcut-dock button[aria-label="Inventory"]');
		assert.equal(await inventoryOpen(), true);
		await invoke("beginEscapeActivity");
		await click(`${inventoryWindow} .hud-window-titlebar`, 0.1);
		await invoke("openModal");
		await key("keyDown", "Escape", "Escape", 27);
		await key("keyDown", "Escape", "Escape", 27, { autoRepeat: true });
		await key("keyUp", "Escape", "Escape", 27);
		assert.equal(
			await inventoryOpen(),
			true,
			"Modal Escape preserves the underlying window",
		);
		assert.equal((await capture()).activityCancellations, 0);
		await key("keyDown", "Escape", "Escape", 27);
		await key("keyDown", "Escape", "Escape", 27, { autoRepeat: true });
		await key("keyUp", "Escape", "Escape", 27);
		assert.equal(
			await inventoryOpen(),
			false,
			"Refocusing the window promotes it above the activity",
		);
		assert.equal(
			(await capture()).activityCancellations,
			0,
			"Holding Escape must not drain the next context",
		);
		await press("Escape", "Escape", 27);
		assert.equal((await capture()).activityCancellations, 1);
		await click('.shortcut-dock button[aria-label="Inventory"]');
		await invoke("beginEscapeActivity");
		await press("Escape", "Escape", 27);
		assert.equal(
			await inventoryOpen(),
			true,
			"Re-engaging the activity promotes it above the window",
		);
		assert.equal((await capture()).activityCancellations, 2);
		await press("Escape", "Escape", 27);
		assert.equal(await inventoryOpen(), false);
		return {
			contextualEscape: true,
			nativeControls: true,
			editorOwnership: true,
			explicitScopes: true,
			modalRestoration: true,
			tabSuppressed: true,
			heldKeyCancellation: true,
			chatActivation: true,
			ordinaryTextCopy: true,
			chatHistoryCopy: true,
		};
	} finally {
		await invoke("dispose");
	}
}

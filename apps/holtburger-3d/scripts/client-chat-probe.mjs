import assert from "node:assert/strict";

/** Exercise the production editor, composer and decoded host boundary with native input. */
export async function probeClientChat(client, evaluateExpression) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.chat";
	const evaluate = (expression) => evaluateExpression(client, expression);
	const settle = () =>
		evaluate(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
	const invoke = async (method, ...args) => {
		const result = await evaluate(
			`${api}.${method}(${args.map((arg) => JSON.stringify(arg)).join(",")})`,
		);
		await settle();
		return result;
	};
	const read = () => evaluate(`JSON.parse(JSON.stringify(${api}.read()))`);
	const click = async (selector, text) => {
		const point = await evaluate(`(() => {
			const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => ${text === undefined ? "true" : `e.textContent.trim().startsWith(${JSON.stringify(text)})`});
			if (!element) throw new Error('Chat probe control missing: ' + ${JSON.stringify(text ?? selector)});
			const r = element.getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		})()`);
		for (const type of ["mousePressed", "mouseReleased"])
			await client.send("Input.dispatchMouseEvent", {
				type,
				button: "left",
				clickCount: 1,
				...point,
			});
		await settle();
	};
	const press = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
		for (const type of ["keyDown", "keyUp"])
			await client.send("Input.dispatchKeyEvent", {
				type,
				key,
				code,
				windowsVirtualKeyCode,
				modifiers,
				...(type === "keyDown" && key === "Enter" ? { text: "\r" } : {}),
			});
		await settle();
	};
	const draft = async (text) => {
		await click('input[aria-label="Chat message"]');
		await press("a", "KeyA", 65, 2);
		await press("Backspace", "Backspace", 8);
		if (text.length > 0) await client.send("Input.insertText", { text });
		await settle();
	};
	const send = async (text) => {
		await draft(text);
		await press("Enter", "Enter", 13);
	};
	const choose = async (label) => {
		await click('button[aria-label="Chat destination"]');
		await click('[role="menuitem"]', label);
	};
	const lastRequest = async () => (await read()).requests.at(-1);
	const npc = { kind: "npc", guid: 0x80000001, name: "Professor of War Magic" };
	try {
		await invoke("reset");
		for (const channel of ["general", "trade", "lfg", "roleplay"])
			await invoke("receive", {
				kind: "channel",
				channel,
				origin: { kind: "turbine", roomId: 2, typeId: 2 },
				sender: "Prefix palette probe",
				speakerKind: "player",
				message: "Prefix theme check",
			});
		const prefixPalette = await evaluate(`(() => {
			const prefix = channel => [...document.querySelectorAll('.chat-channel-prefix')]
				.find(node => node.dataset.channel === channel && node.closest('p').textContent.includes('Prefix palette probe'));
			const general = prefix('general');
			const line = general.closest('p');
			const bodyColor = getComputedStyle(line.querySelector('.chat-message')).color;
			const colors = ['general', 'trade', 'lfg', 'roleplay'].map(channel => getComputedStyle(prefix(channel)).color);
			const style = document.createElement('style');
			style.textContent = '.chat-buffer { --ui-chat-general-prefix-text: #123456; --ui-chat-trade-text: #654321; --ui-color-muted: #abcdef; }';
			document.head.append(style);
			try {
				return {
					colors,
					general: getComputedStyle(general).color,
					trade: getComputedStyle(prefix('trade')).color,
					meta: [...line.querySelectorAll('.chat-meta')].map(node => getComputedStyle(node).color),
					bodyUnchanged: getComputedStyle(line.querySelector('.chat-message')).color === bodyColor,
					prefixText: line.querySelector('strong').textContent,
				};
			} finally { style.remove(); }
		})()`);
		assert.equal(
			new Set(prefixPalette.colors).size,
			4,
			"Public channel prefixes must be distinct",
		);
		assert.equal(
			prefixPalette.general,
			"rgb(18, 52, 86)",
			"Theme overrides the General prefix independently",
		);
		assert.equal(
			prefixPalette.trade,
			"rgb(101, 67, 33)",
			"Trade prefix follows its existing semantic theme token",
		);
		assert.deepEqual(
			prefixPalette.meta,
			["rgb(171, 205, 239)", "rgb(171, 205, 239)"],
			"Timestamp and sender retain the muted theme color",
		);
		assert.equal(
			prefixPalette.bodyUnchanged,
			true,
			"Prefix overrides leave ordinary message text alone",
		);
		assert.match(
			prefixPalette.prefixText,
			/^\[[^\]]+\] \[General\] Prefix palette probe:$/,
			"Splitting the prefix preserves copied text spacing",
		);
		await invoke("setPartyPresent", false);
		await click('button[aria-label="Chat destination"]');
		assert.equal(
			await evaluate(
				`Array.from(document.querySelectorAll('[role="menuitem"]')).find(e => e.textContent.trim() === 'Party (not in a party)')?.getAttribute('aria-disabled')`,
			),
			"true",
		);
		await press("Escape", "Escape", 27);
		await invoke("setPartyPresent", true);
		await choose("Party");
		assert.equal(
			await evaluate(
				'document.querySelector(".chat-destination").textContent.trim()',
			),
			"Pty",
		);
		await draft("party hello");
		assert.equal(
			await evaluate('document.querySelector(".chat-destination").title'),
			"Party",
		);
		await press("Enter", "Enter", 13);
		assert.deepEqual(await lastRequest(), {
			kind: "channel",
			channel: "fellowship",
			message: "party hello",
		});
		await send("/t Some Player, private hello");
		assert.deepEqual(await lastRequest(), {
			kind: "tell",
			target: { kind: "player", name: "Some Player" },
			message: "private hello",
		});
		assert.deepEqual((await read()).destination, {
			kind: "channel",
			channel: "fellowship",
		});
		await send("still party");
		assert.equal((await lastRequest()).channel, "fellowship");

		await draft("preserved draft");
		const rowGeometry = () =>
			evaluate(`(() => {
			const input = document.querySelector('input[aria-label="Chat message"]');
			const form = input.form;
			const bounds = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, middle: r.top + r.height / 2, width: r.width }; };
			const recipient = form.querySelector('input[aria-label="Tell recipient"]');
			return { height: form.getBoundingClientRect().height, picker: bounds(form.querySelector('[aria-label="Chat destination"]')), icon: bounds(form.querySelector('.chat-channel svg')), label: bounds(form.querySelector('.chat-destination')), message: bounds(input), recipient: recipient === null ? null : bounds(recipient) };
		})()`);
		const plainRow = await rowGeometry();
		assert.ok(
			plainRow.label.width > 0 &&
				plainRow.icon.right <= plainRow.label.left &&
				plainRow.label.right <= plainRow.picker.right,
			`Destination label must have visible space beside the icon: ${JSON.stringify(plainRow)}`,
		);
		assert.ok(
			plainRow.picker.right <= plainRow.message.left,
			"Picker belongs to the left of the input",
		);
		assert.ok(
			Math.abs(plainRow.label.middle - plainRow.message.middle) <= 1,
			"Context label and message share one row",
		);
		await choose("Tell…");
		const promptRow = await rowGeometry();
		assert.equal(
			promptRow.height,
			plainRow.height,
			"Recipient prompt must not add a composer row",
		);
		assert.equal(
			promptRow.message.width,
			plainRow.message.width,
			"Recipient prompt must keep the full message input width",
		);
		assert.equal(
			promptRow.recipient,
			null,
			"Recipient editing belongs to the dialog, outside the composer form",
		);
		assert.equal(
			await evaluate('document.querySelector(".chat-content").inert'),
			true,
		);
		assert.equal(
			await evaluate(
				'document.activeElement === document.querySelector(".chat-recipient-dialog input")',
			),
			true,
		);
		await client.send("Input.insertText", { text: "Another Player" });
		await press("Enter", "Enter", 13);
		assert.equal(
			await evaluate('document.activeElement?.getAttribute("aria-label")'),
			"Chat message",
		);
		assert.equal(
			await evaluate(
				`document.querySelector('input[aria-label="Chat message"]').value`,
			),
			"preserved draft",
		);
		assert.equal(
			(await read()).requests.length,
			3,
			"Recipient Enter must not submit a message",
		);
		await choose("Tell…");
		await press("Tab", "Tab", 9);
		assert.equal(
			await evaluate("document.activeElement.textContent.trim()"),
			"Cancel",
		);
		await press("Tab", "Tab", 9, 8);
		assert.equal(
			await evaluate('document.activeElement?.getAttribute("aria-label")'),
			"Tell recipient",
		);
		await press("Escape", "Escape", 27);
		assert.deepEqual((await read()).destination, {
			kind: "tell",
			target: { kind: "player", name: "Another Player" },
		});

		await choose("Tell…");
		const backdrop = await evaluate(
			`(() => { const r = document.querySelector('.chat-recipient-overlay').getBoundingClientRect(); return { x: r.left + 1, y: r.top + 1 }; })()`,
		);
		for (const type of ["mousePressed", "mouseReleased"])
			await client.send("Input.dispatchMouseEvent", {
				type,
				button: "left",
				clickCount: 1,
				...backdrop,
			});
		await settle();
		assert.equal(
			await evaluate('document.querySelector(".chat-recipient-dialog")'),
			null,
			"Backdrop cancels the recipient prompt",
		);
		assert.equal(
			await evaluate(
				`document.querySelector('input[aria-label="Chat message"]').value`,
			),
			"preserved draft",
		);
		assert.deepEqual((await read()).destination, {
			kind: "tell",
			target: { kind: "player", name: "Another Player" },
		});

		await invoke("select", npc);
		await choose("Tell selected");
		assert.equal(
			await evaluate(
				'document.querySelector(".chat-destination").textContent.trim()',
			),
			npc.name,
		);
		await invoke("select", { kind: "player", name: "Different Selection" });
		await send("level 1");
		assert.deepEqual(
			await lastRequest(),
			{ kind: "tell", target: npc, message: "level 1" },
			"Picker must snapshot the selected NPC",
		);
		await invoke("receive", {
			kind: "tell",
			sender: npc.name,
			speakerKind: "non-player",
			message: "Which level?",
			category: "tell",
			target: npc,
		});
		await send("/r level 1");
		assert.deepEqual(await lastRequest(), {
			kind: "tell",
			target: npc,
			message: "level 1",
		});
		await send("/rt level 2");
		assert.deepEqual(await lastRequest(), {
			kind: "tell",
			target: npc,
			message: "level 2",
		});
		await send("/ts player hello");
		assert.deepEqual((await lastRequest()).target, {
			kind: "player",
			name: "Different Selection",
		});
		await invoke("select", npc);
		await send("/tell Professor of War Magic, name route");
		assert.deepEqual((await lastRequest()).target, {
			kind: "player",
			name: npc.name,
		});
		await send("/tellselected level 1");
		assert.deepEqual((await lastRequest()).target, npc);
		await click(".chat-filters button", "Chat");
		const filteredNpc = {
			...npc,
			guid: 0x80000002,
			name: "Professor of Life Magic",
		};
		await invoke("receive", {
			kind: "tell",
			sender: filteredNpc.name,
			speakerKind: "non-player",
			message: "Hidden conversation fixture",
			category: "tell",
			target: filteredNpc,
		});
		assert.equal(
			await evaluate(
				'document.querySelector("[role=log]").textContent.includes("Hidden conversation fixture")',
			),
			false,
		);
		assert.deepEqual(
			(await read()).reply,
			filteredNpc,
			"Filtering must not discard reply identity",
		);
		await send("/r level 1");
		assert.deepEqual((await lastRequest()).target, filteredNpc);
		await click(".chat-filters button", "Combat");

		const beforeFailure = await read();
		await invoke("select", null);
		await send("/ts missing target");
		assert.equal((await read()).requests.length, beforeFailure.requests.length);
		assert.equal(
			await evaluate(
				'document.querySelector("[role=log]").textContent.includes("Select a player or NPC")',
			),
			true,
			"Errors must survive both filters being disabled",
		);
		assert.equal(
			await evaluate(
				`document.querySelector('input[aria-label="Chat message"]').value`,
			),
			"/ts missing target",
		);
		await invoke("rejectNextSend");
		await send("/t Rejected Player, retry me");
		assert.deepEqual((await read()).retell, beforeFailure.retell);
		assert.equal((await read()).requests.length, beforeFailure.requests.length);
		assert.equal(
			await evaluate(
				`document.querySelector('input[aria-label="Chat message"]').value`,
			),
			"/t Rejected Player, retry me",
		);
		await send("/unknown-chat-command");
		assert.equal((await read()).requests.length, beforeFailure.requests.length);

		await invoke("professorPrompt");
		assert.match(
			await evaluate(
				'document.querySelector(".client-message-dialog").textContent',
			),
			/2 X Notes/,
		);
		await click(".client-message-dialog button", "Accept");
		assert.deepEqual((await read()).responses.at(-1).args, {
			request_id: "900",
			accepted: true,
		});
		await invoke("clearPrompt");
		await choose("Tell…");
		await invoke("reset");
		assert.equal(
			await evaluate('document.querySelector(".chat-recipient-dialog")'),
			null,
		);
		const reset = await read();
		assert.deepEqual(reset.destination, { kind: "speech" });
		assert.equal(reset.reply, null);
		assert.equal(reset.retell, null);
		assert.equal(
			await evaluate(
				`document.querySelector('input[aria-label="Chat message"]').value`,
			),
			"",
		);
		await evaluate(
			"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.appendChatLines(60)",
		);
		await settle();
		await click('input[aria-label="Chat message"]');
		const scrollbar = await evaluate(`(() => {
			const buffer = document.querySelector('.chat-buffer'), r = buffer.getBoundingClientRect();
			// Start inside the thumb, rather than assuming a fixed inset from the track end.
			const x = r.right - 2, y = r.bottom - r.height * buffer.clientHeight / buffer.scrollHeight / 2;
			return { x, y, end: r.top + r.height / 2, top: buffer.scrollTop, height: r.height, scrollHeight: buffer.scrollHeight,
				hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 250), font: getComputedStyle(buffer).fontSize };
		})()`);
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: scrollbar.x,
			y: scrollbar.y,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			button: "left",
			buttons: 1,
			clickCount: 1,
			x: scrollbar.x,
			y: scrollbar.y,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			button: "left",
			buttons: 1,
			x: scrollbar.x,
			y: scrollbar.end,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			button: "left",
			clickCount: 1,
			x: scrollbar.x,
			y: scrollbar.end,
		});
		await settle();
		assert.ok(
			await evaluate(
				`document.querySelector('.chat-buffer').scrollTop < ${scrollbar.top}`,
			),
			`Native scrollbar dragging must scroll the history: ${JSON.stringify(scrollbar)}`,
		);
		await click("canvas[data-game-viewport]");
		assert.equal(
			await evaluate(
				'document.querySelector(".chat-history").classList.contains("interactive")',
			),
			true,
			"Scrollbar interaction must survive the editor losing focus",
		);
		const olderTop = await evaluate(
			'document.querySelector(".chat-buffer").scrollTop',
		);
		await evaluate(
			"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.appendChatLines(1)",
		);
		await settle();
		assert.equal(
			await evaluate('document.querySelector(".chat-buffer").scrollTop'),
			olderTop,
			"Active history preserves an older reading position",
		);
		await press("c", "KeyC", 67, 2);
		assert.equal(
			await evaluate(
				'document.querySelector(".chat-panel").classList.contains("interactive")',
			),
			false,
		);
		const bottomGap = () =>
			evaluate(`(() => {
			const buffer = document.querySelector('.chat-buffer');
			return buffer.scrollHeight - buffer.clientHeight - buffer.scrollTop;
		})()`);
		assert.ok(
			(await bottomGap()) <= 1,
			"Deactivating history immediately snaps to the bottom",
		);
		await evaluate(
			"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.appendChatLines(1)",
		);
		await settle();
		assert.ok(
			(await bottomGap()) <= 1,
			"Inactive history follows new messages",
		);
		await evaluate('document.querySelector(".chat-buffer").scrollTop = 0');
		await settle();
		assert.ok(
			(await bottomGap()) <= 1,
			"Inactive history cannot retain an older scroll position",
		);
		await invoke("reset");
		await invoke("receive", {
			kind: "server",
			category: "system",
			message: "Drag selection survives editor blur",
		});
		await click('input[aria-label="Chat message"]');
		const drag = await evaluate(`(() => {
			const span = document.querySelector('.chat-lines p:last-child .chat-message');
			const text = document.createTreeWalker(span, NodeFilter.SHOW_TEXT).nextNode();
			const range = document.createRange();
			range.setStart(text, 0);
			range.setEnd(text, Math.min(20, text.length));
			const rect = range.getClientRects()[0];
			return { x: rect.left + 2, y: rect.top + rect.height / 2, end: Math.min(rect.right - 2, rect.left + 160), hit: document.elementFromPoint(rect.left + 2, rect.top + rect.height / 2)?.outerHTML };
		})()`);
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: drag.x,
			y: drag.y,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			button: "left",
			buttons: 1,
			clickCount: 1,
			x: drag.x,
			y: drag.y,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			button: "left",
			buttons: 1,
			x: drag.end,
			y: drag.y,
		});
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			button: "left",
			clickCount: 1,
			x: drag.end,
			y: drag.y,
		});
		await settle();
		assert.ok(
			(await evaluate("getSelection().toString()")).length > 0,
			`Native drag must select history while editor focus is the only initial activation: ${JSON.stringify(drag)}; ${await evaluate('JSON.stringify({ focus:document.activeElement?.getAttribute("aria-label"), interactive:document.querySelector(".chat-history").className, selection:getSelection().toString() })')}`,
		);
		assert.equal(
			await evaluate(
				'document.querySelector(".chat-history").classList.contains("interactive")',
			),
			true,
		);
		await evaluate("getSelection().removeAllRanges()");
		return {
			channelPrefixTheme: true,
			picker: true,
			commandOverrides: true,
			selectedPlayersAndNpcs: true,
			npcReplyRetell: true,
			preservedFailedDraft: true,
			sessionReset: true,
			syntheticProfessorConfirmation: true,
		};
	} finally {
		await invoke("setPartyPresent", false);
		await evaluate(
			`document.querySelectorAll('.chat-filters button[aria-pressed="false"]').forEach(button => button.click())`,
		);
		await invoke("clearPrompt");
		await invoke("reset");
		// Native viewport clicks select a fixture entity; do not leak it into later HUD probes.
		await evaluate(
			"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.resetSelectionFixture()",
		);
		await settle();
	}
}

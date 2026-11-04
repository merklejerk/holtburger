import assert from "node:assert/strict";

/** Switch real ClientApp themes across roster and gameplay without replacing world resources. */
export async function probeUserThemeLifecycle(
	client,
	evaluate,
	consoleMessages,
) {
	const read = (expression) => evaluate(client, expression);
	const api = "window.__HOLTBURGER_CLIENT_PRESENTATION__";
	const wait = async (expression) => {
		for (let attempt = 0; attempt < 900; attempt++) {
			const failures = consoleMessages.filter(
				({ level }) => level === "error" || level === "exception",
			);
			if (failures.length) throw new Error(JSON.stringify(failures));
			if (await read(expression)) return;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error(`Theme lifecycle timed out: ${expression}`);
	};
	await wait(`${api}?.read().gates.connection.waiting > 0`);
	await read(`${api}.releaseConnection(); ${api}.releaseScene(); true`);
	await wait(
		"document.querySelector('.client-character-list') !== null && document.querySelector('.client-canvas')?.style.visibility === 'visible'",
	);
	await read(
		"window.__USER_THEME_CANVAS__ = document.querySelector('.client-canvas'); true",
	);
	const select = async (id) => {
		await read(`(() => {
			const control = document.querySelector('select[aria-label="UI theme"]');
			if (!control) throw new Error('Theme selector missing');
			control.value = ${JSON.stringify(id ?? "")}; control.dispatchEvent(new Event('change', { bubbles: true }));
		})()`);
		await wait(
			`${api}.theme().selection.kind === 'ready' && ${api}.theme().selection.activeId === ${JSON.stringify(id)}`,
		);
		assert.equal(
			await read(
				"window.__USER_THEME_CANVAS__ === document.querySelector('.client-canvas')",
			),
			true,
		);
	};
	await read(
		"[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Settings' && button.getClientRects().length).click()",
	);
	await wait("!!document.querySelector('.pregame-settings')");
	await read(
		"[...document.querySelectorAll('.pregame-settings [role=tab]')].find(node => node.textContent.trim() === 'UI').click()",
	);
	await select("Steel fixture");
	await select(null);
	await read(
		"document.querySelector('.pregame-settings-heading button').click()",
	);
	await wait("!document.querySelector('.pregame-settings-drawer')?.open");
	await read("document.querySelector('.enter-world').click()");
	await wait(
		`${api}.read().portalReveals === 1 && document.querySelector('.client-world') !== null && document.querySelector('.client-canvas')?.style.visibility === 'visible'`,
	);
	const before = await read(`${api}.read()`);
	await read(
		"document.querySelector('nav[aria-label=\"Game shortcuts\"] button[aria-label=Settings]').click()",
	);
	await wait(
		"!!document.querySelector('[role=tablist][aria-label=\"Settings sections\"]')",
	);
	await read(
		"[...document.querySelectorAll('[role=tablist][aria-label=\"Settings sections\"] [role=tab]')].find(node => node.textContent.trim() === 'UI').click()",
	);
	await select("Steel fixture");
	await select(null);
	const after = await read(`${api}.read()`);
	assert.equal(after.worldCanvases, before.worldCanvases);
	assert.equal(after.worldContextRequests, before.worldContextRequests);
	assert.equal(after.portalReveals, before.portalReveals);
	assert.equal(after.logoutRequests, before.logoutRequests);
	assert.equal(after.disconnectRequests, before.disconnectRequests);
	await read("delete window.__USER_THEME_CANVAS__");
	return {
		rosterSwitch: true,
		gameplaySwitch: true,
		canvasRetained: true,
		runtimeRetained: true,
	};
}

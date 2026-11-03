import assert from "node:assert/strict";

/** Exercise the shared update footer on actual loading, selection, creation and gameplay surfaces. */
export async function probeClientUpdates(client, evaluate, consoleMessages) {
	const read = (expression) => evaluate(client, expression);
	const app = "globalThis.__HOLTBURGER_CLIENT_PRESENTATION__";
	const updates = "globalThis.__HOLTBURGER_UPDATE_FIXTURE__";
	const icon =
		"document.querySelector('.pregame-build button[aria-label^=\"Update available\"]')";
	const wait = async (expression) => {
		const deadline = Date.now() + 90_000;
		while (!(await read(expression))) {
			const errors = consoleMessages.filter(
				({ level }) => level === "error" || level === "exception",
			);
			if (errors.length) throw new Error(JSON.stringify(errors));
			if (Date.now() > deadline)
				throw new Error(`Update probe timeout: ${expression}`);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	};
	const click = (label) =>
		read(`(() => {
		const button = [...document.querySelectorAll('button')].find(element => element.textContent.trim() === ${JSON.stringify(label)});
		if (!button || button.disabled) throw new Error('Unavailable update probe action: ' + ${JSON.stringify(label)});
		button.click();
	})()`);
	const check = async (surface) => {
		await wait(`${icon} !== null`);
		const evidence = await read(`(() => {
			const icon = ${icon}; const bounds = icon.getBoundingClientRect();
			const build = icon.parentElement.getBoundingClientRect();
			return {label: icon.getAttribute('aria-label'), visible: icon.checkVisibility(), x: bounds.left, right: bounds.right, width: innerWidth, buildLeft: build.left, buildRight: build.right, registrations: ${updates}.read().registrations};
		})()`);
		assert.equal(evidence.label, "Update available: v0.2.0 — open downloads");
		assert.equal(evidence.visible, true);
		assert.ok(evidence.x >= 0 && evidence.right <= evidence.width);
		assert.ok(
			evidence.x >= evidence.buildLeft && evidence.right <= evidence.buildRight,
		);
		assert.ok(evidence.registrations > 0);
		return { surface, ...evidence };
	};
	await wait(`${updates} && ${app}?.read().gates.connection.waiting > 0`);
	assert.equal(await read(`${icon} === null`), true);
	await read(
		`${updates}.publish({kind: 'available', version: '0.2.0', tag: 'candidate-20261103-abcdef123'})`,
	);
	const surfaces = [await check("loading")];
	await read(`${icon}.click()`);
	assert.equal(await read(`${updates}.read().opened`), 1);
	await client.send("Emulation.setDeviceMetricsOverride", {
		width: 700,
		height: 650,
		deviceScaleFactor: 1,
		mobile: false,
	});
	surfaces.push(await check("narrow loading"));
	await client.send("Emulation.clearDeviceMetricsOverride");
	await read(
		`${app}.authenticate(); ${app}.releaseConnection(); ${app}.releaseScene()`,
	);
	await wait("document.querySelector('.client-character-list') !== null");
	surfaces.push(await check("selection"));
	await click("Create character");
	await wait("document.querySelector('.creation-layout') !== null");
	surfaces.push(await check("creation"));
	await click("Back");
	await wait("document.querySelector('.enter-world')?.disabled === false");
	await click("Enter World");
	await wait(
		`${app}.read().portalReveals === 1 && document.querySelector('.client-world') !== null`,
	);
	await wait(`${updates}.read().registrations === 0`);
	assert.equal(await read(`${icon} === null`), true);
	await read("document.querySelector('[aria-label=\"System menu\"]').click()");
	await wait(
		"document.querySelector('[role=menu][aria-label=System]') !== null",
	);
	await click("Return to main menu");
	await wait("document.querySelector('.client-character-list') !== null");
	surfaces.push(await check("returned selection"));
	await read(`${updates}.publish({kind: 'current'})`);
	await wait(`${icon} === null`);
	return {
		passed: true,
		surfaces,
		gameplayRegistrations: 0,
		opened: await read(`${updates}.read().opened`),
	};
}

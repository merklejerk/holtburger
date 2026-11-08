import assert from "node:assert/strict";

/** Exercise release changes and lifecycle on actual pregame and gameplay surfaces. */
export async function probeClientUpdates(client, evaluate, consoleMessages) {
	const read = (expression) => evaluate(client, expression);
	const app = "globalThis.__HOLTBURGER_CLIENT_PRESENTATION__";
	const updates = "globalThis.__HOLTBURGER_UPDATE_FIXTURE__";
	const trigger = "document.querySelector('.pregame-build-label')";
	const dialog = "document.querySelector('.app-update-dialog')";
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
	const releases = [
		{
			version: "0.2.0",
			tag: "v0.2.0",
			notes:
				"## Changes\n\n- **Improved** movement\n\n" +
				"- More release details\n".repeat(60),
		},
		{
			version: "0.1.9",
			tag: "v0.1.9",
			notes:
				"Fixed arrival placement. <img src=x onerror=alert(1)> [Details](javascript:alert(1))",
		},
	];
	const available = { kind: "available", releases, historyIncomplete: true };
	const publish = (availability, check) =>
		read(
			`${updates}.publish(${JSON.stringify(availability)}, ${JSON.stringify(check)})`,
		);
	const check = async (surface) => {
		await wait(`${trigger}?.classList.contains('update-available')`);
		const evidence = await read(`(() => {
			const button = ${trigger}; const bounds = button.getBoundingClientRect();
			return {label: button.getAttribute('aria-label'), visible: button.checkVisibility(), x: bounds.left, right: bounds.right, width: innerWidth, registrations: ${updates}.read().registrations};
		})()`);
		assert.equal(evidence.label, "Update available: v0.2.0 — view changes");
		assert.equal(evidence.visible, true);
		assert.ok(evidence.x >= 0 && evidence.right <= evidence.width);
		assert.ok(evidence.registrations > 0);
		assert.equal(
			await read(
				`getComputedStyle(${trigger}.querySelector('.pregame-icon')).animationName !== 'none'`,
			),
			true,
		);
		return { surface, ...evidence };
	};
	await wait(`${updates} && ${app}?.read().gates.connection.waiting > 0`);
	await publish(available, { kind: "ready" });
	const surfaces = [await check("loading")];
	await client.send("Emulation.setEmulatedMedia", {
		features: [{ name: "prefers-reduced-motion", value: "reduce" }],
	});
	assert.equal(
		await read(
			`getComputedStyle(${trigger}.querySelector('.pregame-icon')).animationName`,
		),
		"none",
	);
	await client.send("Emulation.setEmulatedMedia", { features: [] });
	await read(`${trigger}.focus(); ${trigger}.click()`);
	await wait(`${dialog}?.open`);
	const modalEvidence = await read(`(() => {
		const dialog = ${dialog};
		const style = getComputedStyle(dialog);
		const paragraphStyle = getComputedStyle(dialog.querySelector('.release-markdown p'));
		const bodySize = parseFloat(style.getPropertyValue('--ui-font-size-body')) * parseFloat(style.getPropertyValue('--ui-text-scale'));
		const buttons = dialog.querySelector('.ui-dialog-actions').getBoundingClientRect();
		const bounds = dialog.getBoundingClientRect();
		return { readable: parseFloat(paragraphStyle.fontSize) === bodySize && paragraphStyle.textAlign === 'left', actionsVisible: buttons.top >= bounds.top && buttons.bottom <= bounds.bottom, versions: [...dialog.querySelectorAll('h3')].map(element => element.textContent), historyLink: [...dialog.querySelectorAll('button')].some(button => button.textContent.trim() === 'Full release history'), formatted: !!dialog.querySelector('strong'), safe: !dialog.querySelector('img, a, script'), scrollable: dialog.querySelector('.release-changes-content').scrollHeight > dialog.querySelector('.release-changes-content').clientHeight, focused: dialog.contains(document.activeElement) };
	})()`);
	assert.deepEqual(modalEvidence, {
		readable: true,
		actionsVisible: true,
		versions: ["v0.2.0", "v0.1.9"],
		historyLink: true,
		formatted: true,
		safe: true,
		scrollable: true,
		focused: true,
	});
	await click("Download latest release");
	await wait(`${updates}.read().opened === 1`);
	await click("Full release history");
	await wait(`${updates}.read().opened === 2`);
	await client.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	await wait(`${dialog} === null`);
	assert.equal(await read(`document.activeElement === ${trigger}`), true);
	await client.send("Emulation.setDeviceMetricsOverride", {
		width: 700,
		height: 650,
		deviceScaleFactor: 1,
		mobile: false,
	});
	surfaces.push(await check("narrow loading"));
	await read(`${trigger}.click()`);
	await wait(`${dialog}?.open`);
	assert.equal(
		await read(
			`(() => { const bounds = ${dialog}.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight; })()`,
		),
		true,
	);
	await client.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x: 1,
		y: 1,
		button: "left",
		clickCount: 1,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: 1,
		y: 1,
		button: "left",
		clickCount: 1,
	});
	await wait(`${dialog} === null`);
	await client.send("Emulation.clearDeviceMetricsOverride");
	await publish(
		{ kind: "current", releases: [releases[0]] },
		{ kind: "ready" },
	);
	await read(`${trigger}.click()`);
	await wait(`${dialog}?.textContent.includes('You’re up to date')`);
	assert.equal(
		await read(
			`[...${dialog}.querySelectorAll('button')].some(button => button.textContent.trim() === 'Full release history')`,
		),
		false,
	);
	assert.equal(
		await read(`${trigger}.querySelector('.pregame-icon') === null`),
		true,
	);
	assert.equal(await read(`${dialog}.querySelectorAll('h3').length`), 1);
	await publish(available, { kind: "failed", message: "Offline fixture" });
	await wait(`${dialog}?.textContent.includes('Offline fixture')`);
	assert.equal(await read(`${dialog}.querySelectorAll('h3').length`), 2);
	await click("Retry");
	await publish({ kind: "unknown" }, { kind: "loading" });
	await wait(`${dialog}?.textContent.includes('Checking for updates')`);
	await publish({ kind: "unknown" }, { kind: "disabled" });
	await wait(
		`${dialog}?.textContent.includes('Update checking is unavailable')`,
	);
	await click("Close");
	await publish(available, { kind: "ready" });
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
	assert.equal(await read(`${trigger} === null && ${dialog} === null`), true);
	await read("document.querySelector('[aria-label=\"System menu\"]').click()");
	await wait(
		"document.querySelector('[role=menu][aria-label=System]') !== null",
	);
	await click("Return to main menu");
	await wait("document.querySelector('.client-character-list') !== null");
	surfaces.push(await check("returned selection"));
	return {
		passed: true,
		modalEvidence,
		surfaces,
		gameplayRegistrations: 0,
		opened: await read(`${updates}.read().opened`),
	};
}

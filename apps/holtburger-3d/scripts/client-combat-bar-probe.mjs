import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

/** Exercise the production combat HUD through the browser harness boundary. */
export async function probeCombatBar(
	client,
	evaluateExpression,
	screenshotPath,
) {
	const read = (expression) => evaluateExpression(client, expression);
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.combatBarProbe";
	const settle = () =>
		read(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
	const capture = async (name) => {
		if (!screenshotPath) return;
		const shot = await client.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		await writeFile(
			`${screenshotPath}.${name}.png`,
			Buffer.from(shot.data, "base64"),
		);
	};

	await read(`${api}.begin('melee')`);
	await settle();
	assert.equal(
		await read("document.querySelectorAll('.combat-bar').length"),
		1,
	);
	assert.equal(
		await read("document.querySelector('.combat-bar').dataset.combatMode"),
		"melee",
	);
	assert.equal(
		await read(
			"document.querySelector('.breakpoint.selected').textContent.trim()",
		),
		"3",
	);
	await read("document.querySelector('.attack-trigger').click()");
	await settle();
	assert.equal(
		await read("document.querySelector('.combat-target').textContent.trim()"),
		"Training Target",
	);
	await capture("combat-melee");

	await read(`${api}.active('missile')`);
	await settle();
	assert.equal(
		await read("document.querySelector('.combat-bar').dataset.combatMode"),
		"missile",
	);
	const fillLength = await read(
		"parseFloat(document.querySelector('.gauge-fill').style.strokeDasharray)",
	);
	assert.ok(fillLength > 0, "Active refill must render visible arc progress");
	await read("document.querySelector('.breakpoint-5').click()");
	await settle();
	assert.equal(
		await read(
			"document.querySelector('.breakpoint.selected').textContent.trim()",
		),
		"5",
	);
	await read("document.querySelector('.height.head').click()");
	await settle();
	assert.equal(
		await read(
			"document.querySelector('.height.head').getAttribute('aria-pressed')",
		),
		"true",
	);
	await capture("combat-missile");
	await read("document.querySelector('.combat-target').click()");
	await settle();
	assert.equal(await read(`${api}.status().desired`), null);

	await read(`${api}.end()`);
	await settle();
	assert.equal(
		await read("document.querySelectorAll('.combat-bar').length"),
		0,
	);
	return { meleeAttackStop: true, missileRefillLength: fillLength };
}

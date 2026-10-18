import { probeWaypointContent } from "./client-waypoint-content-probe.mjs";

/** Production DOM/owner assertions followed by real pointer capture and clear-button input. */
export async function probeClientWaypoint(client, evaluate) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.waypoint";
	const evidence = await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeWaypoint()",
	);
	await evaluate(
		client,
		`${api}.character(1); ${api}.chat('@waypoint 0N 0E'); (() => { const target = ${api}.read().frame.waypoint.target.position; ${api}.player(target.x - 500, target.z, 0, 0, false, true); })()`,
	);
	const settle = () =>
		evaluate(client, "new Promise(resolve => setTimeout(resolve, 100))");
	await evaluate(
		client,
		`document.querySelector('section[aria-label="World"] button[aria-label="Close World"]').click()`,
	);
	await settle();
	const before = await evaluate(
		client,
		`(() => { const disc = document.querySelector('.minimap-overlay-canvas').getBoundingClientRect(); return { x: disc.x + disc.width / 2, y: disc.y + disc.height / 2, hit: document.elementFromPoint(disc.x + disc.width / 2, disc.y + disc.height / 2)?.outerHTML, pointer: document.querySelector('.minimap-waypoint-pointer').getAttribute('transform'), text: document.querySelector('.minimap-waypoint-row').textContent }; })()`,
	);
	const mouse = (type, x, y, down) =>
		client.send("Input.dispatchMouseEvent", {
			type,
			x,
			y,
			button: "left",
			buttons: down ? 1 : 0,
			clickCount: 1,
		});
	await mouse("mousePressed", before.x, before.y, true);
	await mouse("mouseMoved", before.x + 20, before.y, true);
	await mouse("mouseReleased", before.x + 20, before.y, false);
	await settle();
	const after = await evaluate(
		client,
		`({pointer: document.querySelector('.minimap-waypoint-pointer').getAttribute('transform'), text: document.querySelector('.minimap-waypoint-row').textContent, detached: Boolean(document.querySelector('[aria-label="Re-anchor minimap"]'))})`,
	);
	if (
		!after.detached ||
		after.pointer !== before.pointer ||
		after.text !== before.text
	)
		throw new Error(
			`Real minimap pan changed navigation facts or failed pointer capture: ${JSON.stringify({ before, after })}`,
		);
	const clear = await evaluate(
		client,
		`(() => { const rect = document.querySelector('.minimap-waypoint-row > span:first-of-type').getBoundingClientRect(); return {x: rect.x + rect.width/2, y: rect.y + rect.height/2, hit: document.elementFromPoint(rect.x + rect.width/2, rect.y + rect.height/2)?.outerHTML}; })()`,
	);
	await mouse("mouseMoved", clear.x, clear.y, false);
	await settle();
	const pinAppearance = await evaluate(
		client,
		`(() => {
		const row = document.querySelector('.minimap-waypoint-row');
		const pin = row.querySelector('.ui-waypoint-pin');
		const normal = getComputedStyle(pin);
		if (normal.fill !== getComputedStyle(row).color || normal.transform !== 'none')
			throw new Error('Hovered waypoint pin lost text color or enlarged');
		const style = document.createElement('style');
		style.textContent = '@layer overrides { .ui-theme .ui-waypoint-marker { color: rgb(11, 22, 33); } .ui-theme .ui-waypoint-pin { fill: rgb(44, 55, 66); } }';
		document.head.append(style);
		try {
			if (getComputedStyle(document.querySelector('.world-waypoint-target')).color !== 'rgb(11, 22, 33)' || getComputedStyle(pin).fill !== 'rgb(44, 55, 66)')
				throw new Error('Waypoint theme hooks ignored stylesheet overrides');
			return true;
		} finally { style.remove(); }
	})()`,
	);
	await mouse("mousePressed", clear.x, clear.y, true);
	await mouse("mouseReleased", clear.x, clear.y, false);
	await settle();
	const cleared = await evaluate(
		client,
		`({empty: ${api}.read().frame.waypoint === null, gameActive: ${api}.read().gameActive})`,
	);
	if (!cleared.empty || !cleared.gameActive)
		throw new Error(
			`Real clear-button input failed navigation or keyboard ownership: ${JSON.stringify({ clear, cleared })}`,
		);
	const content = await probeWaypointContent(client, evaluate);
	return {
		...evidence,
		realPointerPan: true,
		realPointerClear: true,
		pinAppearance,
		content,
	};
}

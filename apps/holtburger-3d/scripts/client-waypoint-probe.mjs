import { probeWaypointContent } from "./client-waypoint-content-probe.mjs";

/** Production DOM/owner assertions followed by real pointer capture and clear-button input. */
export async function probeClientWaypoint(client, evaluate) {
	const api = "globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.waypoint";
	const evidence = await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeWaypoint()",
	).catch(async (error) => {
		const snapshot = await evaluate(
			client,
			`({ frame: ${api}.read().frame.waypoint, row: document.querySelector('.minimap-waypoint-row')?.outerHTML, world: document.querySelector('.world-waypoint-target')?.outerHTML })`,
		);
		throw new Error(
			`${error.message}\nWaypoint state: ${JSON.stringify(snapshot)}`,
		);
	});
	await evaluate(
		client,
		`${api}.character(1); ${api}.chat('@waypoint 0N 0E'); (() => { const target = ${api}.read().frame.waypoint.target.position; ${api}.player(target.x - 500, target.z, 0, 0, false, true); })()`,
	);
	const settle = () =>
		evaluate(
			client,
			`(async () => {
			await new Promise(resolve => setTimeout(resolve, 100));
			// Presentation pulls navigation on animation frames; timer expiry alone is insufficient.
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		})()`,
		);
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
	// Set through the actual World panel callback chain and verify app-style toast composition.
	await evaluate(
		client,
		`${api}.character(1); document.querySelector('nav[aria-label="Game shortcuts"] button[aria-label="World"]').click()`,
	);
	await settle();
	await evaluate(
		client,
		`document.querySelector('button[aria-label="Map visibility"]').click()`,
	);
	await settle();
	await evaluate(
		client,
		`[...document.querySelectorAll('[role="menu"][aria-label="Map visibility"] > button')].find(row=>row.getAttribute('aria-haspopup')==='menu').click()`,
	);
	await settle();
	const submenu = await evaluate(
		client,
		`(() => { const root=document.querySelector('[role="menu"][aria-label="Map visibility"]'), child=document.querySelector('.popup-menu-child'); return {root:root.getBoundingClientRect().toJSON(),child:child.getBoundingClientRect().toJSON(),style:child.getAttribute('style'),open:child.matches(':popover-open'),viewport:{width:innerWidth,height:innerHeight}}; })()`,
	);
	if (
		!submenu.open ||
		submenu.child.width <= 0 ||
		submenu.child.left < 0 ||
		submenu.child.top < 0 ||
		submenu.child.right > submenu.viewport.width ||
		submenu.child.bottom > submenu.viewport.height
	)
		throw new Error(`Submenu geometry: ${JSON.stringify(submenu)}`);
	await client.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Tab",
		code: "Tab",
		windowsVirtualKeyCode: 9,
	});
	await client.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Tab",
		code: "Tab",
		windowsVirtualKeyCode: 9,
	});
	await settle();
	const mapPoint = await evaluate(
		client,
		`(() => {const rect=document.querySelector('canvas[aria-label="World terrain map"]').getBoundingClientRect();return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2),messages:${api}.read().messages.length,history:${api}.read().history.length};})()`,
	);
	for (const type of ["mousePressed", "mouseReleased"])
		await client.send("Input.dispatchMouseEvent", {
			type,
			x: mapPoint.x,
			y: mapPoint.y,
			button: "right",
			buttons: type === "mousePressed" ? 2 : 0,
			clickCount: 1,
		});
	await settle();
	await evaluate(
		client,
		`(() => {const row=[...document.querySelectorAll('[aria-label="Map actions"] button')].find(row=>row.textContent.trim()==='Set waypoint');if(!row)throw new Error('Real map context press did not open actions');row.click();})()`,
	);
	await settle();
	const mapWaypoint = await evaluate(
		client,
		`(() => {const current=${api}.read();return {target:current.frame.waypoint?.target,toast:[...document.querySelectorAll('.client-toast')].some(toast=>toast.textContent.includes(current.frame.waypoint?.target.label)),sameChat:current.messages.length===${mapPoint.messages},sameHistory:current.history.length===${mapPoint.history},closed:!document.querySelector('[aria-label="Map actions"]')};})()`,
	);
	if (
		!mapWaypoint.target ||
		!mapWaypoint.toast ||
		!mapWaypoint.sameChat ||
		!mapWaypoint.sameHistory ||
		!mapWaypoint.closed
	)
		throw new Error(`Map waypoint flow failed: ${JSON.stringify(mapWaypoint)}`);
	await evaluate(
		client,
		`document.querySelector('button[aria-label="Map visibility"]').click()`,
	);
	await settle();
	await evaluate(
		client,
		`[...document.querySelectorAll('[aria-label="Map visibility"] > button')].find(row=>row.textContent.replace('✓','').trim()==='Waypoints').click()`,
	);
	await settle();
	const hiddenWorldWaypoint = await evaluate(
		client,
		`${api}.read().frame.waypoint !== null && !document.querySelector('.minimap-waypoint-row').hidden && document.querySelector('.world-waypoint-target').style.display === 'none'`,
	);
	if (!hiddenWorldWaypoint)
		throw new Error(
			"World waypoint visibility affected minimap guidance or retained its pin",
		);
	await evaluate(
		client,
		`[...document.querySelectorAll('[aria-label="Map visibility"] > button')].find(row=>row.textContent.replace('✓','').trim()==='Waypoints').click()`,
	);
	await evaluate(
		client,
		`document.querySelector('section[aria-label="World"] button[aria-label="Close World"]').click()`,
	);
	const content = await probeWaypointContent(client, evaluate);
	return {
		...evidence,
		realPointerPan: true,
		realPointerClear: true,
		pinAppearance,
		mapWaypoint,
		hiddenWorldWaypoint,
		content,
	};
}

import { probeItemUse } from "./client-item-use-probe.mjs";
import { probeSpellBar } from "./client-spell-bar-probe.mjs";
import { probeCombatBar } from "./client-combat-bar-probe.mjs";
import { probeActionBars } from "./client-action-bar-probe.mjs";
import { probeVendor } from "./client-vendor-probe.mjs";
import { probeInventoryDrag } from "./client-inventory-drag-probe.mjs";
import { probeObjectInspection } from "./client-object-inspection-probe.mjs";
import { probeKeyboardPolicy } from "./keyboard-policy-probe.mjs";
import { probeClientTheme } from "./client-theme-probe.mjs";
import { writeFile } from "node:fs/promises";

/** Exercise the client HUD using the runner-owned browser and CDP helpers. */
export async function probeClientHud(
	client,
	{ options, viteUrl, evaluate, evaluateExpression, delay },
) {
	const captureImage = async () =>
		options.screenshotPath === null
			? null
			: (
					await client.send("Page.captureScreenshot", {
						captureBeyondViewport: false,
						format: "png",
					})
				).data;

	const targeting = await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeTargeting",
		[],
	);
	if (!targeting?.passed)
		throw new Error("Client targeting probe did not pass.");
	const keyboardPolicy = await probeKeyboardPolicy(client, evaluateExpression);
	const capture = () =>
		evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.capture",
			[],
		);
	const minimapSurfaceCenter = async () => {
		const state = await capture();
		const map = state.surfaces.Minimap;
		if (map === undefined)
			throw new Error("Client HUD minimap surface is absent.");
		return {
			x: map.left + map.width / 2,
			y: map.top + map.height / 2,
		};
	};
	const panMinimap = async (deltaX, deltaY) => {
		const { x, y } = await minimapSurfaceCenter();
		await client.send("Input.dispatchMouseEvent", {
			button: "left",
			clickCount: 1,
			type: "mousePressed",
			x,
			y,
		});
		await client.send("Input.dispatchMouseEvent", {
			button: "left",
			buttons: 1,
			type: "mouseMoved",
			x: x + deltaX,
			y: y + deltaY,
		});
		await client.send("Input.dispatchMouseEvent", {
			button: "left",
			clickCount: 1,
			type: "mouseReleased",
			x: x + deltaX,
			y: y + deltaY,
		});
	};
	const dispatchPrimaryGesture = async (rectangle, points, release = true) => {
		const start = {
			x: rectangle.left + rectangle.width / 2,
			y: rectangle.top + rectangle.height / 2,
		};
		await client.send("Input.dispatchMouseEvent", {
			button: "left",
			buttons: 1,
			clickCount: 1,
			type: "mousePressed",
			...start,
		});
		for (const point of points) {
			await client.send("Input.dispatchMouseEvent", {
				button: "left",
				buttons: 1,
				type: "mouseMoved",
				x: start.x + point.x,
				y: start.y + point.y,
			});
		}
		if (!release) return start;
		const end = points.at(-1) ?? { x: 0, y: 0 };
		await client.send("Input.dispatchMouseEvent", {
			button: "left",
			buttons: 0,
			clickCount: 1,
			type: "mouseReleased",
			x: start.x + end.x,
			y: start.y + end.y,
		});
		return start;
	};
	const clickStatusIcon = async (kind) => {
		const label =
			kind === "beneficial"
				? "Beneficial enchantments"
				: "Harmful enchantments";
		const bounds = await evaluateExpression(
			client,
			`(() => {
			const button = document.querySelector('[aria-label="${label}"]');
			if (!button) throw new Error('The ${label} tray button is absent.');
			const rectangle = button.getBoundingClientRect();
			const hit = document.elementFromPoint(rectangle.left + rectangle.width / 2, rectangle.top + rectangle.height / 2);
			if (!button.contains(hit)) throw new Error('The ${label} tray button cannot receive pointer input.');
			return { left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height };
		})()`,
		);
		await dispatchPrimaryGesture(bounds, []);
	};
	const clickEnchantmentControl = async (selector) => {
		const bounds = await evaluateExpression(
			client,
			`(() => {
			const control = document.querySelector('[aria-label="Enchantments"] ${selector}');
			if (!control) throw new Error('Enchantment control ${selector} is absent.');
			const rectangle = control.getBoundingClientRect();
			const hit = document.elementFromPoint(rectangle.left + rectangle.width / 2, rectangle.top + rectangle.height / 2);
			if (!control.contains(hit)) throw new Error('Enchantment control ${selector} cannot receive pointer input.');
			return { left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height };
		})()`,
		);
		await dispatchPrimaryGesture(bounds, []);
	};
	const zoomMinimapIn = async (steps) => {
		const { x, y } = await minimapSurfaceCenter();
		for (let step = 0; step < steps; step += 1) {
			await client.send("Input.dispatchMouseEvent", {
				deltaX: 0,
				deltaY: -100,
				type: "mouseWheel",
				x,
				y,
			});
		}
	};
	const toggleMode = async () => {
		await evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.toggleMode",
			[],
		);
		await delay(180);
	};

	await delay(100);
	const beneficialKey = { spellId: 2001, layer: 1 };
	const overriddenKey = { spellId: 2002, layer: 2 };
	const harmfulKey = { spellId: 2000, layer: 1 };
	const enchantmentInstance = (key, kind, powerLevel, remainingSeconds) => ({
		key,
		spellCategory: kind === "harmful" ? 8 : 7,
		powerLevel,
		kind,
		remainingSeconds,
		statModType: 0x9001,
		statModKey: 1,
		statModValue: powerLevel,
	});
	const enchantmentFixture = {
		instances: [
			enchantmentInstance(beneficialKey, "beneficial", 8, 40),
			enchantmentInstance(overriddenKey, "beneficial", 6, 90),
			enchantmentInstance(harmfulKey, "harmful", 5, 25),
		],
		groups: [
			{
				affectedStat: { kind: "attribute", key: 1 },
				statName: "Strength",
				operation: "additive",
				channel: "ordinary",
				spellCategory: 7,
				effective: beneficialKey,
				overridden: [overriddenKey],
			},
			{
				affectedStat: { kind: "attribute", key: 1 },
				statName: "Strength",
				operation: "additive",
				channel: "ordinary",
				spellCategory: 8,
				effective: harmfulKey,
				overridden: [],
			},
			{
				affectedStat: { kind: "skill", key: 1 },
				statName: "Axe",
				operation: "additive",
				channel: "attackSkills",
				spellCategory: 7,
				effective: beneficialKey,
				overridden: [overriddenKey],
			},
		],
	};
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setEnchantments",
		[enchantmentFixture],
	);
	await delay(100);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeSelectedDiagnostics",
		[],
	);
	const runtime = await capture();
	await evaluateExpression(
		client,
		`(() => {
		const labels = [...document.querySelectorAll('section[aria-label="Status tray"] .status-icon')].map((button) => button.getAttribute('aria-label'));
		if (labels.join('|') !== 'Beneficial enchantments|Harmful enchantments')
			throw new Error('Live status tray did not show both effective enchantment kinds.');
	})()`,
	);
	await clickStatusIcon("beneficial");
	await delay(250);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		if (!panel || !panel.textContent.includes('Strength') || !panel.textContent.includes('Impenetrability I'))
			throw new Error('Beneficial tray click did not open the grouped Enchantments window.');
		const beneficial = panel.querySelector('[data-filter-category="disposition"][aria-pressed="true"]');
		if (beneficial?.textContent !== 'Beneficial') throw new Error('Beneficial filter was not selected.');
		const search = panel.querySelector('[aria-label="Search enchantment and stat names"]');
		search.value = 'harm';
		search.dispatchEvent(new Event('input', { bubbles: true }));
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		if (!panel.textContent.includes('No enchantments match')) throw new Error('Search did not filter the beneficial view.');
		const search = panel.querySelector('[aria-label="Search enchantment and stat names"]');
		search.value = 'strength imp';
		search.dispatchEvent(new Event('input', { bubbles: true }));
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		if (!panel.querySelector('section[aria-label="Strength"]') || panel.querySelector('section[aria-label="Axe"]'))
			throw new Error('Search did not combine the stat heading with the spell name.');
	})()`,
	);
	await clickStatusIcon("harmful");
	await delay(200);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		if (!panel.textContent.includes('Harm Other I')) throw new Error('Harmful tray click did not show the harmful effect.');
		if (panel.querySelector('[aria-label="Search enchantment and stat names"]').value !== '') throw new Error('Tray switch did not clear search.');
		if (panel.querySelector('[data-filter-category="disposition"][aria-pressed="true"]')?.textContent !== 'Harmful')
			throw new Error('Harmful tray click did not select its filter.');
	})()`,
	);
	await clickStatusIcon("beneficial");
	await delay(150);
	await clickEnchantmentControl(
		'section[aria-label="Strength"] [data-enchantment-key="2001:1"] .spell-header',
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		const details = panel.querySelector('section[aria-label="Strength"] [data-enchantment-key="2001:1"] .spell-details p');
		if (details?.textContent?.trim() !== 'Fixture spell description.')
			throw new Error('Clicking an enchantment did not expand its authored spell description.');
		if (panel.textContent.includes('+8.00') || panel.textContent.includes('Power 8'))
			throw new Error('Enchantment rows still expose raw modifier or power values.');
	})()`,
	);
	await clickEnchantmentControl(
		'section[aria-label="Strength"] [data-enchantment-key="2001:1"] .tree-toggle',
	);
	await delay(50);
	await clickEnchantmentControl(
		'section[aria-label="Strength"] .overridden [data-enchantment-key="2002:2"] .spell-header',
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		if (!panel.querySelector('section[aria-label="Strength"] .overridden [data-enchantment-key="2002:2"]'))
			throw new Error('Overridden child did not expand beneath its effective spell.');
		if (!panel.querySelector('section[aria-label="Strength"] .overridden [data-enchantment-key="2002:2"] .spell-details'))
			throw new Error('Clicking an overridden spell did not expand its description.');
		if (!panel.querySelector('[data-filter-category="disposition"]'))
			throw new Error('Disposition filters are not visible inline.');
		if (panel.querySelector('[data-filter-category="school"]'))
			throw new Error('School filters are visible before More is expanded.');
		panel.querySelector('.more-filters').click();
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		const pills = panel.querySelector('.filter-pills');
		if (!pills.lastElementChild?.classList.contains('more-filters') ||
			!pills.lastElementChild.textContent.includes('Less...'))
			throw new Error('Less is not the last expanded filter control.');
		[...panel.querySelectorAll('[data-filter-category="school"]')].find((button) => button.textContent === 'Item').click();
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		if (panel.querySelector('section[aria-label="Strength"] .overridden [data-enchantment-key="2002:2"]'))
			throw new Error('School pill left a nonmatching overridden child visible.');
		panel.querySelector('.more-filters').click();
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		if (panel.querySelector('[data-filter-category="school"]') ||
			!panel.querySelector('.more-filters').textContent.includes('(1)'))
			throw new Error('Less did not hide selected school filters or reveal their count.');
		panel.querySelector('.search-line button').click();
		panel.querySelector('.sort-button').click();
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		const keys = [...panel.querySelectorAll('section[aria-label="Strength"] > ul > li')].map((row) => row.dataset.enchantmentKey);
		if (keys.join('|') !== '2001:1|2000:1') throw new Error('Power sorting did not order strongest roots first within Strength.');
		panel.querySelector('.sort-button').click();
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		const sort = panel.querySelector('.sort-button');
		if (sort.dataset.sortField !== 'duration') throw new Error('Sort button did not cycle to duration.');
		sort.click();
		sort.click();
	})()`,
	);
	await clickStatusIcon("beneficial");
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		if (panel.querySelector('.sort-button').dataset.sortField !== 'power') throw new Error('Tray selection lost the sort choice.');
	})()`,
	);
	if (options.screenshotPath) {
		const enchantmentsScreenshot = await client.send("Page.captureScreenshot", {
			captureBeyondViewport: false,
			format: "png",
		});
		await writeFile(
			`${options.screenshotPath}.enchantments.png`,
			Buffer.from(enchantmentsScreenshot.data, "base64"),
		);
	}
	const initialEnchantmentWindow = await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		const handle = panel.querySelector('.hud-window-resize-bottom-left');
		const bounds = panel.getBoundingClientRect();
		const grip = handle.getBoundingClientRect();
		return {
			panel: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
			handle: { left: grip.left, top: grip.top, width: grip.width, height: grip.height },
		};
	})()`,
	);
	await dispatchPrimaryGesture(initialEnchantmentWindow.handle, [
		{ x: -50, y: 35 },
	]);
	await delay(80);
	const resizedEnchantmentWindow = await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		const bounds = panel.getBoundingClientRect();
		const title = panel.querySelector('.hud-window-titlebar').getBoundingClientRect();
		return {
			panel: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
			title: { left: title.left, top: title.top, width: title.width, height: title.height },
		};
	})()`,
	);
	if (
		resizedEnchantmentWindow.panel.width <
			initialEnchantmentWindow.panel.width + 20 ||
		resizedEnchantmentWindow.panel.height <
			initialEnchantmentWindow.panel.height + 15
	)
		throw new Error(
			"The Enchantments window did not resize through its standard HUD handle.",
		);
	await dispatchPrimaryGesture(resizedEnchantmentWindow.title, [
		{ x: -40, y: -10 },
	]);
	await delay(80);
	const movedEnchantmentWindow = await evaluateExpression(
		client,
		`(() => {
		const bounds = document.querySelector('[aria-label="Enchantments"]').getBoundingClientRect();
		return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
	})()`,
	);
	if (movedEnchantmentWindow.left > resizedEnchantmentWindow.panel.left - 20)
		throw new Error(
			"The Enchantments window did not move through its standard title bar.",
		);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setEnchantments",
		[
			{
				...enchantmentFixture,
				instances: [
					{ ...enchantmentFixture.instances[0], remainingSeconds: 0 },
					...enchantmentFixture.instances.slice(1),
				],
			},
		],
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		if (!panel.textContent.includes('awaiting removal')) throw new Error('Zero countdown display: ' + panel.textContent.slice(0, 1000));
		if (!document.querySelector('[aria-label="Beneficial enchantments"]')) throw new Error('Zero countdown hid the beneficial tray icon.');
	})()`,
	);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setEnchantments",
		[
			{
				instances: enchantmentFixture.instances.slice(1),
				groups: enchantmentFixture.groups.map((group) =>
					group.spellCategory === 7
						? { ...group, effective: overriddenKey, overridden: [] }
						: group,
				),
			},
		],
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		if (panel.querySelector('section[aria-label="Strength"] > ul > li[data-enchantment-key="2001:1"]'))
			throw new Error('Server removal left the old effective root visible.');
		if (!panel.querySelector('section[aria-label="Strength"] > ul > li[data-enchantment-key="2002:2"]'))
			throw new Error('Server removal did not promote the overridden spell.');
	})()`,
	);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setEnchantments",
		[enchantmentFixture],
	);
	await evaluateExpression(
		client,
		`document.querySelector('[aria-label="Close Enchantments"]').click()`,
	);
	await delay(50);
	await clickStatusIcon("beneficial");
	await delay(80);
	const reopenedEnchantmentWindow = await evaluateExpression(
		client,
		`(() => {
		const bounds = document.querySelector('[aria-label="Enchantments"]').getBoundingClientRect();
		return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
	})()`,
	);
	if (
		Math.abs(reopenedEnchantmentWindow.left - movedEnchantmentWindow.left) >
			1 ||
		Math.abs(reopenedEnchantmentWindow.width - movedEnchantmentWindow.width) > 1
	)
		throw new Error(
			"The Enchantments window lost its placement when reopened.",
		);
	await evaluateExpression(
		client,
		`document.querySelector('[aria-label="Close Enchantments"]').click()`,
	);
	const vitaeKey = { spellId: 666, layer: 0 };
	const vitaeOnly = {
		instances: [
			{
				...enchantmentInstance(vitaeKey, "vitae", 30, null),
				statModValue: 0.95,
			},
		],
		groups: [],
	};
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setEnchantments",
		[vitaeOnly],
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		if (document.querySelector('[aria-label="Beneficial enchantments"]'))
			throw new Error('Vitae alone showed the beneficial tray icon.');
		if (!document.querySelector('[aria-label="Harmful enchantments"]'))
			throw new Error('Vitae alone did not show the harmful tray icon.');
	})()`,
	);
	await clickStatusIcon("harmful");
	await delay(100);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		const section = panel.querySelector('section[aria-label="Vitae penalty"]');
		if (!section?.textContent.includes('5%') || !section.textContent.includes('Vitae'))
			throw new Error('Vitae penalty section is missing or inaccurate.');
		if (!panel.textContent.includes('1 / 1 effects'))
			throw new Error('Vitae was omitted from the effects count.');
		section.querySelector('.spell-header').click();
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		const section = panel.querySelector('section[aria-label="Vitae penalty"]');
		if (!section.querySelector('.spell-details')?.textContent.includes('Fixture spell description.'))
			throw new Error('Vitae did not open its spell description.');
		panel.querySelector('[aria-label="Search enchantment and stat names"]').value = 'penalty';
		panel.querySelector('[aria-label="Search enchantment and stat names"]').dispatchEvent(new Event('input', { bubbles: true }));
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		if (!panel.querySelector('section[aria-label="Vitae penalty"]'))
			throw new Error('Searching for the Vitae heading lost its spell.');
		panel.querySelector('.more-filters').click();
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		[...panel.querySelectorAll('[data-filter-category="school"]')]
			.find((button) => button.textContent === 'Creature').click();
	})()`,
	);
	await delay(50);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		if (!panel.querySelector('section[aria-label="Vitae penalty"]'))
			throw new Error('Creature school filter hid Vitae.');
		document.querySelector('[aria-label="Close Enchantments"]').click();
	})()`,
	);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setEnchantments",
		[enchantmentFixture],
	);
	runtime.vitals = await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeCharacterVitals",
		[],
	);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.moveMinimapSubjectByBreadcrumbSpacing",
		[0.5],
	);
	await delay(100);
	const breadcrumbBelowSpacing = await capture();
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.moveMinimapSubjectByBreadcrumbSpacing",
		[0.5],
	);
	await delay(100);
	const breadcrumbOutdoorSampled = await capture();
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setMinimapSubject",
		[1, true],
	);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.moveMinimapSubjectByBreadcrumbSpacing",
		[1],
	);
	await delay(100);
	const breadcrumbIndoorSampled = await capture();
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setMinimapSubject",
		[1, false],
	);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.moveMinimapSubjectByBreadcrumbSpacing",
		[1],
	);
	await delay(100);
	const breadcrumbDoorwayTravel = await capture();
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.moveMinimapSubjectByBreadcrumbSpacing",
		[-1],
	);
	await delay(100);
	const breadcrumbRevisited = await capture();
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.teleportMinimapSubject",
		[],
	);
	await delay(100);
	const breadcrumbAfterDiscontinuity = await capture();
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setMinimapSubject",
		[2, false],
	);
	await delay(100);
	const breadcrumbAfterIdentityChange = await capture();
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setMinimapSubject",
		[null, false],
	);
	await delay(100);
	const breadcrumbWithoutControlledSubject = await capture();
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setMinimapSubject",
		[1, false],
	);
	await delay(100);
	const breadcrumbSubjectRestored = await capture();
	// Exercise recording while detached in the environment whose sample spacing remains below the
	// independently tuned automatic re-anchor distance. The automatic-reanchor case follows.
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setMinimapSubject",
		[1, true],
	);
	await delay(100);
	await panMinimap(32, 18);
	await delay(100);
	const minimapPanned = await capture();
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.moveMinimapSubjectByBreadcrumbSpacing",
		[1],
	);
	await delay(100);
	const minimapPannedWithBreadcrumb = await capture();
	await zoomMinimapIn(8);
	await delay(100);
	const minimapPannedZoomed = await capture();
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.resetMinimap",
		[],
	);
	await delay(100);
	const minimapManuallyReanchored = await capture();
	await panMinimap(32, 18);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.moveMinimapSubjectPastAutomaticReanchor",
		[],
	);
	await delay(100);
	const minimapAutomaticallyReanchored = await capture();
	await toggleMode();
	const layout = await capture();
	const wideScreenshot = await captureImage();
	if (options.screenshotPath)
		await writeFile(
			`${options.screenshotPath}.status-tray-horizontal.png`,
			Buffer.from(wideScreenshot, "base64"),
		);
	const shortcutsBefore = layout.surfaces["Game shortcuts"];
	await evaluateExpression(
		client,
		`(() => {
		const tray = document.querySelector('section[aria-label="Game shortcuts"]');
		if (tray.querySelector('[aria-label="Resize Game shortcuts"]'))
			throw new Error('Game shortcuts still exposes resizing.');
		tray.querySelector('[aria-label="Rotate game shortcuts"]').click();
	})()`,
	);
	await delay(50);
	const shortcutsRotated = (await capture()).surfaces["Game shortcuts"];
	if (
		shortcutsRotated.width !== shortcutsBefore.height ||
		shortcutsRotated.height !== shortcutsBefore.width
	)
		throw new Error("Game shortcuts did not rotate its HUD extent.");
	await evaluateExpression(
		client,
		`(() => {
		const buttons = [...document.querySelectorAll('.shortcut-dock > button')];
		const first = buttons[0].getBoundingClientRect();
		const second = buttons[1].getBoundingClientRect();
		if (first.left !== second.left || second.top <= first.top)
			throw new Error('Game shortcuts did not form a vertical column.');
		document.querySelector('[aria-label="Rotate game shortcuts"]').click();
	})()`,
	);
	await delay(50);
	const shortcutsRestored = (await capture()).surfaces["Game shortcuts"];
	if (
		shortcutsRestored.width !== shortcutsBefore.width ||
		shortcutsRestored.height !== shortcutsBefore.height
	)
		throw new Error(
			"Game shortcuts did not restore its horizontal HUD extent.",
		);
	const statusTrayBefore = layout.surfaces["Status tray"];
	if (statusTrayBefore === undefined)
		throw new Error("Status tray is absent from the editable HUD.");
	const rotatePoint = await evaluateExpression(
		client,
		`(() => {
		const tray = document.querySelector('section[aria-label="Status tray"]');
		const button = document.querySelector('[aria-label="Rotate status tray"]');
		if (!tray || !button) throw new Error('Status tray rotate control is absent.');
		const bounds = tray.getBoundingClientRect();
		const rect = button.getBoundingClientRect();
		if (rect.left < bounds.left || rect.top < bounds.top || rect.right > bounds.right || rect.bottom > bounds.bottom)
			throw new Error('Status tray rotate control escaped the panel bounds.');
		const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		if (document.elementFromPoint(point.x, point.y) !== button)
			throw new Error('Status tray rotate control is occluded.');
		return point;
	})()`,
	);
	await client.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		button: "left",
		buttons: 1,
		clickCount: 1,
		...rotatePoint,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		button: "left",
		buttons: 0,
		clickCount: 1,
		...rotatePoint,
	});
	await delay(50);
	const statusTrayRotated = (await capture()).surfaces["Status tray"];
	if (
		statusTrayRotated?.width !== statusTrayBefore.height ||
		statusTrayRotated.height !== statusTrayBefore.width
	)
		throw new Error("Status tray did not rotate its HUD extent.");
	await evaluateExpression(
		client,
		`(() => {
		const icons = [...document.querySelectorAll('section[aria-label="Status tray"] .status-icon')];
		if (icons.length < 2) throw new Error('Status tray has too few icons to verify orientation.');
		const first = icons[0].getBoundingClientRect();
		const second = icons[1].getBoundingClientRect();
		if (first.left !== second.left || second.top <= first.top)
			throw new Error('Status tray icons did not form a vertical column.');
	})()`,
	);
	if (options.screenshotPath) {
		const verticalScreenshot = await client.send("Page.captureScreenshot", {
			captureBeyondViewport: false,
			format: "png",
		});
		await writeFile(
			`${options.screenshotPath}.status-tray-vertical.png`,
			Buffer.from(verticalScreenshot.data, "base64"),
		);
	}
	await evaluateExpression(
		client,
		`document.querySelector('[aria-label="Rotate status tray"]').click()`,
	);
	await delay(50);
	const statusTrayRestored = (await capture()).surfaces["Status tray"];
	if (
		statusTrayRestored?.width !== statusTrayBefore.width ||
		statusTrayRestored.height !== statusTrayBefore.height
	)
		throw new Error("Status tray did not restore its horizontal HUD extent.");
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.dragSurface",
		["Jump power", 80, -16],
	);
	await delay(50);
	const moved = await capture();

	const narrowDimensions = {
		height: options.viewportHeight,
		width: Math.min(options.viewportWidth, 520),
	};
	await client.send("Emulation.setDeviceMetricsOverride", {
		deviceScaleFactor: options.deviceScaleFactor,
		height: narrowDimensions.height,
		mobile: false,
		width: narrowDimensions.width,
	});
	await delay(180);
	const narrow = await capture();
	const narrowScreenshot = await captureImage();

	await client.send("Emulation.setDeviceMetricsOverride", {
		deviceScaleFactor: options.deviceScaleFactor,
		height: Math.min(options.viewportHeight, 360),
		mobile: false,
		width: narrowDimensions.width,
	});
	await delay(180);
	const constrained = await capture();
	const constrainedScreenshot = await captureImage();

	await client.send("Emulation.setDeviceMetricsOverride", {
		deviceScaleFactor: options.deviceScaleFactor,
		height: options.viewportHeight,
		mobile: false,
		width: options.viewportWidth,
	});
	await delay(180);
	const restored = await capture();
	await toggleMode();
	const runtimeRestored = await capture();
	await toggleMode();
	const layoutReopened = await capture();
	await toggleMode();
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setRuntimeTransients",
		[true],
	);
	await delay(180);
	const runtimeTransients = await capture();

	const hoverStartOutside = runtimeTransients.surfaces["Character HUD"];
	await client.send("Input.dispatchMouseEvent", {
		buttons: 0,
		type: "mouseMoved",
		x: hoverStartOutside.left + hoverStartOutside.width / 2,
		y: hoverStartOutside.top + hoverStartOutside.height / 2,
	});
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.resetSelectionFixture",
		[],
	);
	await delay(100);
	const hoverBaseline = await capture();
	const hoverPoint = {
		x: hoverBaseline.gameCanvas.left + hoverBaseline.gameCanvas.width / 2,
		y: hoverBaseline.gameCanvas.top + hoverBaseline.gameCanvas.height / 2,
	};
	await client.send("Input.dispatchMouseEvent", {
		buttons: 0,
		type: "mouseMoved",
		...hoverPoint,
	});
	await delay(120);
	const hoverHit = await capture();
	await delay(220);
	const hoverStationary = await capture();
	await client.send("Input.dispatchMouseEvent", {
		button: "left",
		buttons: 1,
		clickCount: 1,
		type: "mousePressed",
		...hoverPoint,
	});
	await client.send("Input.dispatchMouseEvent", {
		button: "left",
		buttons: 1,
		type: "mouseMoved",
		x: hoverPoint.x + 8,
		y: hoverPoint.y + 5,
	});
	const hoverDragging = await capture();
	await client.send("Input.dispatchMouseEvent", {
		button: "left",
		buttons: 0,
		clickCount: 1,
		type: "mouseReleased",
		x: hoverPoint.x + 8,
		y: hoverPoint.y + 5,
	});
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setHoverHitEnabled",
		[false],
	);
	await delay(100);
	const hoverMiss = await capture();
	const characterPanel = hoverMiss.surfaces["Character HUD"];
	await client.send("Input.dispatchMouseEvent", {
		buttons: 0,
		type: "mouseMoved",
		x: characterPanel.left + characterPanel.width / 2,
		y: characterPanel.top + characterPanel.height / 2,
	});
	await delay(160);
	const hoverExited = await capture();
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.resetSelectionFixture",
		[],
	);
	await delay(100);
	const gestureBaseline = await capture();
	const gateStart = await dispatchPrimaryGesture(
		gestureBaseline.gameCanvas,
		[],
		false,
	);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeViewportBlockers",
		[],
	);
	await client.send("Input.dispatchMouseEvent", {
		button: "left",
		buttons: 0,
		clickCount: 1,
		type: "mouseReleased",
		...gateStart,
	});
	const gateCancelled = await capture();
	if (
		gateCancelled.selectionEvents.length !== 0 ||
		gateCancelled.orbitDeltas.length !== 0
	) {
		throw new Error(
			"Viewport gate retained a blocked gesture or selected on its release.",
		);
	}
	await dispatchPrimaryGesture(gestureBaseline.gameCanvas, [{ x: 2, y: 1 }]);
	await delay(50);
	const viewportSelected = await capture();
	viewportSelected.interactions = await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeSelectedInteractions",
		[],
	);
	await dispatchPrimaryGesture(viewportSelected.gameCanvas, [
		{ x: 2, y: 1 },
		{ x: 8, y: 5 },
		{ x: 11, y: 7 },
	]);
	await delay(50);
	const viewportOrbited = await capture();

	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setPreciseJumpActive",
		[true],
	);
	await delay(20);
	await dispatchPrimaryGesture(viewportOrbited.gameCanvas, []);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setPreciseJumpActive",
		[false],
	);
	await delay(20);
	const preciseJumpSelected = await capture();

	const blurStart = await dispatchPrimaryGesture(
		preciseJumpSelected.gameCanvas,
		[],
		false,
	);
	await client.send("Runtime.evaluate", {
		expression: "window.dispatchEvent(new Event('blur'))",
	});
	await client.send("Input.dispatchMouseEvent", {
		button: "left",
		buttons: 0,
		clickCount: 1,
		type: "mouseReleased",
		...blurStart,
	});
	await delay(20);
	const viewportBlurCancelled = await capture();

	const lifecycleStart = await dispatchPrimaryGesture(
		viewportBlurCancelled.gameCanvas,
		[],
		false,
	);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setCameraEnabled",
		[false],
	);
	await delay(20);
	await client.send("Input.dispatchMouseEvent", {
		button: "left",
		buttons: 0,
		clickCount: 1,
		type: "mouseReleased",
		...lifecycleStart,
	});
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setCameraEnabled",
		[true],
	);
	await delay(20);
	const viewportLifecycleCancelled = await capture();

	const emptyMapPoint = {
		x:
			viewportLifecycleCancelled.minimapOverlayCanvas.left +
			viewportLifecycleCancelled.minimapOverlayCanvas.width * 0.8,
		y:
			viewportLifecycleCancelled.minimapOverlayCanvas.top +
			viewportLifecycleCancelled.minimapOverlayCanvas.height / 2,
	};
	await client.send("Input.dispatchMouseEvent", {
		button: "left",
		buttons: 1,
		clickCount: 1,
		type: "mousePressed",
		...emptyMapPoint,
	});
	await client.send("Input.dispatchMouseEvent", {
		button: "left",
		buttons: 0,
		clickCount: 1,
		type: "mouseReleased",
		...emptyMapPoint,
	});
	await delay(50);
	const minimapCleared = await capture();
	await dispatchPrimaryGesture(minimapCleared.minimapOverlayCanvas, []);
	await delay(50);
	const minimapSelected = await capture();

	await dispatchPrimaryGesture(minimapSelected.minimapOverlayCanvas, [
		{ x: 32, y: 18 },
	]);
	await delay(50);
	const minimapDragged = await capture();

	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setTargetIndicatorFrame",
		[{ rotationRadians: Math.PI / 2, x: 30, y: 400 }],
	);
	await delay(50);
	const targetIndicatorOffscreen = await capture();

	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.resetSelectionFixture",
		[],
	);
	await delay(50);
	const targetIndicatorCleared = await capture();
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.resetMinimap",
		[],
	);
	for (const indoor of [false, true]) {
		for (const category of ["door", "door-no-direct-use", "switch"]) {
			await evaluate(
				client,
				"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeInteractableMarker",
				[category, indoor, false, false],
			);
			await dispatchPrimaryGesture(minimapSelected.minimapOverlayCanvas, []);
			const selected = await capture();
			if (options.screenshotPath && !indoor) {
				const shot = await client.send("Page.captureScreenshot", {
					captureBeyondViewport: false,
					format: "png",
				});
				await writeFile(
					`${options.screenshotPath}.${category}.png`,
					Buffer.from(shot.data, "base64"),
				);
			}
			if (selected.selectedGuid !== 7)
				throw new Error(`${category}: minimap selection failed`);
			for (const [hidden, noDraw] of [
				[true, false],
				[false, true],
			]) {
				await evaluate(
					client,
					"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeInteractableMarker",
					[category, indoor, hidden, noDraw],
				);
				await dispatchPrimaryGesture(minimapSelected.minimapOverlayCanvas, []);
				const cleared = await capture();
				if (cleared.selectedGuid !== null)
					throw new Error(`${category}: invisible marker remained selectable`);
			}
		}
	}
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeInteractableMarker",
		["mob", false, false, false],
	);

	const measureDoor = (angle) =>
		evaluate(
			client,
			"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.measureDoorBar",
			[angle],
		);
	const horizontalDoor = await measureDoor(0);
	const angledDoor = await measureDoor(Math.PI / 4);
	const length = (segment) =>
		Math.hypot(
			segment.end.x - segment.start.x,
			segment.end.y - segment.start.y,
		);
	if (
		Math.abs(horizontalDoor.end.y - horizontalDoor.start.y) > 0.1 ||
		Math.abs(angledDoor.end.y - angledDoor.start.y) < 1
	)
		throw new Error("Door did not follow entity orientation");
	for (const point of [angledDoor.start, angledDoor.end]) {
		await client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			...point,
		});
		await delay(100);
		const hover = await client.send("Runtime.evaluate", {
			expression: "document.querySelector('.minimap-tooltip')?.textContent",
			returnByValue: true,
		});
		if (!hover.result.value?.includes("Selection Fixture"))
			throw new Error("Door endpoint hover missing");
		for (const type of ["mousePressed", "mouseReleased"])
			await client.send("Input.dispatchMouseEvent", {
				type,
				...point,
				button: "left",
				clickCount: 1,
			});
		if ((await capture()).selectedGuid !== 7)
			throw new Error("Door endpoint click did not select");
	}
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseWheel",
		x: (angledDoor.start.x + angledDoor.end.x) / 2,
		y: (angledDoor.start.y + angledDoor.end.y) / 2,
		deltaX: 0,
		deltaY: -100,
	});
	const zoomedDoor = await measureDoor(Math.PI / 4);
	if (length(zoomedDoor) <= length(angledDoor))
		throw new Error("Door width did not grow with map zoom");
	if (options.screenshotPath) {
		const shot = await client.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		await writeFile(
			`${options.screenshotPath}.door-span.png`,
			Buffer.from(shot.data, "base64"),
		);
	}

	const inventory = await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeInventory",
		[],
	);
	inventory.drag = await probeInventoryDrag(client, evaluateExpression);
	inventory.actionBars = await probeActionBars(
		client,
		evaluateExpression,
		options.screenshotPath,
	);
	inventory.itemUse = await probeItemUse(client, evaluateExpression);
	if (options.screenshotPath) {
		const shot = await client.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		await writeFile(
			`${options.screenshotPath}.inventory.png`,
			Buffer.from(shot.data, "base64"),
		);
	}
	await evaluateExpression(
		client,
		`document.querySelector('button[aria-label="Close Inventory"]').click()`,
	);
	inventory.spells = await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeSpells",
		[],
	);
	inventory.spellBar = await probeSpellBar(
		client,
		evaluateExpression,
		options.screenshotPath,
	);
	inventory.combatBar = await probeCombatBar(
		client,
		evaluateExpression,
		options.screenshotPath,
	);
	inventory.worldContainer = await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.probeWorldContainer",
		[],
	);
	if (options.screenshotPath) {
		const shot = await client.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		await writeFile(
			`${options.screenshotPath}.world-container.png`,
			Buffer.from(shot.data, "base64"),
		);
	}

	const clientInspection = await probeObjectInspection(
		client,
		evaluateExpression,
		options.screenshotPath
			? async (name, data) =>
					writeFile(
						`${options.screenshotPath}.${name}.png`,
						Buffer.from(data, "base64"),
					)
			: null,
	);
	inventory.vendor = await probeVendor(
		client,
		evaluateExpression,
		options.screenshotPath
			? async (name, data) =>
					writeFile(
						`${options.screenshotPath}.${name}.png`,
						Buffer.from(data, "base64"),
					)
			: null,
	);

	await evaluateExpression(
		client,
		`document.querySelector('button[aria-label="Settings"]').click()`,
	);
	await delay(50);
	const settingsWindow = await evaluateExpression(
		client,
		`(async () => {
			const window = document.querySelector('.hud-window[aria-label="Settings"]');
			if (!window) throw new Error('Settings shortcut did not open its HUD window');
			const tabs = [...window.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent.trim());
			if (tabs.join(',') !== 'Graphics,UI,Input') throw new Error('Settings tabs are incomplete');
			const graphicsTab = window.querySelector('#settings-tab-graphics');
			graphicsTab.focus();
			const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true });
			graphicsTab.dispatchEvent(tabEvent);
			if (tabEvent.defaultPrevented) throw new Error('Settings intercepted native Tab traversal');
			const nextEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true });
			graphicsTab.dispatchEvent(nextEvent);
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const selectedAfterArrow = window.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim();
			if (selectedAfterArrow !== 'UI') throw new Error('Settings tabs ignored keyboard navigation');
			window.querySelector('#settings-tab-graphics').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			graphicsTab.focus();
			return { tabs, selected: window.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim(), selectedAfterArrow };
		})()`,
	);
	for (const type of ["keyDown", "keyUp"]) {
		await client.send("Input.dispatchKeyEvent", {
			type,
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
		});
	}
	await evaluateExpression(
		client,
		`(() => {
			if (document.activeElement?.id !== 'settings-tab-graphics')
				throw new Error('Settings button activation yielded focus to a gameplay shortcut');
		})()`,
	);
	if (options.screenshotPath) {
		const shot = await client.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		await writeFile(
			`${options.screenshotPath}.settings.png`,
			Buffer.from(shot.data, "base64"),
		);
	}
	const addKeyPoint = await evaluateExpression(
		client,
		`(async () => {
			const panel = document.querySelector('.hud-window[aria-label="Settings"]');
			panel.querySelector('#settings-tab-input').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const button = panel.querySelector('#settings-section-input .binding-actions button');
			const bounds = button.getBoundingClientRect();
			return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
		})()`,
	);
	await client.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x: addKeyPoint.x,
		y: addKeyPoint.y,
		button: "left",
		clickCount: 1,
	});
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: addKeyPoint.x,
		y: addKeyPoint.y,
		button: "left",
		clickCount: 1,
	});
	const addKeyState = await evaluateExpression(
		client,
		`(async () => {
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const dialog = document.querySelector('.hud-window[aria-label="Settings"] .binding-dialog');
			return { open: dialog?.open, focused: document.activeElement === dialog, prompt: dialog?.textContent };
		})()`,
	);
	if (
		addKeyState.open !== true ||
		!addKeyState.focused ||
		!addKeyState.prompt?.includes("Press a key or chord")
	)
		throw new Error(
			`Pointer click did not arm Add key: ${JSON.stringify(addKeyState)}`,
		);
	for (const type of ["keyDown", "keyUp"]) {
		await client.send("Input.dispatchKeyEvent", {
			type,
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
		});
	}
	await evaluateExpression(
		client,
		`(async () => {
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const panel = document.querySelector('.hud-window[aria-label="Settings"]');
			const button = panel?.querySelector('#settings-section-input .binding-actions button');
			if (!button || panel.querySelector('.binding-dialog') || document.activeElement !== button) throw new Error('Escape did not close binding capture and restore focus');
			button.click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			if (!panel.querySelector('.binding-dialog')?.open) throw new Error('Add key did not reopen after Escape');
		})()`,
	);
	for (const type of ["keyDown", "keyUp"]) {
		await client.send("Input.dispatchKeyEvent", {
			type,
			key: "p",
			code: "KeyP",
			windowsVirtualKeyCode: 80,
		});
	}
	await evaluateExpression(
		client,
		`(async () => {
			const panel = document.querySelector('.hud-window[aria-label="Settings"]');
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const row = panel.querySelector('#settings-section-input .binding-row');
			if (![...row.querySelectorAll('kbd')].some((key) => key.textContent === 'p')) throw new Error('Pointer-armed binding did not capture a real key');
			panel.querySelector('#settings-section-input > button').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			panel.querySelector('#settings-tab-graphics').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			panel.querySelector('#settings-tab-graphics').focus();
		})()`,
	);
	const settingsSections = await evaluateExpression(
		client,
		`(async () => {
			const panel = document.querySelector('.hud-window[aria-label="Settings"]');
			const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
			const beginCapture = async (row) => {
				row.querySelector('.binding-actions button').click();
				await frame();
				if (!panel.querySelector('.binding-dialog')?.textContent.includes('Press a key or chord')) throw new Error('Add key did not open the panel dialog');
			};
			panel.querySelector('#settings-tab-ui').click();
			await frame();
			const fonts = panel.querySelectorAll('#settings-section-ui select');
			if (fonts.length !== 3) throw new Error('UI font roles are missing');
			fonts[0].value = 'serif';
			fonts[0].dispatchEvent(new Event('change', { bubbles: true }));
			await frame();
			if (panel.querySelector('#settings-section-ui select').value !== 'serif') throw new Error('UI font edit did not stick');
			if ([...panel.querySelectorAll('#settings-section-ui input[type="range"]')].some((range) => !range.disabled)) throw new Error('Planned scaling controls are active');
			panel.querySelector('#settings-tab-input').click();
			await frame();
			const movement = panel.querySelector('#settings-section-input .binding-group');
			if (!movement || !movement.open) throw new Error('Input movement group did not open');
			const spellGroups = [...panel.querySelectorAll('#settings-section-input .binding-group')].filter((group) => group.querySelector('summary')?.textContent === 'Spells');
			const spellLabels = [...(spellGroups[0]?.querySelectorAll('.binding-label') ?? [])].map((label) => label.textContent);
			if (spellGroups.length !== 1 || spellLabels.length !== 21 || spellLabels.slice(0, 10).some((label) => !label.startsWith('Select spell tab')) || spellLabels[10] !== 'Cast wielded caster spell' || spellLabels.slice(11).some((label) => !label.startsWith('Cast spell slot'))) throw new Error('Spell binding rows are out of order');
			const actionBarsGroup = [...panel.querySelectorAll('#settings-section-input .binding-group')].find((group) => group.querySelector('summary')?.textContent === 'Action bars');
			if (!actionBarsGroup?.textContent.includes('Alternate action modifier') || actionBarsGroup.textContent.includes('Leave focused bar')) throw new Error('Action bar input controls still have duplicate cancellation or detached modifier policy');
			const actionCellRow = [...actionBarsGroup.querySelectorAll('.binding-row')].find((row) => row.querySelector('.binding-label')?.textContent === 'Activate action cell 1');
			const actionCell = document.querySelector('.action-cell[data-action-cell="1"]');
			if (!actionCellRow || !actionCell) throw new Error('Action-cell shortcut fixture is missing');
			if (!actionCell.title.split(String.fromCharCode(10)).some((line) => line === 'Key (focused bar): 1') || actionCell.title.includes('when the binding permits it')) throw new Error('Action-cell tooltip did not use concise multiline text');
			actionCellRow.querySelector('.binding-key').click();
			await frame();
			if (actionCell.querySelector('.ui-shortcut-hint') || !actionCell.title.includes('Unbound')) throw new Error('Unbound action cell retained a shortcut hint');
			await beginCapture(actionCellRow);
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', ctrlKey: true, bubbles: true, cancelable: true }));
			window.dispatchEvent(new KeyboardEvent('keyup', { key: 'q', code: 'KeyQ', ctrlKey: true, bubbles: true, cancelable: true }));
			await frame();
			if (actionCell.querySelector('.ui-shortcut-hint')?.textContent !== 'CQ' || !actionCell.title.includes('Ctrl + q') || actionCell.dataset.actionCell !== '1') throw new Error('Remapped action cell lost its shortcut or stable address');
			await beginCapture(actionCellRow);
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', altKey: true, bubbles: true, cancelable: true }));
			window.dispatchEvent(new KeyboardEvent('keyup', { key: 'r', code: 'KeyR', altKey: true, bubbles: true, cancelable: true }));
			await frame();
			if (actionCell.querySelector('.ui-shortcut-hint')?.textContent !== 'CQ' || !actionCell.title.includes('Ctrl + q / Alt + r')) throw new Error('Action-cell alternatives changed the first hint or disappeared from its tooltip');
			actionCellRow.querySelector('.binding-actions button:last-child').click();
			await frame();
			if (actionCell.querySelector('.ui-shortcut-hint')?.textContent !== '1') throw new Error('Restored action cell did not restore its hint');
			const focusRow = [...actionBarsGroup.querySelectorAll('.binding-row')].find((row) => row.querySelector('.binding-label')?.textContent === 'Focus action bar 1');
			focusRow.querySelector('.binding-key').click();
			await frame();
			await beginCapture(focusRow);
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', code: 'F9', ctrlKey: true, bubbles: true, cancelable: true }));
			window.dispatchEvent(new KeyboardEvent('keyup', { key: 'F9', code: 'F9', ctrlKey: true, bubbles: true, cancelable: true }));
			await frame();
			const actionMenu = document.querySelector('.action-menu-strip');
			if (actionMenu?.textContent !== 'CF9' || !actionMenu.title.includes('Ctrl + F9')) throw new Error('Remapped action-bar menu did not update its hint and tooltip');
			focusRow.querySelector('.binding-actions button:last-child').click();
			await frame();
			if (actionMenu.textContent !== 'C1') throw new Error('Restored action-bar focus hint is wrong');
			await beginCapture(focusRow);
			window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', code: 'Digit2', ctrlKey: true, bubbles: true, cancelable: true }));
			window.dispatchEvent(new KeyboardEvent('keyup', { key: '2', code: 'Digit2', ctrlKey: true, bubbles: true, cancelable: true }));
			await frame();
			const focusConflict = panel.querySelector('.binding-dialog');
			if (!focusConflict?.textContent.includes('Focus action bar 2') || focusConflict.querySelector('button:last-child')?.textContent !== 'Replace' || focusConflict.querySelector('.binding-dialog-key')?.textContent !== 'Ctrl+2') throw new Error('Physical digit binding did not open the replacement dialog with a shortcut pill');
			focusConflict.querySelector('button').click();
			await frame();
			if (panel.querySelector('.binding-dialog') || ![...actionBarsGroup.querySelectorAll('.binding-row')].find((row) => row.querySelector('.binding-label')?.textContent === 'Focus action bar 2')?.textContent.includes('Ctrl+2')) throw new Error('Cancelling replacement changed the existing binding');
			await beginCapture(focusRow);
			window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', code: 'Digit2', ctrlKey: true, bubbles: true, cancelable: true }));
			window.dispatchEvent(new KeyboardEvent('keyup', { key: '2', code: 'Digit2', ctrlKey: true, bubbles: true, cancelable: true }));
			await frame();
			const replacement = panel.querySelector('.binding-dialog');
			if (!replacement?.textContent.includes('Focus action bar 2')) throw new Error('Conflict did not recur after cancellation');
			replacement.querySelector('button:last-child').click();
			await frame();
			const focusTwoRow = [...actionBarsGroup.querySelectorAll('.binding-row')].find((row) => row.querySelector('.binding-label')?.textContent === 'Focus action bar 2');
			if (!focusTwoRow?.textContent.includes('Unbound') || ![...focusRow.querySelectorAll('kbd')].some((key) => key.textContent === 'Ctrl+2')) throw new Error('Replacing digit conflict did not reassign the action-bar chord');
			panel.querySelector('#settings-section-input > button').click();
			await frame();
			const tabRow = [...spellGroups[0].querySelectorAll('.binding-row')].find((row) => row.querySelector('.binding-label')?.textContent === 'Select spell tab 1');
			tabRow.querySelector('.binding-key').click();
			await frame();
			await beginCapture(tabRow);
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', code: 'F9', altKey: true, bubbles: true, cancelable: true }));
			window.dispatchEvent(new KeyboardEvent('keyup', { key: 'F9', code: 'F9', altKey: true, bubbles: true, cancelable: true }));
			globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.spellBarProbe.mode('magic');
			await frame();
			const spellTab = document.querySelector('.spell-tabs button');
			if (spellTab?.textContent !== 'AF9' || !spellTab.title.includes('Alt + F9')) throw new Error('Remapped spell tab did not update its hint and tooltip');
			tabRow.querySelector('.binding-actions button:last-child').click();
			await frame();
			if (spellTab.textContent !== 'S1') throw new Error('Restored spell-tab hint is wrong');
			const castRow = [...spellGroups[0].querySelectorAll('.binding-row')].find((row) => row.querySelector('.binding-label')?.textContent === 'Cast spell slot 1');
			if (!castRow) throw new Error('Spell shortcut fixture is missing');
			castRow.querySelector('.binding-key').click();
			await frame();
			await beginCapture(castRow);
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', altKey: true, bubbles: true, cancelable: true }));
			window.dispatchEvent(new KeyboardEvent('keyup', { key: 'q', code: 'KeyQ', altKey: true, bubbles: true, cancelable: true }));
			globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.spellBarProbe.mode('magic');
			await frame();
			const spellCell = document.querySelector('[data-spell-cell="0"]');
			if (spellCell?.querySelector('.ui-shortcut-hint')?.textContent !== 'AQ' || !spellCell.title.includes('Alt + q')) throw new Error('Remapped spell cell did not update its hint and tooltip');
			castRow.querySelector('.binding-actions button:last-child').click();
			globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.spellBarProbe.mode('peace');
			await frame();
			const combatGroup = [...panel.querySelectorAll('#settings-section-input .binding-group')].find((group) => group.querySelector('summary')?.textContent === 'Combat');
			if (![...combatGroup.querySelectorAll('.binding-label')].some((label) => label.textContent === 'Melee power / missile accuracy 100%')) throw new Error('Combat binding rows hide the power/accuracy percentage');
			const heightRow = [...combatGroup.querySelectorAll('.binding-row')].find((row) => row.querySelector('.binding-label')?.textContent === 'High attack height');
			if (!heightRow) throw new Error('Combat shortcut fixture is missing');
			heightRow.querySelector('.binding-key').click();
			await frame();
			await beginCapture(heightRow);
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', code: 'F8', ctrlKey: true, bubbles: true, cancelable: true }));
			window.dispatchEvent(new KeyboardEvent('keyup', { key: 'F8', code: 'F8', ctrlKey: true, bubbles: true, cancelable: true }));
			globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.combatBarProbe.begin('melee');
			await frame();
			const heightButton = document.querySelector('.height.high');
			if (heightButton?.dataset.shortcut !== 'CF8' || !heightButton.title.includes('Ctrl + F8')) throw new Error('Remapped combat height did not update its hint and tooltip');
			heightRow.querySelector('.binding-actions button:last-child').click();
			globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.combatBarProbe.end();
			await frame();
			const forward = movement.querySelector('.binding-row');
			await beginCapture(forward);
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true, cancelable: true }));
			window.dispatchEvent(new KeyboardEvent('keyup', { key: 'p', code: 'KeyP', bubbles: true, cancelable: true }));
			await frame();
			if (![...forward.querySelectorAll('kbd')].some((key) => key.textContent === 'p')) throw new Error('Captured binding did not appear');
			forward.querySelector('.binding-actions button:last-child').click();
			await frame();
			if ([...forward.querySelectorAll('kbd')].some((key) => key.textContent === 'p')) throw new Error('Per-action default did not restore');
			await beginCapture(forward);
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', bubbles: true, cancelable: true }));
			window.dispatchEvent(new KeyboardEvent('keyup', { key: 's', code: 'KeyS', bubbles: true, cancelable: true }));
			await frame();
			const conflict = panel.querySelector('.binding-dialog');
			if (!conflict || !conflict.textContent.includes('Move backward')) throw new Error('Binding conflict was not explained');
			conflict.querySelector('button:last-child').click();
			await frame();
			if (!movement.querySelectorAll('.binding-row')[1].textContent.includes('Unbound')) throw new Error('Conflict replacement did not clear the old action');
			panel.querySelector('#settings-section-input > button').click();
			await frame();
			panel.querySelector('#settings-tab-graphics').click();
			return { fonts: fonts.length, groups: panel.querySelectorAll('#settings-section-input .binding-group').length, captured: true };
		})()`,
	);
	const staleKey = { spellId: 2100, layer: 1 };
	const replacementKey = { spellId: 2101, layer: 1 };
	const isolatedFixture = (key) => ({
		instances: [
			{
				...enchantmentInstance(key, "beneficial", 8, 40),
				statModType: 0x0200_8004,
				statModKey: 360,
			},
		],
		groups: [
			{
				affectedStat: { kind: "intProperty", key: 360 },
				statName: "WeaponAuraDamage",
				operation: "additive",
				channel: "ordinary",
				spellCategory: 7,
				effective: key,
				overridden: [],
			},
		],
	});
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.deferEnchantmentReferences",
		[],
	);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setEnchantments",
		[isolatedFixture(staleKey)],
	);
	await delay(50);
	await clickStatusIcon("beneficial");
	await delay(70);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		if (!panel?.textContent.includes('Loading spell names and artwork'))
			throw new Error('The held enchantment reference request did not enter loading state.');
	})()`,
	);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.resyncEnchantments",
		[],
	);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.releaseEnchantmentReferences",
		[],
	);
	await delay(80);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		if (!panel?.textContent.includes('Waiting for character enchantments'))
			throw new Error('Resync did not retire the open Enchantments window state.');
		if (document.querySelector('[aria-label="Beneficial enchantments"]'))
			throw new Error('Resync left a stale beneficial tray icon visible.');
	})()`,
	);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.reconnectEnchantments",
		[],
	);
	await evaluate(
		client,
		"globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.setEnchantments",
		[isolatedFixture(replacementKey)],
	);
	await delay(150);
	await evaluateExpression(
		client,
		`(() => {
		const panel = document.querySelector('[aria-label="Enchantments"]');
		if (!panel?.textContent.includes('Spell 2101') || !panel.textContent.includes('Weapon aura damage'))
			throw new Error('The reconnected character enchantment did not load.');
		if (panel.textContent.includes('Spell 2100'))
			throw new Error('The previous character metadata reply repopulated the window.');
	})()`,
	);
	await evaluateExpression(
		client,
		`document.querySelector('[aria-label="Close Enchantments"]').click()`,
	);
	const theme = await probeClientTheme(
		client,
		evaluateExpression,
		options.screenshotPath === null
			? null
			: async (name, data) => {
					await writeFile(
						`${options.screenshotPath}.${name}.png`,
						Buffer.from(data, "base64"),
					);
				},
		viteUrl,
	);

	const clientHud = {
		settingsWindow,
		settingsSections,
		breadcrumbAfterDiscontinuity,
		breadcrumbAfterIdentityChange,
		breadcrumbBelowSpacing,
		breadcrumbDoorwayTravel,
		breadcrumbIndoorSampled,
		breadcrumbOutdoorSampled,
		breadcrumbRevisited,
		breadcrumbSubjectRestored,
		breadcrumbWithoutControlledSubject,
		constrained,
		layout,
		layoutReopened,
		minimapAutomaticallyReanchored,
		minimapManuallyReanchored,
		minimapPanned,
		minimapPannedZoomed,
		minimapPannedWithBreadcrumb,
		minimapCleared,
		minimapDragged,
		minimapSelected,
		targetIndicatorCleared,
		targetIndicatorOffscreen,
		moved,
		narrow,
		restored,
		runtime,
		runtimeRestored,
		runtimeTransients,
		gestureBaseline,
		hoverBaseline,
		hoverDragging,
		hoverExited,
		hoverHit,
		hoverMiss,
		hoverStationary,
		preciseJumpSelected,
		viewportBlurCancelled,
		viewportLifecycleCancelled,
		viewportOrbited,
		viewportSelected,
	};
	assertClientHudHarness(clientHud);
	return {
		clientTheme: theme,
		clientInspection,
		clientTargeting: targeting,
		clientInventory: inventory,
		keyboardPolicy,
		cameraSweepScreenshots:
			options.screenshotPath === null
				? null
				: {
						constrained: constrainedScreenshot,
						narrow: narrowScreenshot,
					},
		clientHud,
		screenshot: wideScreenshot,
		state: {
			error: null,
			ready: true,
			viewport: runtime.viewport,
		},
	};
}

function assertClientHudHarness(evidence) {
	const runtimeLabels = [
		"Action bar 1",
		"Character HUD",
		"Chat",
		"Frame rate",
		"Game shortcuts",
		"Minimap",
		"Status tray",
	].toSorted();
	const layoutLabels = [
		...runtimeLabels,
		"Spell bar",
		"Jump power",
		"Notifications",
		"Selected entity",
	].toSorted();
	assertClientHudLabels(evidence.runtime, "runtime", runtimeLabels);
	assertClientHudLabels(evidence.layout, "layout", layoutLabels);
	assertClientHudLabels(evidence.runtimeRestored, "runtime", runtimeLabels);
	assertClientHudLabels(evidence.layoutReopened, "layout", layoutLabels);
	const selectedEntityPlacement = evidence.layout.surfaces["Selected entity"];
	const frameRatePlacement = evidence.layout.surfaces["Frame rate"];
	if (
		evidence.runtime.selectedEntityHud !== null ||
		evidence.layout.selectedEntityHud?.name !== "Selected Entity" ||
		evidence.layout.selectedEntityHud.interactDisabled !== true ||
		Math.abs(
			selectedEntityPlacement.left +
				selectedEntityPlacement.width / 2 -
				evidence.layout.viewport.width / 2,
		) > 1 ||
		selectedEntityPlacement.top -
			(frameRatePlacement.top + frameRatePlacement.height) !==
			8
	) {
		throw new Error(
			`Client HUD selected-entity surface did not preserve its preview or default placement contract: ${JSON.stringify(evidence.layout)}.`,
		);
	}
	if (
		evidence.viewportSelected.selectedEntityHud?.name !== "Drudge" ||
		evidence.viewportSelected.selectedEntityHud.interactDisabled !== false
	) {
		throw new Error(
			`Client HUD selected-entity surface did not present the selected display value with an enabled interaction: ${JSON.stringify(evidence.viewportSelected)}.`,
		);
	}
	if (
		evidence.gestureBaseline.selectionEvents.length !== 0 ||
		evidence.gestureBaseline.orbitDeltas.length !== 0
	) {
		throw new Error(
			"Client HUD selection gesture fixture did not begin cleanly.",
		);
	}
	if (
		evidence.hoverBaseline.gameCanvasCursor !== "grab" ||
		evidence.hoverHit.gameCanvasCursor !== "pointer" ||
		evidence.hoverHit.hoveredGuid !== 7 ||
		evidence.hoverHit.selectedGuid !== null
	) {
		throw new Error(
			"Client HUD hover hit did not change only the selectable canvas cursor.",
		);
	}
	if (
		evidence.hoverStationary.viewportHoverPoints.length <=
			evidence.hoverHit.viewportHoverPoints.length ||
		evidence.hoverStationary.viewportHoverPoints.length > 6 ||
		evidence.hoverStationary.selectionMaintenanceCount <=
			evidence.hoverHit.selectionMaintenanceCount
	) {
		throw new Error(
			"Client HUD hover did not resample a stationary pointer at the bounded cadence.",
		);
	}
	if (evidence.hoverDragging.gameCanvasCursor !== "grabbing") {
		throw new Error(
			"Client HUD selectable cursor overrode active camera-drag feedback.",
		);
	}
	if (
		evidence.hoverMiss.gameCanvasCursor !== "grab" ||
		evidence.hoverMiss.hoveredGuid !== null ||
		evidence.hoverMiss.selectedGuid !== null
	) {
		throw new Error(
			"Client HUD hover miss did not restore the ordinary cursor without selecting.",
		);
	}
	if (
		evidence.hoverExited.viewportHoverPoints.length >
			evidence.hoverMiss.viewportHoverPoints.length + 1 ||
		evidence.hoverExited.selectionMaintenanceCount <=
			evidence.hoverMiss.selectionMaintenanceCount
	) {
		throw new Error(
			"Client HUD did not separate selection maintenance from canvas hover sampling.",
		);
	}
	if (
		evidence.viewportSelected.selectedGuid !== 7 ||
		evidence.viewportSelected.viewportSelectionPoints.length !== 1 ||
		evidence.viewportSelected.orbitDeltas.length !== 0
	) {
		throw new Error(
			"Client HUD click-scale viewport jitter did not select without orbiting.",
		);
	}
	if (
		JSON.stringify(evidence.viewportOrbited.orbitDeltas) !==
			JSON.stringify([
				{ x: 8, y: -5 },
				{ x: 3, y: -2 },
			]) ||
		evidence.viewportOrbited.viewportSelectionPoints.length !== 1
	) {
		throw new Error(
			"Client HUD viewport drag lost threshold-crossing motion or selected while orbiting.",
		);
	}
	if (
		evidence.preciseJumpSelected.preciseJumpActivationCount !== 1 ||
		evidence.preciseJumpSelected.viewportSelectionPoints.length !== 1
	) {
		throw new Error(
			"Client HUD precise-jump mode did not exclusively consume the primary click.",
		);
	}
	if (
		evidence.viewportBlurCancelled.viewportSelectionPoints.length !== 1 ||
		evidence.viewportLifecycleCancelled.viewportSelectionPoints.length !== 1
	) {
		throw new Error(
			"Client HUD blur or camera lifecycle teardown completed an armed selection.",
		);
	}
	if (
		JSON.stringify(evidence.minimapCleared.selectionEvents) !==
			JSON.stringify([7, null]) ||
		evidence.minimapCleared.selectedGuid !== null
	) {
		throw new Error("Client HUD empty minimap click did not clear selection.");
	}
	if (
		JSON.stringify(evidence.minimapSelected.selectionEvents) !==
			JSON.stringify([7, null, 7]) ||
		evidence.minimapSelected.selectedGuid !== 7 ||
		evidence.minimapSelected.minimapOverlayArcCalls <=
			evidence.minimapCleared.minimapOverlayArcCalls
	) {
		throw new Error(
			"Client HUD minimap blip click did not select through the shared owner and draw its ring.",
		);
	}
	if (
		JSON.stringify(evidence.minimapDragged.selectionEvents) !==
			JSON.stringify(evidence.minimapSelected.selectionEvents) ||
		!evidence.minimapDragged.minimapResetVisible
	) {
		throw new Error("Client HUD minimap drag selected instead of panning.");
	}
	const targetIndicatorFillAlphaMatch =
		evidence.targetIndicatorOffscreen.targetIndicator?.fill?.match(
			/^rgba\([^)]*,\s*([0-9.]+)\)$/,
		) ?? null;
	const targetIndicatorFillAlpha =
		targetIndicatorFillAlphaMatch === null
			? null
			: Number(targetIndicatorFillAlphaMatch[1]);
	if (
		targetIndicatorFillAlpha === null ||
		targetIndicatorFillAlpha <= 0 ||
		targetIndicatorFillAlpha >= 1 ||
		Math.abs(
			evidence.targetIndicatorOffscreen.targetIndicator.rectangle.left +
				evidence.targetIndicatorOffscreen.targetIndicator.rectangle.width / 2 -
				30,
		) > 1 ||
		Math.abs(
			evidence.targetIndicatorOffscreen.targetIndicator.rectangle.top +
				evidence.targetIndicatorOffscreen.targetIndicator.rectangle.height / 2 -
				400,
		) > 1 ||
		!evidence.targetIndicatorOffscreen.targetIndicator.filter.includes(
			"drop-shadow",
		) ||
		!evidence.targetIndicatorOffscreen.selectionAnnouncement.includes(
			"0x00000007",
		)
	) {
		throw new Error(
			`Client HUD did not place, glow, or announce the off-screen target marker: ${JSON.stringify(evidence.targetIndicatorOffscreen)}.`,
		);
	}
	if (
		evidence.targetIndicatorCleared.targetIndicator !== null ||
		evidence.targetIndicatorCleared.selectionAnnouncement !==
			"No entity selected"
	) {
		throw new Error(
			"Client HUD retained a marker for an unrealized or cleared target.",
		);
	}
	if (
		evidence.runtime.minimapOverlayArcCalls <= 0 ||
		evidence.runtime.minimapOverlayInkPixels <= 0
	) {
		throw new Error("Client HUD minimap did not draw its initial breadcrumb.");
	}
	if (
		evidence.breadcrumbBelowSpacing.minimapOverlayArcCalls !==
		evidence.runtime.minimapOverlayArcCalls
	) {
		throw new Error(
			"Client HUD minimap recorded movement below its breadcrumb spacing.",
		);
	}
	if (
		evidence.breadcrumbOutdoorSampled.minimapOverlayArcCalls <=
		evidence.breadcrumbBelowSpacing.minimapOverlayArcCalls
	) {
		throw new Error(
			"Client HUD minimap did not record outdoor breadcrumb travel at its spacing.",
		);
	}
	if (
		evidence.breadcrumbIndoorSampled.minimapOverlayArcCalls <=
		evidence.breadcrumbOutdoorSampled.minimapOverlayArcCalls
	) {
		throw new Error(
			"Client HUD minimap did not apply denser indoor breadcrumb spacing.",
		);
	}
	if (
		evidence.breadcrumbDoorwayTravel.minimapOverlayArcCalls <=
		evidence.breadcrumbIndoorSampled.minimapOverlayArcCalls
	) {
		throw new Error(
			"Client HUD minimap discarded breadcrumb history at an ordinary doorway transition.",
		);
	}
	if (
		evidence.breadcrumbRevisited.minimapOverlayArcCalls >=
		evidence.breadcrumbDoorwayTravel.minimapOverlayArcCalls
	) {
		throw new Error(
			"Client HUD minimap consumed another breadcrumb slot when revisiting covered space.",
		);
	}
	if (
		evidence.breadcrumbAfterDiscontinuity.minimapOverlayArcCalls >=
		evidence.breadcrumbRevisited.minimapOverlayArcCalls
	) {
		throw new Error(
			"Client HUD minimap retained old breadcrumb history after a discontinuity.",
		);
	}
	if (
		evidence.breadcrumbAfterIdentityChange.minimapOverlayArcCalls !==
		evidence.breadcrumbAfterDiscontinuity.minimapOverlayArcCalls
	) {
		throw new Error(
			"Client HUD minimap carried breadcrumb history across controlled identities.",
		);
	}
	if (
		evidence.breadcrumbWithoutControlledSubject.minimapOverlayArcCalls !== 0 ||
		evidence.breadcrumbWithoutControlledSubject.minimapOverlayInkPixels !== 0
	) {
		throw new Error(
			"Client HUD minimap retained breadcrumbs without a controlled subject.",
		);
	}
	if (evidence.breadcrumbSubjectRestored.minimapOverlayArcCalls <= 0) {
		throw new Error(
			"Client HUD minimap did not begin a fresh trail when control returned.",
		);
	}
	if (evidence.runtime.minimapResetVisible) {
		throw new Error("Client HUD minimap reset is visible before panning.");
	}
	if (!evidence.minimapPanned.minimapResetVisible) {
		throw new Error(
			"Client HUD minimap drag did not reveal its reset control.",
		);
	}
	if (
		evidence.minimapPanned.minimapCoordinates ===
		evidence.runtime.minimapCoordinates
	) {
		throw new Error(
			"Client HUD minimap drag did not move the viewed coordinates.",
		);
	}
	if (
		!evidence.runtime.minimapConeVisible ||
		!evidence.minimapPanned.minimapConeVisible
	) {
		throw new Error(
			"Client HUD minimap hid the camera cone while its subject was visible.",
		);
	}
	if (!evidence.minimapPannedWithBreadcrumb.minimapResetVisible) {
		throw new Error(
			"Client HUD minimap breadcrumb travel incorrectly cancelled a nearby detached view.",
		);
	}
	if (
		evidence.minimapPannedWithBreadcrumb.minimapOverlayArcCalls <=
		evidence.minimapPanned.minimapOverlayArcCalls
	) {
		throw new Error(
			"Client HUD minimap stopped recording breadcrumbs while panned.",
		);
	}
	if (evidence.minimapPannedZoomed.minimapConeVisible) {
		throw new Error(
			"Client HUD minimap retained the camera cone after zoom moved its subject off-disc.",
		);
	}
	if (evidence.minimapManuallyReanchored.minimapResetVisible) {
		throw new Error("Client HUD minimap reset did not restore follow mode.");
	}
	if (!evidence.minimapManuallyReanchored.minimapConeVisible) {
		throw new Error(
			"Client HUD minimap reset did not restore its camera cone.",
		);
	}
	if (evidence.minimapAutomaticallyReanchored.minimapResetVisible) {
		throw new Error(
			"Client HUD minimap did not re-anchor after subject travel.",
		);
	}
	assertClientHudLabels(
		evidence.runtimeTransients,
		"runtime",
		[...runtimeLabels, "Jump power", "Notifications"].toSorted(),
	);
	if (
		evidence.layout.toast?.preview !== true ||
		evidence.layout.toast.role !== null ||
		evidence.layout.toast.text !== "Notification preview"
	) {
		throw new Error(
			`Client HUD layout toast is not an inert preview: ${JSON.stringify(evidence.layout.toast)}.`,
		);
	}
	if (evidence.layout.jumpActionDisabled !== true) {
		throw new Error("Client HUD layout jump action remained interactive.");
	}
	if (
		evidence.runtimeTransients.toast?.preview !== false ||
		evidence.runtimeTransients.toast.role !== "status" ||
		evidence.runtimeTransients.jumpActionDisabled !== false
	) {
		throw new Error(
			`Client HUD runtime transients did not retain live semantics: ${JSON.stringify(evidence.runtimeTransients)}.`,
		);
	}
	for (const state of Object.values(evidence)) {
		if ("preciseJumpEnterCount" in state && state.preciseJumpEnterCount !== 0) {
			throw new Error(
				"Client HUD layout preview dispatched precise-jump input.",
			);
		}
	}
	const movedOffset = clientHudHorizontalCenterOffset(
		evidence.moved.surfaces["Jump power"],
		evidence.moved.viewport,
	);
	for (const [name, state] of [
		["narrow", evidence.narrow],
		["constrained", evidence.constrained],
		["restored", evidence.restored],
		["layout-reopened", evidence.layoutReopened],
	]) {
		const offset = clientHudHorizontalCenterOffset(
			state.surfaces["Jump power"],
			state.viewport,
		);
		if (Math.abs(offset - movedOffset) > 1) {
			throw new Error(
				`Client HUD center offset drifted in ${name}: ${offset} versus ${movedOffset}.`,
			);
		}
	}
	for (const state of [
		evidence.layout,
		evidence.narrow,
		evidence.constrained,
	]) {
		for (const [label, rectangle] of Object.entries(state.surfaces))
			assertClientHudRectangleInsideViewport(label, rectangle, state.viewport);
		for (const [label, rectangle] of Object.entries(state.moveHandles))
			assertClientHudRectangleInsideViewport(
				`${label} move handle`,
				rectangle,
				state.viewport,
			);
	}
}

function assertClientHudLabels(state, expectedMode, expectedLabels) {
	const labels = Object.keys(state.surfaces).toSorted();
	if (
		state.mode !== expectedMode ||
		JSON.stringify(labels) !== JSON.stringify(expectedLabels)
	) {
		throw new Error(
			`Client HUD ${expectedMode} inventory mismatch: ${JSON.stringify({ labels, mode: state.mode })}.`,
		);
	}
}

function clientHudHorizontalCenterOffset(rectangle, viewport) {
	return rectangle.left + rectangle.width / 2 - viewport.width / 2;
}

function assertClientHudRectangleInsideViewport(label, rectangle, viewport) {
	const epsilon = 0.5;
	if (
		rectangle.left < -epsilon ||
		rectangle.top < -epsilon ||
		rectangle.left + rectangle.width > viewport.width + epsilon ||
		rectangle.top + rectangle.height > viewport.height + epsilon
	) {
		throw new Error(
			`Client HUD rectangle escaped the viewport: ${JSON.stringify({ label, rectangle, viewport })}.`,
		);
	}
}

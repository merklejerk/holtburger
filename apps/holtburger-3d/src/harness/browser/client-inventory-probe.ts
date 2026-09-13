import { tick } from "svelte";
import type { ItemStructure } from "../../app/item-structure";
import type { ClientEntityFacts } from "../../client/client-entity-mirror";
import type { ClientEntitySelection } from "../../client/client-entity-selection";
import { CLIENT_TUNING } from "../../client/client-tuning";
import { CLIENT_UI_DEFAULTS } from "../../client/client-ui-defaults";
import { INVENTORY_CURRENCIES } from "../../client/client-inventory-currencies";
import { EQUIPMENT_SLOTS } from "../../client/client-inventory-equipment";

/** Browser-only fixture record; wire delivery still passes through the real session decoder. */
function item(
	guid: number,
	overrides: Partial<ClientEntityFacts> = {},
): ClientEntityFacts {
	return {
		guid,
		description: {
			kind: "known",
			name: `Inventory item ${guid}`,
			healthQuery: "ineligible",
			itemType: 0,
			objectFlags: 0,
			wcid: null,
			weenieType: null,
			pyrealBalance: null,
			burden: null,
			equipLocations: null,
			stackCount: null,
			structure: { current: null, max: null },
			icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
		},
		location: { kind: "none" },
		ownedByPlayer: false,
		targeting: "non-creature",
		scenePlacement: "available",
		storage: { kind: "not-established" },
		...overrides,
	};
}

/** A repeatable real-session inventory scenario without a content server or runtime assets. */
export async function probeClientInventory(options: {
	readonly emit: (event: string, payload: unknown) => void;
	readonly selection: ClientEntitySelection;
	/** Persistent inventory maintenance, independent of producer event count. */
	readonly readSampleCount: () => number;
	/** Synthetic content controls; production model, repository and browser decoding remain real. */
	readonly readPreparedIconCount: () => number;
	readonly holdIconPreparation: () => () => void;
	readonly failIcon: (base: number) => void;
	/** Actual camera/selection callbacks exposed by the production world view. */
	readonly readViewportInput: () => {
		readonly clicks: number;
		readonly orbits: number;
		readonly zooms: number;
	};
	readonly commands: readonly {
		readonly command: string;
		readonly args: Record<string, unknown> | undefined;
	}[];
}) {
	const { emit, selection, commands } = options;
	const sample = async () => {
		await tick();
		await new Promise((resolve) =>
			window.setTimeout(
				resolve,
				Math.max(
					CLIENT_TUNING.inventory.displayIntervalMs,
					CLIENT_TUNING.selectedEntityHud.displayIntervalMs,
				) * 2,
			),
		);
	};
	const button = (label: string): HTMLButtonElement => {
		const found = document.querySelector<HTMLButtonElement>(
			`button[aria-label="${label}"]`,
		);
		if (found === null)
			throw new Error(`Inventory probe cannot find ${label}.`);
		return found;
	};
	const cell = (guid: number): HTMLButtonElement => {
		const found = document.querySelector<HTMLButtonElement>(
			`[data-item-guid="${guid}"]`,
		);
		if (found === null)
			throw new Error(`Inventory probe cannot find item ${guid}.`);
		return found;
	};
	const windowRect = () => {
		const windows = document.querySelectorAll(".hud-window");
		if (windows.length !== 1)
			throw new Error("Exactly one system panel must be open.");
		const rect = windows[0]?.getBoundingClientRect();
		if (rect === undefined) throw new Error("Floating window is missing.");
		return {
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
		};
	};
	const squares = () => {
		const rects = Array.from(
			document.querySelectorAll(".inventory-grid .item-grid-cell"),
		).map((element) => element.getBoundingClientRect());
		if (
			rects.length === 0 ||
			rects.some((rect) => Math.abs(rect.width - rect.height) > 1)
		)
			throw new Error("Inventory cells are missing or not square.");
		return {
			count: rects.length,
			width: rects[0]?.width,
			columns: new Set(rects.map((rect) => rect.left)).size,
		};
	};
	const owned = (guid: number, parentGuid: number, index: number) =>
		item(guid, {
			ownedByPlayer: true,
			location: {
				kind: "contained",
				parentGuid,
				slot: { kind: "item", index },
			},
			targeting: "ineligible",
			scenePlacement: "unavailable",
		});
	let records = [
		item(1, {
			description: {
				kind: "known",
				name: "Player",
				healthQuery: "eligible",
				itemType: 16,
				objectFlags: 0,
				wcid: null,
				weenieType: null,
				pyrealBalance: 12345,
				burden: null,
				equipLocations: null,
				stackCount: null,
				structure: { current: null, max: null },
				icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
			},
			storage: {
				kind: "container",
				roster: "announced",
				packCapacity: 7,
				itemCapacity: 24,
			},
		}),
		item(7, {
			description: {
				kind: "known",
				name: "Creature",
				healthQuery: "eligible",
				itemType: 0,
				objectFlags: 0,
				wcid: null,
				weenieType: null,
				pyrealBalance: null,
				burden: null,
				equipLocations: null,
				stackCount: null,
				structure: { current: null, max: null },
				icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
			},
		}),
		...Array.from({ length: 9 }, (_, index) => owned(20 + index, 1, index)),
		{
			...owned(30, 1, 0),
			location: {
				kind: "contained" as const,
				parentGuid: 1,
				slot: {
					kind: "pack" as const,
					index: 1,
					entryKind: "container" as const,
				},
			},
			storage: {
				kind: "container" as const,
				roster: "announced" as const,
				packCapacity: 7,
				itemCapacity: 24,
			},
		},
		{
			...owned(31, 1, 1),
			location: {
				kind: "contained" as const,
				parentGuid: 1,
				slot: { kind: "pack" as const, index: 0, entryKind: "foci" as const },
			},
		},
		{ ...owned(32, 30, 0), description: { kind: "pending" as const } },
	];
	const baseline = () =>
		emit("client-current-state", {
			lifecycle: { kind: "in-world" },
			entityCollisionDisabled: false,
			localPlayerGuid: 1,
			serverTime: 10,
			worldGeneration: 1,
			worldName: "Fixture",
			playerName: "Wayfarer",
			vitals: [],
			characterMotion: null,
			activeConfirmation: null,
			dynamic: { hostTime: { seconds: 10 }, entities: [] },
			entities: { entities: records },
		});
	const update = (record: ClientEntityFacts) => {
		records = records.map((previous) =>
			previous.guid === record.guid ? record : previous,
		);
		emit("client-entity-facts-changed", { upserts: [record], removed: [] });
	};
	update({
		...owned(20, 1, 0),
		description: {
			kind: "known",
			name: "Zebra",
			healthQuery: "ineligible",
			itemType: 1,
			objectFlags: 0,
			wcid: null,
			weenieType: null,
			pyrealBalance: null,
			burden: null,
			equipLocations: null,
			stackCount: null,
			structure: { current: null, max: null },
			icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
		},
	});
	update({
		...owned(21, 1, 1),
		description: {
			kind: "known",
			name: "Apple",
			healthQuery: "ineligible",
			itemType: 2,
			objectFlags: 0x8000,
			wcid: 123,
			weenieType: "Food",
			pyrealBalance: null,
			burden: null,
			equipLocations: null,
			stackCount: null,
			structure: { current: null, max: null },
			icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
		},
	});
	baseline();
	selection.select(7);
	if (button("Inventory").getAttribute("aria-pressed") !== "true")
		button("Inventory").click();
	await sample();
	const burdenIndicator =
		document.querySelector<HTMLElement>(".inventory-burden");
	if (burdenIndicator === null)
		throw new Error("Inventory burden indicator missing.");
	const playerRecord = records.find((record) => record.guid === 1);
	if (playerRecord?.description.kind !== "known")
		throw new Error("Inventory burden probe requires a known player.");
	for (const [burden, level, label] of [
		[null, "pending", "…"],
		[0, "normal", "0%"],
		[0.73, "normal", "73%"],
		[1, "burdened", "100%"],
		[1.5, "burdened", "150%"],
		[2, "overburdened", "200%"],
		[3, "overburdened", "300%"],
		[null, "pending", "…"],
	] as const) {
		update({
			...playerRecord,
			description: { ...playerRecord.description, burden },
		});
		await sample();
		if (
			burdenIndicator.dataset.level !== level ||
			burdenIndicator.textContent?.trim() !== label ||
			burdenIndicator.getAttribute("aria-label") !==
				`Burden: ${burden === null ? "Loading" : label}`
		)
			throw new Error(`Inventory burden did not display ${level}: ${label}.`);
		if (level !== "pending") {
			const knob =
				level === "normal"
					? "normal"
					: level === "burdened"
						? "warning"
						: "danger";
			burdenIndicator.style.setProperty(
				`--ui-inventory-burden-${knob}-color`,
				"rgb(1, 2, 3)",
			);
			if (getComputedStyle(burdenIndicator).color !== "rgb(1, 2, 3)")
				throw new Error(`Inventory burden ${knob} color is not themeable.`);
			burdenIndicator.style.removeProperty(
				`--ui-inventory-burden-${knob}-color`,
			);
		}
	}
	const firstMainItem = () =>
		document
			.querySelector(
				'[data-container-guid="1"] .inventory-grid .item-grid-cell',
			)
			?.getAttribute("data-item-guid");
	if (
		!document
			.querySelector(".inventory-currency")
			?.textContent?.includes("12,345")
	)
		throw new Error("Inventory footer did not show the server coin total.");
	const currency = document.querySelector<HTMLElement>(".inventory-currency");
	if (currency === null) throw new Error("Currency trigger missing");
	currency.focus();
	await tick();
	const popup = document.querySelector<HTMLElement>(
		".inventory-currency-overlay",
	);
	if (popup === null || !popup.matches(":popover-open"))
		throw new Error("Currency overlay did not open on keyboard focus");
	const popupRect = popup.getBoundingClientRect();
	if (
		popupRect.top < 0 ||
		popupRect.right > window.innerWidth ||
		popupRect.bottom > window.innerHeight
	)
		throw new Error("Currency overlay escaped the viewport");
	window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
	if (popup.matches(":popover-open"))
		throw new Error("Currency overlay ignored Escape");
	currency.blur();
	currency.dispatchEvent(new PointerEvent("pointerenter"));
	if (!popup.matches(":popover-open"))
		throw new Error("Currency hover did not open overlay");
	currency.dispatchEvent(new PointerEvent("pointerleave"));
	await new Promise((resolve) => window.setTimeout(resolve, 200));
	if (popup.matches(":popover-open"))
		throw new Error("Currency overlay remained after pointer departure");
	const currencyImage = currency?.querySelector<HTMLImageElement>("img");
	if (
		currency === null ||
		currencyImage === null ||
		currencyImage === undefined
	)
		throw new Error(
			"Inventory footer did not load its independent currency graphic.",
		);
	const currencyStyle = currency.style.cssText;
	const currencyFontSize = getComputedStyle(currency).fontSize;
	try {
		// Exercise inherited theme sizing with relative units, independent of the default.
		currency.style.setProperty("--ui-inventory-pyreal-icon-size", "2em");
		const currencySize = currencyImage.getBoundingClientRect();
		const expectedSize = 2 * Number.parseFloat(currencyFontSize);
		if (
			Math.abs(currencySize.width - expectedSize) > 0.1 ||
			Math.abs(currencySize.height - expectedSize) > 0.1
		)
			throw new Error("Currency graphic did not follow its theme size.");
		if (getComputedStyle(currency).fontSize !== currencyFontSize)
			throw new Error("Currency icon sizing changed the footer font size.");
		// Reverse the defaults to prove each theme override is selected independently.
		currency.style.setProperty(
			"--ui-inventory-pyreal-icon-upsample-filter",
			"auto",
		);
		currency.style.setProperty(
			"--ui-inventory-pyreal-icon-downsample-filter",
			"pixelated",
		);
		for (const [scale, filter] of [
			[0.5, "pixelated"],
			[1, "auto"],
			[2, "auto"],
		] as const) {
			currency.style.setProperty(
				"--ui-inventory-pyreal-icon-size",
				`${currencyImage.naturalWidth * scale}px`,
			);
			if (getComputedStyle(currencyImage).imageRendering !== filter)
				throw new Error(
					`Currency sampling filter did not follow its theme at scale ${scale}.`,
				);
		}
	} finally {
		currency.style.cssText = currencyStyle;
	}
	if (currency.textContent?.includes("Pyreals:"))
		throw new Error("Loaded currency artwork retained the visible text label.");
	const currencyUrl = currencyImage.src;
	button("Sort inventory: Native (slot index)").click();
	await sample();
	if (firstMainItem() !== "21")
		throw new Error("Alphabetical sort did not reorder the section.");
	button("Sort inventory: Alphabetical").click();
	await sample();
	if (firstMainItem() !== "22")
		throw new Error("Item type sort did not group the section.");
	button("Sort inventory: Item type").click();
	await sample();
	if (firstMainItem() !== "20")
		throw new Error("Native sort did not restore server slot order.");
	if (!cell(1).textContent?.replace(/\s+/g, " ").includes("Main Pack (9 / 24)"))
		throw new Error(
			"Main Pack did not display ordinary item usage and capacity.",
		);
	cell(1).click();
	if (selection.selectedGuid() !== 1)
		throw new Error("Main Pack did not select the local player.");
	selection.select(7);
	const strip = document.querySelector<HTMLElement>(
		".inventory-pack-strip .item-grid-strip-viewport",
	);
	if (strip === null) throw new Error("Inventory container strip is missing.");
	const stripRoot = strip.closest<HTMLElement>(".item-grid-strip");
	if (stripRoot === null) throw new Error("Inventory strip root is missing.");
	const checkStripSpacing = () => {
		const bounds = stripRoot.getBoundingClientRect();
		const viewport = strip.getBoundingClientRect();
		const style = getComputedStyle(stripRoot);
		if (
			Math.abs(
				viewport.top - bounds.top - Number.parseFloat(style.paddingTop),
			) > 1 ||
			Math.abs(
				bounds.bottom -
					viewport.bottom -
					Number.parseFloat(style.paddingBottom),
			) > 1
		)
			throw new Error(
				"Strip end spacing must remain outside the scroll viewport.",
			);
	};
	checkStripSpacing();
	const footer = document.querySelector<HTMLElement>(".inventory-bottom-bar");
	if (
		footer === null ||
		Math.abs(
			stripRoot.getBoundingClientRect().bottom -
				footer.getBoundingClientRect().bottom,
		) > 1
	)
		throw new Error("Pack strip did not span the contents pane and footer.");
	const stripCells = [
		...strip.querySelectorAll<HTMLButtonElement>(".item-grid-cell"),
	];
	if (
		stripCells.length !== 8 ||
		stripCells.filter((cell) => !cell.hasAttribute("data-item-guid")).length !==
			5
	)
		throw new Error(
			"Container strip did not preserve Main Pack, two occupants, and five free slots.",
		);
	if (
		strip.scrollWidth > strip.clientWidth ||
		stripCells.some((cell) => {
			const rect = cell.getBoundingClientRect();
			return Math.abs(rect.width - rect.height) > 1;
		})
	)
		throw new Error(
			"Container strip cells must be square without horizontal overflow.",
		);
	const contents = document.querySelector<HTMLElement>(".inventory-sections");
	const bagSection = document.querySelector<HTMLElement>(
		'[data-container-guid="30"]',
	);
	if (contents === null || bagSection === null)
		throw new Error("Inventory contents sections are missing.");
	if (contents.querySelector('[data-item-guid="31"]') !== null)
		throw new Error("A focus was duplicated in the inventory contents.");
	if (stripCells[2]?.getAttribute("data-item-guid") !== "31")
		throw new Error(
			"The focus did not sort after the container in the pack strip.",
		);
	const bagTarget = Math.min(
		contents.scrollHeight - contents.clientHeight,
		contents.scrollTop +
			bagSection.getBoundingClientRect().top -
			contents.getBoundingClientRect().top -
			contents.clientTop -
			Number.parseFloat(getComputedStyle(contents).paddingTop),
	);
	stripCells[1]?.click();
	if (Math.abs(contents.scrollTop - bagTarget) > 1)
		throw new Error(
			"Pack selection did not scroll to its clamped section position.",
		);

	if (selection.selectedGuid() !== 30)
		throw new Error("Container strip did not select the bag.");
	stripCells[0]?.click();
	if (contents.scrollTop !== 0 || strip.scrollTop !== 0)
		throw new Error(
			"Main Pack selection did not return contents to the top independently.",
		);
	if (selection.selectedGuid() !== 1)
		throw new Error("Container strip did not select the player.");
	await tick();
	const selectedPackSurfaces = [cell(1), stripCells[0]];
	const themeRoot = document.documentElement;
	const previousOutline = themeRoot.style.getPropertyValue(
		"--ui-item-selection-outline",
	);
	const previousShadow = themeRoot.style.getPropertyValue(
		"--ui-item-selection-shadow",
	);
	try {
		themeRoot.style.setProperty("--ui-item-selection-outline", "none");
		themeRoot.style.setProperty(
			"--ui-item-selection-shadow",
			"inset 0 0 9px gold",
		);
		for (const surface of selectedPackSurfaces) {
			if (surface === undefined)
				throw new Error("Selected pack surface is missing.");
			const style = getComputedStyle(surface);
			if (style.outlineStyle !== "none" || style.boxShadow === "none")
				throw new Error("Selection styling did not apply the configured glow.");
		}
		// CSS-wide initial invalidates the optional token and exercises the base recipe fallback.
		themeRoot.style.setProperty("--ui-item-selection-outline", "initial");
		themeRoot.style.setProperty("--ui-item-selection-shadow", "initial");
		for (const surface of selectedPackSurfaces) {
			if (surface === undefined)
				throw new Error("Selected pack surface is missing.");
			const style = getComputedStyle(surface);
			if (style.outlineStyle !== "solid" || style.boxShadow !== "none")
				throw new Error(
					"Base item selection recipe did not restore the outline.",
				);
		}
	} finally {
		if (previousOutline)
			themeRoot.style.setProperty(
				"--ui-item-selection-outline",
				previousOutline,
			);
		else themeRoot.style.removeProperty("--ui-item-selection-outline");
		if (previousShadow)
			themeRoot.style.setProperty("--ui-item-selection-shadow", previousShadow);
		else themeRoot.style.removeProperty("--ui-item-selection-shadow");
	}

	if (strip.scrollHeight <= strip.clientHeight)
		throw new Error("Container strip did not overflow independently.");
	if (getComputedStyle(strip).scrollbarWidth !== "none")
		throw new Error("Pack strip exposes a scrollbar.");
	const viewportBottom = strip.getBoundingClientRect().bottom;
	const nextDown = stripCells.find(
		(cell) => cell.getBoundingClientRect().bottom > viewportBottom + 1,
	);
	if (nextDown === undefined)
		throw new Error("Pack strip has no next clipped cell.");
	const packArrow = (direction: "up" | "down") => {
		const arrow = document.querySelector<HTMLButtonElement>(
			`.inventory-pack-strip button[aria-label="Scroll items ${direction}"]`,
		);
		if (arrow === null)
			throw new Error(`Pack strip ${direction} arrow missing`);
		return arrow;
	};
	packArrow("down").click();
	if (Math.abs(nextDown.getBoundingClientRect().bottom - viewportBottom) > 1)
		throw new Error("Down arrow did not align the next cell bottom.");
	await tick();
	const viewportTop = strip.getBoundingClientRect().top;
	const nextUp = [...stripCells]
		.reverse()
		.find((cell) => cell.getBoundingClientRect().top < viewportTop - 1);
	if (nextUp === undefined)
		throw new Error("Pack strip has no preceding clipped cell.");
	packArrow("up").click();
	if (Math.abs(nextUp.getBoundingClientRect().top - viewportTop) > 1)
		throw new Error("Up arrow did not align the next cell top.");
	strip.scrollTop = strip.scrollHeight;
	if (strip.scrollTop === 0) throw new Error("Container strip cannot scroll.");
	checkStripSpacing();
	strip.scrollTop = 0;
	selection.select(7);
	const initial = squares();
	if (!cell(32).disabled)
		throw new Error("Pending description acquired inventory selection.");
	const placement = windowRect();
	const inputBefore = options.readViewportInput();
	const globalKeys: string[] = [];
	const receiveKey = (event: KeyboardEvent) => globalKeys.push(event.key);
	window.addEventListener("keydown", receiveKey);
	try {
		cell(20).focus();
		for (const type of ["pointerdown", "pointerup"])
			cell(20).dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					pointerId: 42,
					button: 0,
				}),
			);
		cell(20).dispatchEvent(
			new WheelEvent("wheel", { bubbles: true, deltaY: 100 }),
		);
		cell(20).dispatchEvent(
			new KeyboardEvent("keydown", { bubbles: true, key: "w", code: "KeyW" }),
		);
		cell(20).dispatchEvent(
			new KeyboardEvent("keyup", { bubbles: true, key: "w", code: "KeyW" }),
		);
		if (
			globalKeys.join() !== "w" ||
			JSON.stringify(options.readViewportInput()) !==
				JSON.stringify(inputBefore)
		)
			throw new Error(
				"Inventory should preserve keyboard routing and contain pointer gestures.",
			);
	} finally {
		window.removeEventListener("keydown", receiveKey);
	}
	button("Debug").click();
	await tick();
	const samplesAtUnmount = options.readSampleCount();
	await sample();
	if (options.readSampleCount() <= samplesAtUnmount)
		throw new Error(
			"Hidden inventory stopped maintaining its persistent state.",
		);
	if (document.querySelector(".client-inventory") !== null)
		throw new Error("Switching to Debug did not unmount Inventory.");
	button("Inventory").click();
	await sample();
	// Switching panels must restore this panel's independently retained geometry.
	if (JSON.stringify(windowRect()) !== JSON.stringify(placement))
		throw new Error("Panel round trip did not preserve inventory placement.");

	const samplesBeforeBurst = options.readSampleCount();
	for (let index = 0; index < 20; index++) update(owned(20, 1, 0));
	await tick();
	if (options.readSampleCount() !== samplesBeforeBurst)
		throw new Error(
			"Host publication restarted or synchronously sampled the inventory consumer.",
		);
	const commandStart = commands.length;
	cell(20).click();
	cell(21).click();
	await sample();
	if (
		selection.selectedGuid() !== 21 ||
		commands
			.slice(commandStart)
			.filter((entry) => entry.command === "query_client_entity_health")
			.length !== 1
	)
		throw new Error("Inventory selection queried health for non-creatures.");
	if (!button("Interact").disabled)
		throw new Error("Owned inventory enabled Interact.");
	button("Debug").click();
	await sample();
	const inventoryDetails = document.querySelector(
		'section[aria-label="Selected entity details"]',
	);
	const inventoryJson =
		inventoryDetails?.querySelector<HTMLTextAreaElement>("textarea")?.value;
	if (
		!inventoryDetails?.textContent?.includes("Apple") ||
		!inventoryDetails.textContent.includes("Container") ||
		!inventoryDetails.textContent.includes("123 (0x0000007b)") ||
		!inventoryDetails.textContent.includes("Object flags") ||
		!inventoryDetails.textContent.includes("Weenie type (catalog)") ||
		!inventoryDetails.textContent.includes("Food") ||
		inventoryJson === undefined ||
		!inventoryJson.includes('"ownedByPlayer": true') ||
		!inventoryJson.includes('"presentation": null')
	)
		throw new Error(
			"Debug panel did not inspect the selected inventory identity without a scene record.",
		);
	button("Inventory").click();
	await sample();

	update({
		...owned(21, 30, 1),
		description: {
			kind: "known",
			name: "Renamed item with a very long placeholder name",
			healthQuery: "ineligible",
			itemType: 0,
			objectFlags: 0,
			wcid: null,
			weenieType: null,
			pyrealBalance: null,
			burden: null,
			equipLocations: null,
			stackCount: null,
			structure: { current: null, max: null },
			icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
		},
	});
	await sample();
	if (
		!cell(21).closest('section[aria-label="Inventory item 30"]') ||
		cell(21).getAttribute("aria-pressed") !== "true" ||
		!document
			.querySelector(".selected-entity")
			?.textContent?.includes("Renamed")
	)
		throw new Error(
			"Container move or rename failed to update the mounted selection and HUD.",
		);
	squares();
	update(owned(32, 30, 0));
	await sample();
	if (cell(32).disabled)
		throw new Error("Hydration did not enable the pending cell.");

	const resize = async (width: number) => {
		const rect = windowRect();
		const handle = document.querySelector(".hud-window-resize-left");
		if (handle === null) throw new Error("Panel resize handle is missing.");
		handle.dispatchEvent(
			new PointerEvent("pointerdown", {
				pointerId: 50,
				bubbles: true,
				button: 0,
				clientX: rect.left,
				clientY: rect.top + 40,
			}),
		);
		window.dispatchEvent(
			new PointerEvent("pointermove", {
				pointerId: 50,
				clientX: rect.left - (width - rect.width),
				clientY: rect.top + 40,
			}),
		);
		window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 50 }));
		await sample();
		return windowRect();
	};
	const wide = {
		window: await resize(CLIENT_UI_DEFAULTS.inventory.minSize.width + 200),
		...squares(),
	};
	const narrow = {
		window: await resize(CLIENT_UI_DEFAULTS.inventory.minSize.width / 2),
		...squares(),
	};
	if (narrow.window.width < CLIENT_UI_DEFAULTS.inventory.minSize.width)
		throw new Error("Inventory window resized below its minimum width.");
	const footerPlayer = records.find((record) => record.guid === 1);
	if (footerPlayer?.description.kind !== "known")
		throw new Error("Footer overflow probe requires a known player.");
	update({
		...footerPlayer,
		description: {
			...footerPlayer.description,
			pyrealBalance: 0xffff_ffff,
			burden: 3,
		},
	});
	await sample();
	const minimumWidthFooter = document.querySelector<HTMLElement>(
		".inventory-bottom-bar",
	);
	if (minimumWidthFooter === null)
		throw new Error("Inventory footer is missing after reopening.");
	const footerBounds = minimumWidthFooter.getBoundingClientRect();
	if (
		Array.from(minimumWidthFooter.children).some(
			(child) => child.getBoundingClientRect().right > footerBounds.right,
		)
	)
		throw new Error(
			"Inventory footer contents overflow at minimum window width.",
		);
	update(footerPlayer);
	await sample();
	if (wide.columns <= narrow.columns)
		throw new Error(
			`Inventory grid did not flow with window width: ${JSON.stringify({ wide, narrow })}`,
		);

	const savedInventory = windowRect();
	button("Debug").click();
	await sample();
	const resizedDebug = await resize(
		CLIENT_UI_DEFAULTS.debug.minSize.width + 200,
	);
	const titlebar = document.querySelector(".hud-window-titlebar");
	if (titlebar === null) throw new Error("Diagnostics titlebar missing.");
	const start = titlebar.getBoundingClientRect();
	titlebar.dispatchEvent(
		new PointerEvent("pointerdown", {
			pointerId: 51,
			bubbles: true,
			button: 0,
			clientX: start.left + 20,
			clientY: start.top + 10,
		}),
	);
	window.dispatchEvent(
		new PointerEvent("pointermove", {
			pointerId: 51,
			clientX: start.left - 40,
			clientY: start.top - 30,
		}),
	);
	window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 51 }));
	await sample();
	const savedDebug = windowRect();
	if (
		savedDebug.left === resizedDebug.left &&
		savedDebug.top === resizedDebug.top
	)
		throw new Error("Diagnostics drag did not move the panel.");
	button("Inventory").click();
	await sample();
	if (JSON.stringify(windowRect()) !== JSON.stringify(savedInventory))
		throw new Error("Editing Diagnostics changed Inventory geometry.");
	button("Debug").click();
	await sample();
	if (JSON.stringify(windowRect()) !== JSON.stringify(savedDebug))
		throw new Error("Diagnostics did not retain its own geometry.");
	button("Debug").click();
	await sample();
	button("Debug").click();
	await sample();
	if (JSON.stringify(windowRect()) !== JSON.stringify(savedDebug))
		throw new Error("Closing Diagnostics discarded its geometry.");
	button("Inventory").click();
	await sample();

	emit("client-state-resyncing", null);
	await sample();
	if (!cell(21).disabled || selection.selectedGuid() !== 21)
		throw new Error(
			"Recovery admitted stale inventory or discarded selection.",
		);
	update(owned(21, 1, 1));
	await sample();
	if (!cell(21).closest('section[aria-label="Inventory item 30"]'))
		throw new Error("Recovery applied a delta before its replacement.");
	baseline();
	await sample();
	if (cell(21).disabled || !cell(21).closest('section[aria-label="Main Pack"]'))
		throw new Error("Recovery did not install current container membership.");

	records = records.filter((record) => record.guid !== 21);
	emit("client-entity-facts-changed", { upserts: [], removed: [21] });
	await sample();
	if (
		selection.selectedGuid() !== null ||
		document.querySelector('[data-item-guid="21"]') !== null
	)
		throw new Error("Semantic removal left a selected inventory item.");
	button("Close Inventory").click();
	update({
		...owned(20, 1, 0),
		description: {
			kind: "known",
			name: "Updated while closed",
			healthQuery: "ineligible",
			itemType: 0,
			objectFlags: 0,
			wcid: null,
			weenieType: null,
			pyrealBalance: null,
			burden: null,
			equipLocations: null,
			stackCount: null,
			structure: { current: null, max: null },
			icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
		},
	});
	button("Inventory").click();
	await sample();
	if (!cell(20).getAttribute("aria-label")?.includes("Updated while closed"))
		throw new Error("Reopening inventory reused stale display.");
	cell(20).click();
	await sample();
	const appearance = (guid: number, base: number) => {
		const record = records.find((record) => record.guid === guid);
		if (record === undefined || record.description.kind !== "known")
			throw new Error(
				"Known inventory fixture required for appearance update.",
			);
		update({
			...record,
			description: {
				...record.description,
				itemType: 0,
				icon: { base, overlay: null, underlay: null, uiEffects: 0 },
			},
		});
	};
	const quantity = (guid: number, stackCount: number | null) => {
		const record = records.find((record) => record.guid === guid);
		if (record === undefined || record.description.kind !== "known")
			throw new Error("Known quantity fixture required.");
		update({ ...record, description: { ...record.description, stackCount } });
	};
	const badge = (guid: number) =>
		cell(guid).querySelector<HTMLElement>(".item-grid-cell-count");
	const artwork = (guid: number) => {
		const image = cell(guid).querySelector("img");
		if (
			image === null ||
			!image.complete ||
			image.naturalWidth !== 32 ||
			image.naturalHeight !== 32
		)
			throw new Error(`Item ${guid} has no decoded native-size artwork.`);
		return image;
	};
	const revokeObjectURL = URL.revokeObjectURL;
	const retiredUrls: string[] = [];
	let retiredWhileDisplayed = false;
	URL.revokeObjectURL = (url) => {
		retiredUrls.push(url);
		if (
			[...document.querySelectorAll("img")].some((image) => image.src === url)
		)
			retiredWhileDisplayed = true;
		revokeObjectURL.call(URL, url);
	};
	try {
		button("Close Inventory").click();
		const beforeHidden = options.readPreparedIconCount();
		appearance(20, 0x06000001);
		appearance(22, 0x06000001);
		await sample();
		if (options.readPreparedIconCount() !== beforeHidden + 1)
			throw new Error(
				"Hidden duplicate icons did not share a single preparation.",
			);
		button("Inventory").click();
		await sample();
		const sharedUrl = artwork(20).src;
		if (artwork(22).src !== sharedUrl)
			throw new Error(
				"Duplicate cells did not share their retained image URL.",
			);
		const beforeCounts = options.readPreparedIconCount();
		quantity(20, 2);
		quantity(22, 20_100);
		quantity(31, 2000);
		quantity(1, 99); // Main Pack is a role, never a stack badge for the player.
		await sample();
		if (
			badge(20)?.textContent?.trim() !== "2" ||
			badge(22)?.textContent?.trim() !== "20K" ||
			document.querySelector('[data-item-guid="1"] .item-grid-cell-count') !==
				null
		)
			throw new Error(
				"Stack quantities did not remain entity-specific or leaked onto Main Pack.",
			);
		if (
			!cell(20).getAttribute("aria-label")?.includes("quantity: 2") ||
			!cell(22).title.includes("20,100")
		)
			throw new Error(
				"Stack quantity is missing from accessible labels/tooltips.",
			);
		const packBadges = [
			...document.querySelectorAll(
				'[data-item-guid="31"] .item-grid-cell-count',
			),
		];
		if (
			packBadges.length !== 1 ||
			packBadges.some((element) => element.textContent?.trim() !== "2K")
		)
			throw new Error(
				"Pack-slot quantity was missing, duplicated, or formatted incorrectly.",
			);
		const countElement = badge(22);
		if (countElement === null) throw new Error("Count element missing.");
		const suffix = countElement.querySelector<HTMLElement>(
			".item-grid-cell-count-suffix",
		);
		if (suffix === null) throw new Error("Compact count suffix missing.");
		const originalCountStyle = countElement.style.cssText;
		try {
			countElement.style.setProperty("--ui-item-count-suffix-font-size", "50%");
			if (
				getComputedStyle(suffix).display !== "inline" ||
				Number.parseFloat(getComputedStyle(suffix).fontSize) !==
					Number.parseFloat(getComputedStyle(countElement).fontSize) * 0.5
			)
				throw new Error(
					"Compact suffix did not use the configured font scale.",
				);
		} finally {
			countElement.style.cssText = originalCountStyle;
		}
		const countRect = countElement.getBoundingClientRect();
		const itemRect = cell(22).getBoundingClientRect();
		if (
			countRect.right > itemRect.right ||
			countRect.bottom > itemRect.bottom ||
			getComputedStyle(countElement).pointerEvents !== "none"
		)
			throw new Error("Count overlay escaped its cell or intercepted input.");
		cell(22).click();
		await sample();
		const selectedHeading = () =>
			document.querySelector(".selected-entity__heading strong");
		if (selectedHeading()?.textContent !== "Inventory item 22 (20,100)")
			throw new Error("Selected stack name omitted its grouped quantity.");
		quantity(22, 1);
		await sample();
		if (selectedHeading()?.textContent !== "Inventory item 22")
			throw new Error("Selected stack name retained its previous quantity.");
		quantity(22, 20_100);
		const setStructure = (structure: ItemStructure) => {
			const record = records.find((record) => record.guid === 22);
			if (record === undefined || record.description.kind !== "known")
				throw new Error("Known structure fixture required.");
			update({ ...record, description: { ...record.description, structure } });
		};
		for (const current of [40, 10, 0]) {
			setStructure({ current, max: 50 });
			await sample();
			const label = `[${current}/50]`;
			if (
				cell(22).title !== `Inventory item 22 (quantity: 20,100) ${label}` ||
				selectedHeading()?.textContent !== `Inventory item 22 (20,100) ${label}`
			)
				throw new Error("Structure values did not reach both item labels.");
			const track = cell(22).querySelector<HTMLElement>(
				".item-grid-cell-structure",
			);
			const fill = cell(22).querySelector<HTMLElement>(
				".item-grid-cell-structure-fill",
			);
			if (track === null || fill === null)
				throw new Error("Structure bar missing.");
			const trackRect = track.getBoundingClientRect();
			const fillRect = fill.getBoundingClientRect();
			const box = cell(22).getBoundingClientRect();
			const count = badge(22);
			if (
				count === null ||
				count.getBoundingClientRect().right > trackRect.left
			)
				throw new Error(
					"Stack count is missing or overlaps the structure bar.",
				);
			if (
				Math.abs(fillRect.height - (trackRect.height * current) / 50) > 1 ||
				Math.abs(fillRect.bottom - trackRect.bottom) > 1 ||
				trackRect.right > box.right ||
				trackRect.left < box.left + box.width / 2 ||
				getComputedStyle(track).pointerEvents !== "none"
			)
				throw new Error(
					"Structure bar geometry or input ownership is incorrect.",
				);
			const color = getComputedStyle(fill)
				.backgroundColor.match(/\d+/g)
				?.map(Number);
			if (
				color === undefined ||
				color[0] === undefined ||
				color[1] === undefined
			)
				throw new Error("Structure fill has no RGB color.");
			if (
				(current === 40 && color[1] <= color[0]) ||
				(current === 10 && color[0] <= color[1])
			)
				throw new Error("Structure fill did not shift from green toward red.");
		}
		for (const structure of [
			{ current: 50, max: 50 },
			{ current: null, max: 50 },
			{ current: 20, max: null },
		]) {
			setStructure(structure);
			await sample();
			if (
				cell(22).querySelector(".item-grid-cell-structure") !== null ||
				cell(22).title !== "Inventory item 22 (quantity: 20,100)" ||
				selectedHeading()?.textContent !== "Inventory item 22 (20,100)"
			)
				throw new Error("Full or incomplete structure retained its indicator.");
		}
		quantity(20, 1);
		await sample();
		if (badge(20) !== null) throw new Error("A count of one retained a badge.");
		button("Close Inventory").click();
		quantity(20, 7);
		await sample();
		button("Inventory").click();
		await sample();
		if (
			badge(20)?.textContent !== "7" ||
			artwork(20).src !== sharedUrl ||
			artwork(22).src !== sharedUrl ||
			options.readPreparedIconCount() !== beforeCounts
		)
			throw new Error(
				"Hidden count updates changed artwork ownership or failed to refresh.",
			);
		selection.select(null);
		cell(20).click();
		if (selection.selectedGuid() !== 20)
			throw new Error("Count decoration blocked selection.");
		const release = options.holdIconPreparation();
		try {
			appearance(20, 0x06000002);
			await sample();
			if (
				cell(20).querySelector(".item-icon-fallback") === null ||
				cell(20).disabled
			)
				throw new Error(
					"Loading artwork did not leave a usable named fallback.",
				);
			button("Close Inventory").click();
			await sample();
			const whileHeld = options.readPreparedIconCount();
			button("Inventory").click();
			await sample();
			if (options.readPreparedIconCount() !== whileHeld)
				throw new Error(
					"Reopening during preparation duplicated retained work.",
				);
		} finally {
			release();
		}
		await sample();
		if (artwork(20).src === sharedUrl || artwork(22).src !== sharedUrl)
			throw new Error(
				"Late artwork completion did not replace only its current consumer.",
			);
		options.failIcon(0x06000003);
		appearance(20, 0x06000003);
		await sample();
		const afterFailure = options.readPreparedIconCount();
		if (
			badge(20)?.textContent !== "7" ||
			!cell(20)
				.querySelector(".item-icon-fallback")
				?.getAttribute("title")
				?.includes("quantity: 7")
		)
			throw new Error(
				"Missing-art fallback lost its count or count-bearing diagnostic tooltip.",
			);
		if (
			!cell(20)
				.querySelector(".item-icon-fallback")
				?.getAttribute("title")
				?.includes("Injected missing HUD fixture image")
		)
			throw new Error(
				"Missing-art detail was absent from the fallback tooltip.",
			);
		if (
			cell(20).querySelector(".item-icon-fallback") === null ||
			cell(20).disabled
		)
			throw new Error("Missing artwork blocked its named fallback.");
		selection.select(null);
		cell(20).click();
		if (selection.selectedGuid() !== 20)
			throw new Error("Missing artwork prevented inventory selection.");
		await sample();
		if (options.readPreparedIconCount() !== afterFailure)
			throw new Error("A retained missing image retried on the next sample.");
		artwork(22);
		if (
			document.querySelector<HTMLImageElement>(".inventory-currency img")
				?.src !== currencyUrl
		)
			throw new Error(
				"Panel reopening did not reuse retained currency artwork.",
			);
		if (retiredUrls.length === 0 || retiredWhileDisplayed)
			throw new Error(
				"Icon URLs were not retired strictly after their DOM consumers released them.",
			);
	} finally {
		URL.revokeObjectURL = revokeObjectURL;
	}
	// Isolate a complete currency roster after the grid and icon-lifetime scenarios.
	const root = records.find((record) => record.guid === 1);
	if (root === undefined) throw new Error("Missing inventory root");
	const [currencyWcid, currencyName] = INVENTORY_CURRENCIES[0];
	const currencyRecord = owned(90, 1, 0);
	if (currencyRecord.description.kind !== "known")
		throw new Error("Expected known currency fixture");
	records = [
		root,
		{
			...currencyRecord,
			description: {
				...currencyRecord.description,
				wcid: currencyWcid,
				stackCount: 1234,
			},
		},
	];
	baseline();
	await sample();
	const summaryTrigger = document.querySelector<HTMLButtonElement>(
		".inventory-currency",
	);
	if (summaryTrigger === null) throw new Error("Currency trigger missing");
	summaryTrigger.dispatchEvent(new PointerEvent("pointerenter"));
	await tick();
	const summary = document.querySelector<HTMLElement>(
		".inventory-currency-overlay",
	);
	if (
		summary === null ||
		!summary.matches(":popover-open") ||
		!summary.textContent?.includes(currencyName) ||
		!summary.textContent.includes("1,234") ||
		summary.querySelector("img") === null
	)
		throw new Error(
			`Currency overlay did not render the carried balance and graphic: ${summary?.outerHTML}`,
		);
	records = [root];
	baseline();
	await sample();
	if (!summary.textContent?.includes("No alternate currencies carried."))
		throw new Error("Currency overlay retained a removed balance");
	window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
	summaryTrigger.blur();
	// Equipment references one identity in several independently labeled rows.
	const armor = owned(91, 1, 0);
	const armorSlots = EQUIPMENT_SLOTS.filter((slot) =>
		["Chest armor", "Upper arm armor"].includes(slot.label),
	);
	const armorMask = armorSlots.reduce((mask, slot) => mask | slot.mask, 0);
	records = [
		root,
		{
			...armor,
			location: { kind: "equipped", wearerGuid: 1, mask: armorMask },
		},
		// Shirt and pants can share the abdomen bit without competing for a slot.
		{
			...owned(92, 1, 0),
			location: { kind: "equipped", wearerGuid: 1, mask: 0x1e },
		},
		{
			...owned(93, 1, 0),
			location: { kind: "equipped", wearerGuid: 1, mask: 0xc4 },
		},
	];
	baseline();
	await sample();
	const equipment = document.querySelector<HTMLElement>(
		".inventory-equipment-strip",
	);
	if (equipment === null) throw new Error("Equipment strip missing");
	for (const [label, guid] of [
		["Shirt", 92],
		["Pants", 93],
	] as const) {
		if (
			equipment.querySelector(
				`.item-grid-cell[data-item-guid="${guid}"][aria-label^="${label}:"]`,
			) === null
		)
			throw new Error(
				`Overlapping clothing masks did not resolve the ${label} slot`,
			);
	}
	const equipmentCells = () => [
		...equipment.querySelectorAll<HTMLButtonElement>(
			'.item-grid-cell[data-item-guid="91"]',
		),
	];
	const equippedCells = equipmentCells();
	if (
		equippedCells.length !== armorSlots.length ||
		equipment.querySelectorAll(".equipment-row").length !==
			EQUIPMENT_SLOTS.length
	)
		throw new Error(
			"Equipment strip did not preserve slots and repeat coverage",
		);
	if (
		document.querySelector('.inventory-sections [data-item-guid="91"]') !== null
	)
		throw new Error("Equipped item still occupies inventory contents");
	const equipmentUrls = equippedCells.map(
		(cell) => cell.querySelector("img")?.src,
	);
	if (!equipmentUrls[0] || new Set(equipmentUrls).size !== 1)
		throw new Error("Repeated equipment cells did not share artwork");
	equippedCells[0]?.click();
	await sample();
	if (
		equipmentCells().some(
			(cell) => cell.getAttribute("aria-pressed") !== "true",
		)
	)
		throw new Error("Equipment selection did not follow the shared identity");
	const equipmentViewport = equipment.querySelector<HTMLElement>(
		".item-grid-strip-viewport",
	);
	if (
		equipmentViewport === null ||
		equipmentViewport.scrollWidth > equipmentViewport.clientWidth ||
		equipmentViewport.scrollHeight <= equipmentViewport.clientHeight
	)
		throw new Error(
			"Equipment strip must scroll vertically without horizontal overflow",
		);
	const down = equipment.querySelector<HTMLButtonElement>(
		'[aria-label="Scroll items down"]',
	);
	if (down === null) throw new Error("Equipment scroll arrow missing");
	down.click();
	if (equipmentViewport.scrollTop === 0)
		throw new Error("Equipment rows did not scroll");
	records = [root, armor];
	baseline();
	await sample();
	if (
		equipmentCells().length !== 0 ||
		document.querySelector('.inventory-sections [data-item-guid="91"]') === null
	)
		throw new Error("Unequipped item did not move back into contents");
	records = [
		root,
		{ ...armor, location: { kind: "equipped", wearerGuid: 1, mask: null } },
	];
	baseline();
	await sample();
	if (
		equipment.querySelector('.equipment-strip[aria-busy="true"]') === null ||
		equipment.querySelector('[aria-label$=": Empty"]') !== null
	)
		throw new Error("Unknown equipment locations were represented as empty");
	// Hover compatibility remains separate from selection and follows sampled facts.
	if (armor.description.kind !== "known")
		throw new Error("Known armor fixture required");
	const compatibleArmor = {
		...armor,
		description: { ...armor.description, equipLocations: armorMask },
	};
	records = [root, compatibleArmor, owned(94, 1, 1)];
	baseline();
	await sample();
	const row = equipment.querySelector<HTMLElement>(
		`[data-equipment-slot="${armorSlots[0]?.mask}"]`,
	);
	if (row === null) throw new Error("Armor hover row missing");
	const dimmed = () =>
		[
			...document.querySelectorAll<HTMLElement>(
				'.inventory-sections .item-grid-cell[data-dimmed="true"]',
			),
		].map((cell) => cell.dataset.itemGuid);
	const selectedBeforeHover = selection.selectedGuid();
	row.dispatchEvent(new PointerEvent("pointerenter"));
	await tick();
	if (dimmed().join() !== "94")
		throw new Error(
			"Row hover did not dim only the incompatible inventory item",
		);
	if (selection.selectedGuid() !== selectedBeforeHover)
		throw new Error("Row hover changed selection");
	row.dispatchEvent(new PointerEvent("pointerleave"));
	await tick();
	if (dimmed().length !== 0)
		throw new Error("Equipment hover dimming did not clear");
	row.dispatchEvent(new PointerEvent("pointerenter"));
	records = [root, armor];
	baseline();
	await sample();
	if (dimmed().join() !== String(armor.guid))
		throw new Error(
			"Hover retained outdated compatibility after inventory update",
		);
	row.dispatchEvent(new PointerEvent("pointerleave"));
	// Leave stable contents and multi-row equipment for the CDP-driven drag probe.
	const splitStack = owned(94, 1, 1);
	if (splitStack.description.kind !== "known")
		throw new Error("Known split fixture required");
	records = [
		root,
		compatibleArmor,
		{
			...splitStack,
			description: { ...splitStack.description, stackCount: 20 },
		},
		{
			...compatibleArmor,
			guid: 95,
			location: { kind: "equipped", wearerGuid: 1, mask: armorMask },
		},
	];
	baseline();
	await sample();
	return {
		equipmentHover: true,
		equipmentStrip: true,
		ambientCurrencyOverlay: true,
		initial,
		wide,
		narrow,
		recovered: true,
		selectionRemoved: true,
		reopenedCurrent: true,
		pointerContainedKeyboardPreserved: true,
		persistentMaintenanceWhileHidden: true,
		sharedDecodedArtwork: true,
		retirementAfterDomCommit: true,
		closeDuringPreparation: true,
		missingArtworkSelectable: true,
		stackCountsWithoutRepreparation: true,
		producerBurstDidNotRestartConsumer: true,
	};
}

import { tick } from "svelte";
import type { ClientEntityFacts } from "../../client/client-entity-mirror";
import type { ClientEntitySelection } from "../../client/client-entity-selection";
import { CLIENT_TUNING } from "../../client/client-tuning";

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
			stackCount: null,
			icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
		},
		location: { kind: "none" },
		ownedByPlayer: false,
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
			throw new Error("Inventory and Debug must share exactly one window.");
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
				stackCount: null,
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
				stackCount: null,
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
					index: 0,
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
				slot: { kind: "pack" as const, index: 1, entryKind: "foci" as const },
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
			stackCount: null,
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
			stackCount: null,
			icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
		},
	});
	baseline();
	selection.select(7);
	if (button("Inventory").getAttribute("aria-pressed") !== "true")
		button("Inventory").click();
	await sample();
	const firstMainItem = () =>
		document
			.querySelector(
				'[data-container-guid="1"] .inventory-grid .item-grid-cell',
			)
			?.getAttribute("data-item-guid");
	if (
		!document
			.querySelector('[aria-label="Total pyreals"]')
			?.textContent?.includes("12,345")
	)
		throw new Error("Inventory footer did not show the server coin total.");
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
		".item-grid-strip-viewport",
	);
	if (strip === null) throw new Error("Inventory container strip is missing.");
	const footer = document.querySelector<HTMLElement>(".inventory-bottom-bar");
	if (
		footer === null ||
		Math.abs(
			strip.getBoundingClientRect().bottom -
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
	const bagTarget = Math.min(
		contents.scrollHeight - contents.clientHeight,
		contents.scrollTop +
			bagSection.getBoundingClientRect().top -
			contents.getBoundingClientRect().top -
			contents.clientTop -
			Number.parseFloat(getComputedStyle(contents).paddingTop),
	);
	stripCells[1]?.click();
	if (Math.abs(contents.scrollTop - bagTarget) > 1 || contents.scrollTop === 0)
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
	for (const surface of selectedPackSurfaces) {
		if (surface === undefined)
			throw new Error("Selected pack surface is missing.");
		const style = getComputedStyle(surface);
		if (style.outlineStyle !== "none" || style.boxShadow === "none")
			throw new Error(
				"Standard theme did not replace pack selection outlines with a glow.",
			);
	}
	const themeRoot = document.documentElement;
	const previousOutline = themeRoot.style.getPropertyValue(
		"--ui-item-selection-outline",
	);
	const previousShadow = themeRoot.style.getPropertyValue(
		"--ui-item-selection-shadow",
	);
	try {
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
	button("Scroll items down").click();
	if (Math.abs(nextDown.getBoundingClientRect().bottom - viewportBottom) > 1)
		throw new Error("Down arrow did not align the next cell bottom.");
	await tick();
	const viewportTop = strip.getBoundingClientRect().top;
	const nextUp = [...stripCells]
		.reverse()
		.find((cell) => cell.getBoundingClientRect().top < viewportTop - 1);
	if (nextUp === undefined)
		throw new Error("Pack strip has no preceding clipped cell.");
	button("Scroll items up").click();
	if (Math.abs(nextUp.getBoundingClientRect().top - viewportTop) > 1)
		throw new Error("Up arrow did not align the next cell top.");
	strip.scrollTop = strip.scrollHeight;
	if (strip.scrollTop === 0) throw new Error("Container strip cannot scroll.");
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
			globalKeys.length !== 0 ||
			JSON.stringify(options.readViewportInput()) !==
				JSON.stringify(inputBefore)
		)
			throw new Error("Inventory control input reached the viewport.");
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
	if (
		document.querySelector(".client-inventory") !== null ||
		JSON.stringify(windowRect()) !== JSON.stringify(placement)
	)
		throw new Error("Panel switch did not preserve the shared placement.");
	button("Inventory").click();
	await sample();

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
			stackCount: null,
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
		if (handle === null)
			throw new Error("Shared window resize handle is missing.");
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
		return {
			...squares(),
			window: windowRect(),
			viewportWidth: window.innerWidth,
		};
	};
	const wide = await resize(600);
	const narrow = await resize(280);
	if (wide.columns <= narrow.columns)
		throw new Error(
			`Inventory grid did not flow with window width: ${JSON.stringify({ wide, narrow })}`,
		);

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
			stackCount: null,
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
		quantity(22, 2000);
		quantity(31, 2000);
		quantity(1, 99); // Main Pack is a role, never a stack badge for the player.
		await sample();
		if (
			badge(20)?.textContent !== "2" ||
			badge(22)?.textContent !== "2.0K" ||
			document.querySelector('[data-item-guid="1"] .item-grid-cell-count') !==
				null
		)
			throw new Error(
				"Stack quantities did not remain entity-specific or leaked onto Main Pack.",
			);
		if (
			!cell(20).getAttribute("aria-label")?.includes("quantity: 2") ||
			!cell(22).title.includes("2000")
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
			packBadges.length !== 2 ||
			packBadges.some((element) => element.textContent !== "2.0K")
		)
			throw new Error(
				"Pack-slot quantity did not match its contents-grid quantity.",
			);
		const countElement = badge(22);
		if (countElement === null) throw new Error("Count element missing.");
		const countRect = countElement.getBoundingClientRect();
		const itemRect = cell(22).getBoundingClientRect();
		if (
			countRect.right > itemRect.right ||
			countRect.bottom > itemRect.bottom ||
			getComputedStyle(countElement).pointerEvents !== "none"
		)
			throw new Error("Count overlay escaped its cell or intercepted input.");
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
		cell(20).click();
		if (selection.selectedGuid() !== 20)
			throw new Error("Missing artwork prevented inventory selection.");
		await sample();
		if (options.readPreparedIconCount() !== afterFailure)
			throw new Error("A retained missing image retried on the next sample.");
		artwork(22);
		if (retiredUrls.length === 0 || retiredWhileDisplayed)
			throw new Error(
				"Icon URLs were not retired strictly after their DOM consumers released them.",
			);
	} finally {
		URL.revokeObjectURL = revokeObjectURL;
	}
	return {
		initial,
		wide,
		narrow,
		recovered: true,
		selectionRemoved: true,
		reopenedCurrent: true,
		inputIsolated: true,
		persistentMaintenanceWhileHidden: true,
		sharedDecodedArtwork: true,
		retirementAfterDomCommit: true,
		closeDuringPreparation: true,
		missingArtworkSelectable: true,
		stackCountsWithoutRepreparation: true,
		producerBurstDidNotRestartConsumer: true,
	};
}

import { tick } from "svelte";
import { inventoryPreviewRequestSchema } from "../../client/client-inventory-contract";
import type { ClientInventoryPreviewResult } from "../../client/client-inventory-contract";
import type { ClientEntityFacts } from "../../client/client-entity-mirror";
import { entityFacts } from "../../client/client-entity-mirror.test-support";
import type { ClientEntitySelection } from "../../client/client-entity-selection";
import type { ClientItemInteractions } from "../../client/client-item-interactions";
import { CLIENT_TUNING } from "../../client/client-tuning";

/** Real session, production popup and DOM gestures with synthetic authoritative records. */
export async function probeWorldContainer(options: {
	readonly emit: (event: string, payload: unknown) => void;
	readonly selection: ClientEntitySelection;
	readonly interactions: ClientItemInteractions;
	readonly commands: readonly {
		readonly command: string;
		readonly args: Record<string, unknown> | undefined;
	}[];
}) {
	const { emit, commands, selection, interactions } = options;
	const start = commands.length;
	const sample = async () => {
		await tick();
		await new Promise((resolve) =>
			window.setTimeout(
				resolve,
				Math.max(
					CLIENT_TUNING.worldContainer.displayIntervalMs,
					CLIENT_TUNING.inventory.displayIntervalMs,
				) * 2,
			),
		);
	};
	const element = <T extends HTMLElement>(selector: string): T => {
		const found = document.querySelector<T>(selector);
		if (found === null)
			throw new Error(`Container fixture missing ${selector}`);
		return found;
	};
	const require = (condition: boolean, message: string) => {
		if (!condition) throw new Error(message);
	};
	const named = (
		guid: number,
		name: string,
		overrides: Partial<ClientEntityFacts> = {},
	): ClientEntityFacts => {
		const record = entityFacts(guid, overrides);
		if (record.description.kind !== "known")
			throw new Error("Named fixture requires known description.");
		return {
			...record,
			description: {
				...record.description,
				name,
				icon: { ...record.description.icon, base: 0x06001000 + guid },
			},
		};
	};
	const root = named(100, "Iron Chest", {
		storage: {
			kind: "container",
			roster: "announced",
			itemCapacity: 48,
			packCapacity: 12,
		},
	});
	const packs = Array.from({ length: 12 }, (_, index) =>
		named(
			101 + index,
			index === 0 ? "Adventurer's Pack" : `Pack ${index + 1}`,
			{
				canPickUp: true,
				worldContainerContent: true,
				location: {
					kind: "contained",
					parentGuid: 100,
					slot: { kind: "pack", index, entryKind: "container" },
				},
				storage: {
					kind: "container",
					roster: index === 1 ? "awaiting" : "announced",
					itemCapacity: 24,
					packCapacity: 0,
				},
			},
		),
	);
	const loot = named(200, "Moonstone", {
		canPickUp: true,
		worldContainerContent: true,
		location: {
			kind: "contained",
			parentGuid: 101,
			slot: { kind: "item", index: 0 },
		},
	});
	const pending = entityFacts(201, {
		description: { kind: "pending" },
		worldContainerContent: true,
		location: {
			kind: "contained",
			parentGuid: 101,
			slot: { kind: "item", index: 1 },
		},
	});
	const loose = Array.from({ length: 30 }, (_, index) =>
		named(210 + index, `Chest treasure ${index + 1}`, {
			canPickUp: true,
			worldContainerContent: true,
			location: {
				kind: "contained",
				parentGuid: 100,
				slot: { kind: "item", index },
			},
		}),
	);
	const wand = named(300, "Targeting tool", {
		ownedByPlayer: true,
		location: {
			kind: "contained",
			parentGuid: 1,
			slot: { kind: "item", index: 0 },
		},
	});
	if (wand.description.kind !== "known")
		throw new Error("Known targeting fixture.");
	const tool = {
		...wand,
		description: { ...wand.description, useCapability: "targeted" as const },
	};
	const baseline = (
		externalRoot: ClientEntityFacts,
		records: readonly ClientEntityFacts[],
	) =>
		emit("client-current-state", {
			lifecycle: { kind: "in-world" },
			entityCollisionDisabled: false,
			localPlayerGuid: 1,
			serverTime: 10,
			worldGeneration: 1,
			worldName: "Fixture",
			playerName: "Wayfarer",
			knownSpells: null,
			appearanceOptions: { showHelmet: true, showCloak: true },
			combatMode: "peace",
			combat: { desired: null, state: "idle", refill: null },
			vitals: [],
			characterMotion: null,
			activeConfirmation: null,
			dynamic: { hostTime: { seconds: 10 }, entities: [] },
			entities: {
				projectileSupply: { kind: "not-applicable" },
				worldContainer: { kind: "open", root: externalRoot.guid },
				entities: [
					entityFacts(1, {
						storage: {
							kind: "container",
							roster: "announced",
							itemCapacity: 24,
							packCapacity: 7,
						},
					}),
					tool,
					named(301, "Carried pack", {
						ownedByPlayer: true,
						location: {
							kind: "contained",
							parentGuid: 1,
							slot: { kind: "pack", index: 0, entryKind: "container" },
						},
						storage: {
							kind: "container",
							roster: "announced",
							itemCapacity: 24,
							packCapacity: 0,
						},
					}),
					externalRoot,
					...records,
				],
			},
		});
	const populated = () => baseline(root, [...packs, loot, pending, ...loose]);
	const pickups = () =>
		commands
			.slice(start)
			.filter((command) => command.command === "submit_client_inventory");
	// Observe animation frames, not just the settled DOM: no default-size flash is allowed.
	const openingSizes: {
		count: number;
		columns: number;
		width: number;
		height: number;
	}[] = [];
	const openingGrid = CLIENT_TUNING.worldContainer.openingGrid;
	const sizingCounts = [
		0,
		openingGrid.minColumns,
		openingGrid.minColumns + 1,
		openingGrid.minColumns * openingGrid.maxRows,
		openingGrid.maxColumns * openingGrid.maxRows,
		openingGrid.maxColumns * openingGrid.maxRows + 1,
	];
	for (const [index, count] of sizingCounts.entries()) {
		const guid = 500 + index;
		const sizingRoot = named(guid, "Sizing chest", {
			storage: {
				kind: "container",
				roster: "announced",
				itemCapacity: count + 1,
				packCapacity: 0,
			},
		});
		const records = Array.from({ length: count }, (_, slot) =>
			named(1000 + slot, `Sizing item ${slot}`, {
				canPickUp: true,
				worldContainerContent: true,
				location: {
					kind: "contained",
					parentGuid: guid,
					slot: { kind: "item", index: slot },
				},
			}),
		);
		const firstVisible: { width: number; height: number }[] = [];
		let observing = true;
		const observe = () => {
			if (!observing) return;
			const section = document.querySelector<HTMLElement>(
				`.world-container-panel [data-container-guid="${guid}"]`,
			);
			const window = section?.closest<HTMLElement>(".hud-window");
			if (
				window !== null &&
				window !== undefined &&
				getComputedStyle(window).visibility === "visible"
			) {
				if (firstVisible.length === 0) {
					const box = window.getBoundingClientRect();
					firstVisible.push({ width: box.width, height: box.height });
				}
			}
			requestAnimationFrame(observe);
		};
		requestAnimationFrame(observe);
		baseline(sizingRoot, records);
		await sample();
		observing = false;
		const window = element<HTMLElement>(
			'.hud-window[aria-label="Sizing chest"]',
		);
		const box = window.getBoundingClientRect();
		const grid = element<HTMLElement>(
			`.world-container-panel [data-container-guid="${guid}"] .contents-grid`,
		);
		const columns =
			getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length;
		const expected =
			count > openingGrid.minColumns * openingGrid.maxRows
				? openingGrid.maxColumns
				: openingGrid.minColumns;
		require(columns ===
			expected, `Opening ${count} items produced ${columns} columns, expected ${expected}`);
		require(firstVisible[0]?.width === box.width &&
			firstVisible[0]?.height ===
				box.height, "Container resized after its first visible frame");
		const scroll = element<HTMLElement>(
			".world-container-panel .contents-scroll",
		);
		if (count > openingGrid.maxColumns * openingGrid.maxRows)
			require(scroll.scrollHeight >
				scroll.clientHeight, "Large container did not scroll at its opening cap");
		else
			require(scroll.scrollHeight <=
				scroll.clientHeight +
					1, `Opening ${count} items clipped its fitted contents`);
		openingSizes.push({ count, columns, width: box.width, height: box.height });
		// Later hydration/content changes must not replace this opening's chosen geometry.
		emit("client-entity-facts-changed", {
			projectileSupply: null,
			worldContainer: null,
			upserts: [
				named(1900, "Later arrival", {
					canPickUp: true,
					worldContainerContent: true,
					location: {
						kind: "contained",
						parentGuid: guid,
						slot: { kind: "item", index: count },
					},
				}),
			],
			removed: [],
		});
		await sample();
		const after = window.getBoundingClientRect();
		require(after.width === box.width &&
			after.height === box.height, "Contents update resized an open container");
	}
	populated();
	await sample();
	require(element<HTMLButtonElement>(
		'.world-container-panel .contents-scroll [data-item-guid="201"]',
	).disabled, "Pending container item became interactive");
	const strip = element<HTMLElement>(
		".world-container-panel .contents-packs .item-grid-strip-viewport",
	);
	require(strip.scrollWidth >
		strip.clientWidth, "Horizontal container strip did not overflow");
	element<HTMLButtonElement>(
		'.world-container-panel .contents-packs button[aria-label="Scroll items right"]',
	).click();
	await sample();
	require(strip.scrollLeft > 0, "Horizontal strip arrow did not scroll");
	const packButton = element<HTMLButtonElement>(
		'.world-container-panel .contents-packs [data-item-guid="101"]',
	);
	packButton.click();
	packButton.dispatchEvent(
		new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
	);
	await sample();
	require(element<HTMLElement>(".world-container-panel .contents-scroll")
		.scrollTop > 0, "Pack navigation did not scroll to its section");
	require(pickups().length === 0, "Pack navigation picked up a pack");
	const lootButton = element<HTMLButtonElement>(
		'.world-container-panel .contents-scroll [data-item-guid="200"]',
	);
	lootButton.click();
	require(selection.selectedGuid() ===
		200, "External cell did not select accepted contents");
	lootButton.dispatchEvent(
		new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
	);
	await sample();
	require(pickups().length ===
		1, "Container double click did not submit one pickup");
	require(element<HTMLElement>(
		'.world-container-panel .contents-scroll [data-item-guid="200"]',
	) !== null, "Pickup optimistically removed contents");
	element<HTMLButtonElement>(
		'.world-container-panel .contents-scroll [data-container-guid="101"] h3 button:last-child',
	).click();
	await sample();
	require(pickups().length === 2, "Explicit Take pack did not submit pickup");
	interactions.use(300, false);
	require(interactions.snapshot().kind ===
		"acquiring", "Target fixture failed to acquire");
	lootButton.click();
	lootButton.dispatchEvent(
		new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
	);
	await sample();
	require(pickups().length === 2, "Target acquisition leaked a pickup");
	require(commands
		.slice(start)
		.some(
			(command) => command.command === "submit_client_item_use",
		), "Contents click did not submit acquired target");
	interactions.cancel();
	const panel = element<HTMLElement>(
		".world-container-panel",
	).closest<HTMLElement>(".hud-window");
	if (panel === null) throw new Error("Missing container window");
	const before = panel.getBoundingClientRect();
	const commandCount = commands.length;
	const gesture = async (
		handle: HTMLElement,
		x: number,
		y: number,
		dx: number,
		dy: number,
	) => {
		handle.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				button: 0,
				buttons: 1,
				pointerId: 77,
				isPrimary: true,
				clientX: x,
				clientY: y,
			}),
		);
		window.dispatchEvent(
			new PointerEvent("pointermove", {
				pointerId: 77,
				clientX: x + dx,
				clientY: y + dy,
			}),
		);
		window.dispatchEvent(
			new PointerEvent("pointerup", {
				pointerId: 77,
				clientX: x + dx,
				clientY: y + dy,
			}),
		);
		await sample();
	};
	await gesture(
		element<HTMLElement>(
			'.hud-window[aria-label="Iron Chest"] .hud-window-titlebar',
		),
		before.left + 30,
		before.top + 12,
		24,
		18,
	);
	const moved = panel.getBoundingClientRect();
	require(moved.left !== before.left ||
		moved.top !== before.top, "Container window did not move");
	await gesture(
		element<HTMLElement>(
			'.hud-window[aria-label="Iron Chest"] .hud-window-resize-bottom-right',
		),
		moved.right,
		moved.bottom,
		56,
		42,
	);
	const resized = panel.getBoundingClientRect();
	require(resized.width > moved.width &&
		resized.height > moved.height, "Container window did not resize");
	require(commands.length ===
		commandCount, "Window layout sent a network command");

	// Use real DOM hit testing and the production drag/session path; only core replies are synthetic.
	const inventoryButton = element<HTMLButtonElement>(
		'button[aria-label="Inventory"]',
	);
	if (inventoryButton.getAttribute("aria-pressed") !== "true")
		inventoryButton.click();
	await sample();
	const panelBounds = panel.getBoundingClientRect();
	await gesture(
		element<HTMLElement>(
			'.hud-window[aria-label="Iron Chest"] .hud-window-titlebar',
		),
		panelBounds.left + 25,
		panelBounds.top + 12,
		12 - panelBounds.left,
		80 - panelBounds.top,
	);
	const external = ".world-container-panel";
	const owned = ".client-inventory";
	const packCell = (scope: string, guid: number) =>
		`${scope} .contents-packs [data-item-guid="${guid}"]`;
	const itemCell = (scope: string, guid: number) =>
		`${scope} .contents-scroll .item-grid-cell[data-item-guid="${guid}"]`;
	const lastPreview = () => {
		const command = commands
			.slice(start)
			.filter((entry) => entry.command === "preview_client_inventory")
			.at(-1);
		return inventoryPreviewRequestSchema.parse(command?.args?.request);
	};
	const reply = (
		sequence: number,
		preview: ClientInventoryPreviewResult["preview"],
	) => emit("client-inventory-preview", { sequence, preview });
	const point = (selector: string) => {
		const cell = element<HTMLElement>(selector);
		cell.scrollIntoView({ block: "nearest", inline: "nearest" });
		const box = cell.getBoundingClientRect();
		const x = box.left + box.width / 2;
		const y = box.top + box.height / 2;
		require(cell.contains(
			document.elementFromPoint(x, y),
		), `Transfer target obscured: ${selector}`);
		return { cell, x, y };
	};
	const pointer = (
		type: string,
		x: number,
		y: number,
		target: EventTarget = window,
	) =>
		target.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				button: 0,
				buttons: type === "pointerup" ? 0 : 1,
				pointerId: 88,
				isPrimary: true,
				clientX: x,
				clientY: y,
			}),
		);
	const begin = (
		source: string,
		target: string | (() => ReturnType<typeof point>),
	) => {
		const from = point(source);
		pointer("pointerdown", from.x, from.y, from.cell);
		const to = typeof target === "string" ? point(target) : target();
		pointer("pointermove", to.x, to.y);
		require(document.querySelector('[data-item-dragging="true"]') !==
			null, "Contents drag did not begin");
		return to;
	};
	const release = (to: { x: number; y: number }) => {
		pointer("pointerup", to.x, to.y);
		return lastPreview();
	};
	const transfer = async (
		source: string,
		target: Parameters<typeof begin>[1],
		kind: string,
		guid: number,
		preview: ClientInventoryPreviewResult["preview"] = { kind: "move" },
	) => {
		const count = pickups().length;
		const request = release(begin(source, target));
		require(request.intent.target.kind === kind &&
			"guid" in request.intent.target &&
			request.intent.target.guid ===
				guid, `Wrong transfer target: ${JSON.stringify(request)}`);
		reply(request.sequence, preview);
		await sample();
		require(pickups().length ===
			count + 1, "Accepted transfer was not submitted once");
		require(document.querySelector(source) !==
			null, "Transfer optimistically removed its source");
	};
	// Sample actual non-item hit regions rather than sending events to an obscured element.
	const background =
		(scope: string, guid: number, region: "grid-gap" | "tail") => () => {
			const section = element<HTMLElement>(
				`${scope} .contents-scroll [data-container-guid="${guid}"]`,
			);
			section.scrollIntoView({ block: "nearest" });
			let x: number;
			let y: number;
			if (region === "grid-gap") {
				const cell = section.querySelector<HTMLElement>(
					".contents-grid .item-grid-cell",
				);
				if (cell === null || cell.parentElement === null)
					throw new Error("Background fixture requires an occupied grid");
				cell.scrollIntoView({ block: "nearest" });
				const box = cell.getBoundingClientRect();
				x =
					box.right +
					Number.parseFloat(getComputedStyle(cell.parentElement).columnGap) / 2;
				y = box.top + box.height / 2;
			} else {
				const box = section.getBoundingClientRect();
				x = box.right - 2;
				y = box.bottom - 2;
			}
			const hit = document.elementFromPoint(x, y);
			require(hit !== null &&
				section.contains(hit) &&
				hit.closest(".item-grid-cell") ===
					null, `Expected section background at ${guid}/${region}`);
			return { cell: section, x, y };
		};
	const sort = async (scope: string, label: string) => {
		const button = element<HTMLButtonElement>(`${scope} .contents-sort`);
		for (
			let i = 0;
			i < 3 && !button.getAttribute("aria-label")?.includes(label);
			i++
		) {
			button.click();
			await sample();
		}
		require(button.getAttribute("aria-label")?.includes(label) ===
			true, `Cannot set ${scope} sort to ${label}`);
	};
	await sort(owned, "Native");
	await sort(external, "Native");
	await transfer(
		itemCell(owned, 300),
		packCell(external, 101),
		"container",
		101,
	);
	await transfer(
		itemCell(external, 200),
		packCell(owned, 301),
		"container",
		301,
	);
	await transfer(itemCell(external, 210), itemCell(external, 211), "item", 211);
	await transfer(packCell(external, 101), packCell(owned, 1), "container", 1);
	await transfer(
		packCell(owned, 301),
		packCell(external, 100),
		"container",
		100,
	);
	await transfer(
		itemCell(external, 200),
		`${owned} [data-container-guid="301"] p`,
		"container",
		301,
	);
	await transfer(
		itemCell(owned, 300),
		`${external} [data-container-guid="103"] p`,
		"container",
		103,
	);
	await transfer(
		itemCell(external, 200),
		background(owned, 301, "tail"),
		"container",
		301,
	);
	await transfer(
		itemCell(owned, 300),
		background(external, 100, "grid-gap"),
		"container",
		100,
	);
	await transfer(
		itemCell(external, 200),
		background(owned, 1, "grid-gap"),
		"container",
		1,
	);
	// Source sorting is irrelevant to the destination's positional policy.
	await sort(external, "Alphabetical");
	await transfer(itemCell(external, 200), itemCell(owned, 300), "item", 300);
	await transfer(itemCell(owned, 300), itemCell(external, 200), "stack", 200, {
		kind: "merge",
		amount: 1,
	});
	await transfer(
		itemCell(owned, 300),
		packCell(external, 101),
		"container",
		101,
	);
	await transfer(
		itemCell(owned, 300),
		background(external, 100, "grid-gap"),
		"container",
		100,
	);
	await sort(owned, "Alphabetical");
	await sort(external, "Native");
	await transfer(itemCell(owned, 300), itemCell(external, 210), "item", 210);
	// A sort change after release must retire an outstanding positional preview.
	let count = pickups().length;
	let request = release(begin(itemCell(owned, 300), itemCell(external, 210)));
	await sort(external, "Alphabetical");
	reply(request.sequence, { kind: "move" });
	await sample();
	require(pickups().length ===
		count, "Late positional preview survived destination sorting");
	// Pending records cannot start gestures.
	const loading = point(itemCell(external, 201));
	pointer("pointerdown", loading.x, loading.y, loading.cell);
	pointer("pointermove", loading.x + 40, loading.y);
	require(document.querySelector('[data-item-dragging="true"]') ===
		null, "Pending contents started a drag");
	pointer("pointerup", loading.x + 40, loading.y);
	// Refusal feedback uses the real session event; no membership is changed locally.
	await transfer(
		itemCell(owned, 300),
		packCell(external, 100),
		"container",
		100,
	);
	emit("client-action-feedback", {
		message: "You cannot put items in a corpse.",
		tone: "warning",
	});
	await sample();
	require(document
		.querySelector(".client-toast")
		?.textContent?.includes("cannot put items in a corpse") ===
		true, "Container refusal feedback missing");
	require(document.querySelector(itemCell(owned, 300)) !==
		null, "Refused deposit changed membership");
	// Access withdrawal cancels a released request before its preview returns.
	count = pickups().length;
	request = release(begin(itemCell(owned, 300), packCell(external, 100)));
	emit("client-entity-facts-changed", {
		projectileSupply: { kind: "not-applicable" },
		worldContainer: { kind: "closed" },
		upserts: [],
		removed: [],
	});
	reply(request.sequence, { kind: "move" });
	await sample();
	require(pickups().length ===
		count, "Closed destination accepted a late preview");
	populated();
	await sample();
	// An already submitted withdrawal may complete after closing; publication owns the move.
	await transfer(
		itemCell(external, 200),
		packCell(owned, 301),
		"container",
		301,
	);
	emit("client-entity-facts-changed", {
		projectileSupply: { kind: "not-applicable" },
		worldContainer: { kind: "closed" },
		upserts: [],
		removed: [],
	});
	emit("client-entity-facts-changed", {
		projectileSupply: null,
		worldContainer: null,
		upserts: [
			{
				...loot,
				ownedByPlayer: true,
				canPickUp: false,
				worldContainerContent: false,
				location: {
					kind: "contained",
					parentGuid: 301,
					slot: { kind: "item", index: 0 },
				},
			},
		],
		removed: [],
	});
	await sample();
	const arrived = element<HTMLButtonElement>(itemCell(owned, 200));
	require(arrived.getAttribute("aria-label")?.includes("Moonstone") === true &&
		!arrived.disabled, "Late authoritative withdrawal did not arrive as a known usable item");
	populated();
	await sample();
	// Recovery cancels a gesture while preserving the last disabled picture.
	count = pickups().length;
	request = release(begin(itemCell(external, 200), packCell(owned, 301)));

	emit("client-state-resyncing", null);
	await sample();
	require(element<HTMLElement>(".world-container-panel").getAttribute(
		"aria-busy",
	) === "true", "Recovery did not disable the retained popup");
	reply(request.sequence, { kind: "move" });
	require(pickups().length ===
		count, "Recovery accepted a stale transfer preview");
	populated();
	await sample();
	const switching = begin(itemCell(external, 200), packCell(owned, 301));
	const empty = named(400, "Empty Chest", {
		storage: {
			kind: "container",
			roster: "announced",
			itemCapacity: 8,
			packCapacity: 0,
		},
	});
	baseline(empty, []);
	pointer("pointerup", switching.x, switching.y);
	await sample();
	require(pickups().length ===
		count, "Root replacement committed an old gesture");
	require(element<HTMLElement>(
		".world-container-panel .contents-scroll",
	).textContent?.includes("Empty") === true, "Empty root was not shown");
	require(document.querySelector(
		'.world-container-panel .contents-scroll [data-item-guid="200"]',
	) === null, "Root replacement retained former contents");
	const close = element<HTMLButtonElement>(
		'button[aria-label="Close Empty Chest"]',
	);
	close.click();
	close.click();
	await sample();
	const closes = commands
		.slice(start)
		.filter((command) => command.command === "close_client_container");
	require(closes.length === 1 &&
		closes[0]?.args?.guid ===
			400, "Popup close did not target its root exactly once");
	emit("client-entity-facts-changed", {
		projectileSupply: { kind: "not-applicable" },
		worldContainer: { kind: "closed" },
		upserts: [],
		removed: [],
	});
	await sample();
	require(document.querySelector(".world-container-panel") ===
		null, "Closed access retained its popup");
	populated();
	await sample();
	return {
		openingSizes,
		sizedBeforeFirstFrame: true,
		contentsUpdatesPreserveSize: true,
		pendingDisabled: true,
		horizontalOverflow: true,
		navigationOnly: true,
		itemAndPackPickup: true,
		targetingPrecedence: true,
		moved: true,
		resized: true,
		bidirectionalTransfers: true,
		wholePackTransfers: true,
		sectionBackgroundAppend: true,
		emptyLabelAndTailAppend: true,
		externalReorder: true,
		destinationSortPolicy: true,
		stalePreviewCancelled: true,
		refusalFeedback: true,
		lateAuthoritativeWithdrawal: true,
		recovery: true,
		replacement: true,
		empty: true,
		closeOnce: true,
		commands: commands.slice(start),
	};
}

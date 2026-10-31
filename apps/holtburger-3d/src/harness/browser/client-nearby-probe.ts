import { UI_THEME_CHANGED_EVENT } from "../../app/ui-theme";
import corpseSvg from "../../assets/icons/minimap-own-corpse.svg?raw";
import type { RenderSceneInterestController } from "../../lib/game/runtime/render-scene-interest-controller";
import { nearbySceneInterest } from "../../client/client-nearby.test-support";
import { tick } from "svelte";
import type { ClientNearby } from "../../client/client-nearby";
import { CLIENT_NEARBY_TUNING } from "../../client/client-tuning";
import {
	nearbyFacts,
	nearbyPose,
} from "../../client/client-nearby.test-support";
import type { ClientChatLine } from "../../client/client-chat-policy";
import { cellId } from "../../lib/game/runtime/dynamic-entity-feed";
import type { MapWaypointTarget } from "../../lib/game/map/map-waypoint";

/** Production HUD, session delivery, selection, chat and real canvas; no visual acceptance. */
export async function probeClientNearby(dependencies: {
	/** Hide authored radar markers and return the current fixture character name. */
	readonly prepareMinimapLandmarks: () => string;
	readonly owner: ClientNearby;
	readonly scene: RenderSceneInterestController;
	readonly baseline: () => void;
	readonly emit: (event: string, payload: unknown) => void;
	readonly selected: () => number | null;
	readonly commands: () => readonly {
		command: string;
		args: Record<string, unknown> | undefined;
	}[];
	readonly messages: () => readonly ClientChatLine[];
	readonly waypoint: () => MapWaypointTarget | null;
	/** Exercise historical links through the mounted production chat and selection owners. */
	readonly select: (guid: number | null) => void;
	readonly retireChat: () => void;
	readonly notice: () => string | null;
}) {
	const { owner, emit } = dependencies;
	function require(condition: boolean, message: string): asserts condition {
		if (!condition) throw new Error(`Nearby probe: ${message}`);
	}
	const wait = (ms: number) =>
		new Promise<void>((resolve) => setTimeout(resolve, ms));
	const click = async (selector: string) => {
		const button = document.querySelector<HTMLElement>(selector);
		require(button !== null, `missing control ${selector}`);
		button.scrollIntoView({ block: "nearest", inline: "nearest" });
		const rectangle = button.getBoundingClientRect();
		require(button.contains(
			document.elementFromPoint(
				rectangle.x + rectangle.width / 2,
				rectangle.y + rectangle.height / 2,
			),
		), `control is not reachable by pointer: ${selector}`);
		button.click();
		await tick();
	};
	const settle = () =>
		wait(
			Math.max(
				CLIENT_NEARBY_TUNING.displayIntervalMs * 2,
				CLIENT_NEARBY_TUNING.notificationBatchMs +
					CLIENT_NEARBY_TUNING.displayIntervalMs,
			),
		);
	const input = (selector: string, value: string) => {
		const editor = document.querySelector<HTMLInputElement>(selector);
		require(editor !== null, `missing editor ${selector}`);
		editor.value = value;
		editor.dispatchEvent(new Event("input", { bubbles: true }));
	};
	const commandStart = dependencies.commands().length;
	const examineRequests = () =>
		dependencies
			.commands()
			.slice(commandStart)
			.filter(({ command }) => command === "examine_client_entity");
	dependencies.baseline();
	owner.changeRules(1, []);
	const npc = nearbyFacts(9, "Town Crier");
	require(npc.nearby !== null, "NPC fixture has public facts");
	const facts = [
		nearbyFacts(7, "Diamond Golem"),
		nearbyFacts(8, "Ice Golem"),
		{ ...npc, nearby: { ...npc.nearby, category: "npc" as const } },
	];
	emit("client-entity-facts-changed", {
		projectileSupply: null,
		salvage: null,
		worldContainer: null,
		upserts: facts,
		removed: [],
	});
	emit("client-dynamic-entity", {
		kind: "snapshot",
		snapshot: {
			hostTime: { seconds: 10 },
			entities: [
				nearbyPose(1, 0),
				nearbyPose(7, 5),
				nearbyPose(8, 10),
				nearbyPose(9, 15),
			].map((entity) =>
				entity.placement.kind === "world"
					? {
							...entity,
							placement: {
								...entity.placement,
								pose: {
									...entity.placement.pose,
									landblockId: cellId(0x0001_0001),
								},
							},
						}
					: entity,
			),
		},
	});
	const launcher = document.querySelector<HTMLButtonElement>(
		'[aria-label="Nearby entities and alerts"]',
	);
	const launcherIcon = launcher?.querySelector("svg");
	const lock = document.querySelector(".client-ui-lock");
	require(launcher !== null &&
		launcherIcon != null &&
		lock !== null, "launcher icon and HUD reference control exist");
	const launcherBox = launcher.getBoundingClientRect();
	const iconBox = launcherIcon.getBoundingClientRect();
	require(launcherBox.height <= lock.getBoundingClientRect().height &&
		iconBox.width <= launcherBox.height &&
		iconBox.height <=
			launcherBox.height, "launcher and icon fit the compact HUD control height");
	await click('[aria-label="Nearby entities and alerts"]');
	await settle();
	require(document.querySelectorAll("[data-entity-guid]").length ===
		3, "three independent roots displayed");
	const entityName = document.querySelector<HTMLElement>(".entity-name");
	require(entityName !== null &&
		getComputedStyle(entityName).borderStyle === "none" &&
		getComputedStyle(entityName).backgroundColor ===
			"rgba(0, 0, 0, 0)", "entity names use quiet catalog controls");
	input('[aria-label="Search entity names"]', "dmnd");
	await tick();
	require(document.querySelectorAll("[data-entity-guid]").length ===
		1, "fuzzy search filters names");
	await click('[data-entity-guid="7"] .entity-name');
	require(dependencies.selected() ===
		7, "row uses production selected identity");
	require(examineRequests().length === 0, "left click only selects its entity");
	input('[aria-label="Search entity names"]', "");
	await tick();
	const pickup = nearbyFacts(7, "Loose Gem");
	require(pickup.nearby !== null, "pickup fixture has public facts");
	const publishPickup = (canPickUp: boolean) =>
		emit("client-entity-facts-changed", {
			projectileSupply: null,
			salvage: null,
			worldContainer: null,
			upserts: [
				{
					...pickup,
					canPickUp,
					nearby: { ...pickup.nearby, category: "item" },
				},
			],
			removed: [],
		});
	publishPickup(true);
	await settle();
	await click(".entity-filters summary");
	const pickupFilter = '.ui-filter-pill[data-entity-category="pickup"]';
	const propsFilter = '.ui-filter-pill[data-entity-category="prop"]';
	require(document.querySelector(propsFilter)?.textContent?.trim() ===
		"Props (0)", "props exclude pickup-eligible items");
	await click(propsFilter);
	require(document.querySelectorAll("[data-entity-guid]").length ===
		0, "props filter excludes pickups");
	await click(propsFilter);
	require(document.querySelector(pickupFilter)?.textContent?.trim() ===
		"Pickups (1)", "pickup count uses world eligibility");
	await click(pickupFilter);
	require(document.querySelectorAll("[data-entity-guid]").length === 1 &&
		document.querySelector('[data-entity-guid="7"]') !==
			null, "pickup filter shows eligible entities without examination");
	require(document
		.querySelector('[data-entity-guid="7"] .category-icon')
		?.getAttribute("aria-label") ===
		"Pickups", "pickup row label agrees with its filter");
	publishPickup(false);
	await settle();
	require(document.querySelectorAll("[data-entity-guid]").length === 0 &&
		document.querySelector(pickupFilter)?.textContent?.trim() ===
			"Pickups (0)", "pickup rows and count follow eligibility changes");
	require(document.querySelector(propsFilter)?.textContent?.trim() ===
		"Props (1)", "ineligible items move into props");
	require(examineRequests().length ===
		0, "pickup filtering never examines entities");
	await click(pickupFilter);
	await click(propsFilter);
	require(document.querySelectorAll("[data-entity-guid]").length === 1 &&
		document.querySelector('[data-entity-guid="7"]') !==
			null, "props filter shows the item after pickup eligibility is withdrawn");
	require(document
		.querySelector('[data-entity-guid="7"] .category-icon')
		?.getAttribute("aria-label") ===
		"Props", "row label follows the transition from pickup to prop");
	await click(propsFilter);
	await click(".entity-filters summary");
	emit("client-entity-facts-changed", {
		projectileSupply: null,
		salvage: null,
		worldContainer: null,
		upserts: [
			{
				...pickup,
				canPickUp: false,
				nearby: { ...pickup.nearby, name: "Lever", category: "useable" },
			},
		],
		removed: [],
	});
	await settle();
	await click(".entity-filters summary");
	const useableFilter = '.ui-filter-pill[data-entity-category="useable"]';
	require(document.querySelector(useableFilter)?.textContent?.trim() ===
		"Useable (1)", "useable category has a live count");
	await click(useableFilter);
	require(document.querySelectorAll("[data-entity-guid]").length === 1 &&
		document.querySelector('[data-entity-guid="7"] .category-icon svg') !==
			null, "useable filter and category icon accept public-only lever facts");
	require(examineRequests().length ===
		0, "useable filtering never examines entities");
	await click(useableFilter);
	await click(".entity-filters summary");
	emit("client-entity-facts-changed", {
		projectileSupply: null,
		salvage: null,
		worldContainer: null,
		upserts: [facts[0]],
		removed: [],
	});
	await settle();
	const categoryIcon = document.querySelector(
		'[data-entity-guid="8"] .category-icon svg',
	);
	require(categoryIcon !==
		null, "second entity has a nested right-click target");
	const contextMenu = new MouseEvent("contextmenu", {
		button: 2,
		bubbles: true,
		cancelable: true,
	});
	categoryIcon.dispatchEvent(contextMenu);
	await tick();
	require(contextMenu.defaultPrevented, "entity row suppresses the native context menu");
	require(dependencies.selected() === 7 &&
		examineRequests().length === 1 &&
		examineRequests()[0].args?.guid ===
			8, "right click examines the clicked entity while preserving the previous selection");
	// The sampled row can outlive authoritative facts until the next display pull.
	const staleRow = document.querySelector('[data-entity-guid="9"]');
	require(staleRow !== null, "third entity is displayed before removal");
	emit("client-entity-facts-changed", {
		projectileSupply: null,
		salvage: null,
		worldContainer: null,
		upserts: [],
		removed: [9],
	});
	staleRow.dispatchEvent(
		new MouseEvent("contextmenu", {
			button: 2,
			bubbles: true,
			cancelable: true,
		}),
	);
	await tick();
	require(dependencies.selected() === 7 &&
		examineRequests().length ===
			1, "unavailable row neither changes selection nor examines the previous target");
	require(document
		.querySelector('.nearby-panel [role="alert"]')
		?.textContent?.includes("unavailable") ===
		true, "unavailable row reports the examination error");
	emit("client-entity-facts-changed", {
		projectileSupply: null,
		salvage: null,
		worldContainer: null,
		upserts: [facts[2]],
		removed: [],
	});
	input('[aria-label="Search entity names"]', "dmnd");
	await tick();
	await click('[data-entity-guid="7"] .entity-name');
	require(document.querySelector('.nearby-panel [role="alert"]') ===
		null, "successful selection clears the stale-row error");
	await click('[aria-label="Details for Diamond Golem"]');
	await click('[data-entity-guid="7"] button[title="Set waypoint"]');
	require(dependencies.waypoint() !==
		null, "public coordinates set the real navigation waypoint");
	require(document.querySelector('[data-entity-guid="7"] .entity-details') !==
		null, "separate disclosure opens details");
	const exactToggle =
		'[data-entity-guid="7"] [aria-label="Exact-name alert for Diamond Golem"]';
	const messagesBeforeRuleEdits = dependencies.messages().length;
	const exactPressed = () =>
		document.querySelector(exactToggle)?.getAttribute("aria-pressed") ===
		"true";
	require(!exactPressed(), "exact-name toggle starts off");
	await click(exactToggle);
	await settle();
	require(owner.rules()[0]?.match.mode ===
		"exact", "row action preserves literal names");
	require(owner.trackedGuids().has(7), "exact rule tracks existing entity");
	const exactId = owner.rules()[0]?.id;
	require(exactPressed(), "new exact-name rule presses the toggle");
	await click(exactToggle);
	require(!exactPressed() &&
		!owner.trackedGuids().has(7) &&
		owner.rules().length === 1 &&
		owner.rules()[0]?.enabled ===
			false, "toggle disables its existing exact rule");
	await click(exactToggle);
	require(exactPressed() &&
		owner.rules().length === 1 &&
		owner.rules()[0]?.id ===
			exactId, "toggle reuses the disabled rule identity");
	await click("#nearby-alerts-tab");
	await click('[aria-label="Add entity alert"]');
	require(document.activeElement ===
		document.querySelector(
			".alert-editor input",
		), "panel editor focuses the name field");
	document.activeElement?.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Tab",
			bubbles: true,
			cancelable: true,
		}),
	);
	require(document.activeElement ===
		document.querySelector(
			".alert-editor select",
		), "panel dialog includes match mode in its focus cycle");
	const matchMode = document.querySelector<HTMLSelectElement>(
		".alert-editor select",
	);
	require(matchMode?.value ===
		"substring", "new alerts default to substring matching");
	input(".alert-editor input", "golem");
	await tick();
	require(document
		.querySelector(".alert-editor")
		?.textContent?.includes("2 current matches") ===
		true, "substring draft matches names without wildcard syntax");
	require(matchMode !== null, "match mode editor exists");
	matchMode.value = "glob";
	matchMode.dispatchEvent(new Event("change", { bubbles: true }));
	input(".alert-editor input", "*Golem*");
	await tick();
	require(document
		.querySelector(".alert-editor")
		?.textContent?.replace(/\s+/g, " ")
		.includes("2 current matches") === true, "draft previews both matches");
	await click('.alert-editor button[type="submit"]');
	await settle();
	require(owner.trackedGuids().size ===
		2, "overlapping rules track two independent identities");
	require(document
		.querySelector(".alert-rules")
		?.textContent?.replace(/\s+/g, " ")
		.includes("2 current matches") === true, "saved rule shows match count");
	// Dismissal must discard drafts rather than mutate the saved rule.
	await click('[aria-label="Edit alert for *Golem*"]');
	input(".alert-editor input", "Discard me");
	await tick();
	document.activeElement?.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		}),
	);
	await tick();
	require(document.querySelector(".nearby-alert-dialog") === null &&
		owner
			.rules()
			.some(
				(rule) => rule.match.pattern === "*Golem*",
			), "Escape discards the editor draft");
	await click('[aria-label="Add entity alert"]');
	const backdrop = document.querySelector<HTMLElement>(".nearby-alert-overlay");
	require(backdrop !== null, "in-panel backdrop is mounted");
	backdrop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
	backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	await tick();
	require(document.querySelector(".nearby-alert-dialog") ===
		null, "backdrop cancels the editor");
	const savedGlobId = owner
		.rules()
		.find((rule) => rule.match.mode === "glob")?.id;
	await click('[aria-label="Edit alert for *Golem*"]');
	input(".alert-editor input", "Golem*");
	await tick();
	await click('.alert-editor button[type="submit"]');
	await settle();
	require(owner.trackedGuids().size === 1 &&
		owner.rules().find((rule) => rule.id === savedGlobId)?.match.pattern ===
			"Golem*", "modal saves edits to the same rule identity");
	await click('[aria-label="Edit alert for Golem*"]');
	input(".alert-editor input", "*Golem*");
	await tick();
	await click('.alert-editor button[type="submit"]');
	await settle();
	// An extra rule exercises the compact row's delete action without changing active tracking.
	await click('[aria-label="Add entity alert"]');
	input(".alert-editor input", "Nothing matches this");
	await tick();
	await click('.alert-editor button[type="submit"]');
	await click('[aria-label="Delete alert for Nothing matches this"]');
	require(owner.rules().length === 2, "icon delete removes only its rule");

	const canvas = document.querySelector<HTMLCanvasElement>(
		".minimap-overlay-canvas",
	);
	const context = canvas?.getContext("2d");
	require(context !== null &&
		context !== undefined, "actual map canvas is mounted");
	const fill = context.fill;
	const originalFill = context.fill.bind(context);
	const clear = context.clearRect;
	let alertFills = 0;
	let alertColor: string | null = null;
	const readAlertColor = () => alertColor;
	const alertFillCount = () => alertFills;
	context.clearRect = function (x, y, width, height) {
		alertFills = 0;
		clear.call(this, x, y, width, height);
	};
	context.fill = function (
		path?: Path2D | CanvasFillRule,
		rule?: CanvasFillRule,
	) {
		if (path instanceof Path2D) {
			alertFills++;
			alertColor = String(this.fillStyle);
			originalFill(path, rule);
		} else originalFill(path);
	};
	try {
		await settle();
		require(alertFillCount() ===
			2, "both tracked entities use the alert glyph in the same map frame");
		const baselineColor = readAlertColor();
		require(baselineColor !== null, "tracked canvas appearance is available");
		const minimapScope = document.querySelector<HTMLElement>(".minimap");
		require(minimapScope !== null, "minimap scope exists");
		const theme = document.createElement("style");
		theme.textContent = `@layer overrides {
			:root {
				--ui-color-success: rgb(17, 34, 51);
				--ui-minimap-alert-color: var(--ui-color-success);
				--ui-entity-category-icon-size: 24px;
				--ui-minimap-button-size: 24px;
				--ui-icon-stroke-width: 2.4;
				--ui-filter-pill-radius: 16px;
			}
			.ui-theme [data-entity-category="monster"] {
				color: rgb(171, 61, 91);
				--filter-color: rgb(171, 61, 91);
			}
		}`;
		document.head.append(theme);
		try {
			document.dispatchEvent(new Event(UI_THEME_CHANGED_EVENT));
			await settle();
			require(readAlertColor() ===
				"#112233", "theme color reaches the actual alert glyph canvas fill");
			const category = document.querySelector<HTMLElement>(
				'.category-icon[data-entity-category="monster"]',
			);
			const glyph = category?.querySelector("svg");
			const pill = document.querySelector<HTMLElement>(
				'.ui-pill[data-entity-category="monster"]',
			);
			const filter = document.querySelector<HTMLElement>(
				'.ui-filter-pill[data-entity-category="monster"]',
			);
			require(category != null &&
				glyph != null &&
				pill !== null &&
				filter !== null, "category hooks cover icon, label pill and filter");
			require(getComputedStyle(category).width === "24px" &&
				getComputedStyle(glyph).strokeWidth === "2.4px" &&
				getComputedStyle(glyph).stroke ===
					"rgb(171, 61, 91)", "category icon size, line weight and color accept theme overrides");
			require(getComputedStyle(pill).borderRadius === "16px" &&
				getComputedStyle(filter).borderColor === "rgb(171, 61, 91)" &&
				getComputedStyle(launcher).width ===
					"24px", "shared pill and rim control tokens accept theme overrides");
		} finally {
			theme.remove();
			document.dispatchEvent(new Event(UI_THEME_CHANGED_EVENT));
			await settle();
		}
		require(readAlertColor() ===
			baselineColor, "theme removal restores cached canvas appearance");

		const globToggle = '.alert-rules [aria-label="Alert for *Golem*"]';
		await click(globToggle);
		await settle();
		require(owner.trackedGuids().size ===
			1, "disabling a glob preserves the overlapping exact match");
		require(alertFillCount() ===
			1, "rule edits redraw tracking without entity motion");
		await click(globToggle);
		await settle();
		require(alertFillCount() ===
			2, "reactivating the rule restores both alert icons");
	} finally {
		context.fill = fill;
		context.clearRect = clear;
	}
	await click("#nearby-entities-tab");
	await click(exactToggle);
	require(!exactPressed() &&
		owner
			.trackedGuids()
			.has(7), "disabling the exact-name rule preserves glob tracking");
	const trackedMarker = document.querySelector(
		'[data-entity-guid="7"] [aria-label="Tracked"]',
	);
	require(trackedMarker?.getAttribute("title")?.includes("*Golem*") ===
		true, "tracked marker explains the remaining glob match");
	await click(exactToggle);
	await settle();
	require(dependencies.messages().length ===
		messagesBeforeRuleEdits, "adding, editing and toggling rules do not announce existing matches");
	await click('[aria-label="Close Nearby"]');
	const read = owner.read.bind(owner);
	let reads = 0;
	owner.read = () => {
		reads++;
		return read();
	};
	const before = dependencies.messages().length;
	try {
		emit("client-entity-facts-changed", {
			projectileSupply: null,
			salvage: null,
			worldContainer: null,
			upserts: [nearbyFacts(10, "Gold Golem")],
			removed: [],
		});
		emit("client-dynamic-entity", {
			kind: "upserted",
			entity: {
				...nearbyPose(10, 20),
				placement: {
					...nearbyPose(10, 20).placement,
					pose: {
						...nearbyPose(10, 20).placement.pose,
						landblockId: cellId(0x00010001),
					},
				},
			},
		});
		await settle();
		require(reads === 0, "closed retained window stops display sampling");
		require(dependencies.messages().length >
			before, "closed window continues chat detections");
	} finally {
		owner.read = read;
	}
	// Resolve one interior pose through production demand and exercise both location branches.
	const mixedRequest = nearbySceneInterest("0x0001ffff", "outdoor");
	dependencies.scene.replace({
		...mixedRequest,
		radii: { ...mixedRequest.radii, envCellRadius: 0 },
		ambientOutdoorEnvCellOwners: new Set(["0x0001ffff"]),
	});
	const interior = nearbyPose(7, 5);
	const moveTargetToCell = (landblockId: number) => {
		emit("client-dynamic-entity", {
			kind: "upserted",
			entity: {
				...interior,
				placement: {
					...interior.placement,
					pose: {
						...interior.placement.pose,
						landblockId: cellId(landblockId),
					},
				},
			},
		});
	};
	moveTargetToCell(0x00010100);
	const mixedLocation = owner
		.read()
		.rows.find((row) => row.guid === 7)?.location;
	require(mixedLocation !== undefined &&
		mixedLocation.waypoint !== null &&
		!mixedLocation.text.startsWith(
			"Cell",
		), "mixed-landblock interior exposes surface coordinates and waypoint");
	require(owner
		.trackedGuids()
		.has(7), "mixed-landblock interior retains map tracking");
	dependencies.scene.replace(nearbySceneInterest("0x0001ffff", "dungeon"));
	const dungeonLocation = owner
		.read()
		.rows.find((row) => row.guid === 7)?.location;
	require(dungeonLocation?.waypoint === null &&
		dungeonLocation.text.startsWith(
			"Cell 0x00010100",
		), "dungeon context preserves cell-local coordinates");
	dependencies.scene.replace(mixedRequest);
	moveTargetToCell(0x00010001);
	const beforeSceneReturn = dependencies.messages().length;
	dependencies.scene.replace(nearbySceneInterest("0x1234ffff", "dungeon"));
	require(owner.trackedGuids().size === 0 &&
		owner.read().rows.length ===
			0, "scene departure hides retained entities without mirror removals");
	await wait(
		CLIENT_NEARBY_TUNING.absenceGraceMs +
			CLIENT_NEARBY_TUNING.notificationBatchMs,
	);
	dependencies.scene.replace(nearbySceneInterest("0x0001ffff", "outdoor"));
	await settle();
	require(dependencies.messages().length > beforeSceneReturn &&
		owner.trackedGuids().size ===
			3, "scene return announces retained GUIDs while Nearby is closed");

	await click('[aria-label="Nearby entities and alerts"]');
	await click("#nearby-entities-tab");
	await settle();
	const search = document.querySelector<HTMLInputElement>(
		'[aria-label="Search entity names"]',
	);
	require(search?.value === "dmnd", "reopening retains the search draft");
	await click('[aria-label="Close Nearby"]');
	require(examineRequests().length ===
		1, "catalog updates do not submit additional examinations");
	// Alerts retain explicit IDs, and links only acquire pointer interaction with history enabled.
	require(document.querySelector('.entity-chat-tag[role="button"]') ===
		null, "click-through chat renders entity names as text");
	await click('[aria-label="Interact with chat history"]');
	const entityTag = (name: string) => {
		const tags = document.querySelectorAll<HTMLSpanElement>(
			`.chat-buffer [role="button"][aria-label="Select entity: ${name}"]`,
		);
		const tag = tags.item(tags.length - 1);
		require(tag !== null, `missing chat entity ${name}`);
		return tag;
	};
	const gold = entityTag("Gold Golem");
	dependencies.select(7);
	const range = document.createRange();
	range.selectNodeContents(gold);
	const textSelection = document.getSelection();
	require(textSelection !== null, "browser exposes text selection");
	textSelection.removeAllRanges();
	textSelection.addRange(range);
	gold.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
	require(dependencies.selected() ===
		7, "text selection does not acquire the entity");
	textSelection.removeAllRanges();
	await click('[aria-label="Select entity: Gold Golem"]');
	require(dependencies.selected() ===
		10, "chat selects the captured entity identity");
	require(examineRequests().length ===
		1, "chat entity selection does not examine the entity");

	emit("client-entity-facts-changed", {
		projectileSupply: null,
		salvage: null,
		worldContainer: null,
		upserts: [],
		removed: [10],
	});
	dependencies.select(7);
	gold.click();
	await tick();
	require(dependencies.selected() === 7 &&
		dependencies.notice() ===
			"This entity is currently outside selection range or unavailable.", "unavailable chat reference preserves selection and reports a toast");
	dependencies.select(8);
	dependencies.retireChat();
	await tick();
	await click('[aria-label="Interact with chat history"]');
	entityTag("Diamond Golem").click();
	await tick();
	require(dependencies.selected() === 8 &&
		dependencies.notice() ===
			"This entity link belongs to a previous character or session.", "old-generation chat reference cannot select a currently known entity");
	await click('[aria-label="Interact with chat history"]');
	require(document.querySelector('.entity-chat-tag[role="button"]') ===
		null, "ending history interaction restores click-through text");
	const playerName = dependencies.prepareMinimapLandmarks();
	owner.changeRules(1, []);
	emit("client-entity-facts-changed", {
		projectileSupply: null,
		salvage: null,
		worldContainer: null,
		removed: [],
		upserts: [
			{
				...nearbyFacts(7, "Lever"),
				nearby: { ...npc.nearby, name: "Lever", category: "useable" },
			},
			{
				...nearbyFacts(8, `Corpse of ${playerName}`),
				nearby: {
					...npc.nearby,
					name: `Corpse of ${playerName}`,
					category: "corpse",
				},
			},
		],
	});
	const stroke = context.stroke;
	const originalStroke = context.stroke.bind(context);
	const iconPaths = new Set<Path2D>();
	const filledIconPaths = new Set<Path2D>();
	const detailColor = new DOMParser()
		.parseFromString(corpseSvg, "image/svg+xml")
		.querySelector("path[fill]")
		?.getAttribute("fill");
	require(detailColor != null, "coffin asset supplies an explicit cross color");
	const detailPaths = new Set<Path2D>();
	let iconStrokes = 0;
	const iconStrokeCount = () => iconStrokes;
	context.clearRect = function (x, y, width, height) {
		iconPaths.clear();
		filledIconPaths.clear();
		detailPaths.clear();
		iconStrokes = 0;
		clear.call(this, x, y, width, height);
	};
	context.stroke = function (path?: Path2D) {
		if (path !== undefined) {
			iconPaths.add(path);
			iconStrokes++;
			originalStroke(path);
		} else originalStroke();
	};
	context.fill = function (
		path?: Path2D | CanvasFillRule,
		rule?: CanvasFillRule,
	) {
		if (path instanceof Path2D) {
			filledIconPaths.add(path);
			if (String(this.fillStyle) === detailColor) detailPaths.add(path);
			originalFill(path, rule);
		} else originalFill(path);
	};
	try {
		await settle();
		require(iconPaths.size === 2 &&
			filledIconPaths.size === 3 &&
			detailPaths.size === 1 &&
			[...iconPaths].every((path) => filledIconPaths.has(path)) &&
			iconStrokeCount() ===
				2, "radar-hidden useable and own corpse draw distinct filled SVG icons with dark halos");
		require(examineRequests().length ===
			1, "landmark admission does not request inspection");
	} finally {
		context.stroke = stroke;
		context.fill = fill;
		context.clearRect = clear;
	}
	return {
		passed: true,
		entities: facts.length,
		tracked: owner.trackedGuids().size,
		checks: [
			"useable-and-own-corpse-canvas-icons",
			"chat-entity-selection",
			"chat-entity-drag-protection",
			"chat-entity-unavailable-toast",
			"chat-entity-generation-guard",
			"chat-entity-click-through",
			"compact-launcher",
			"catalog-row-controls",
			"pointer-hit-testing",
			"search",
			"selection",
			"right-click-examine-preserves-selection",
			"stale-row-examination-rejected",
			"disclosure",
			"exact-rule",
			"exact-name-toggle",
			"independent-glob-tracking",
			"silent-rule-edits",
			"retained-scene-return",
			"glob-preview",
			"panel-alert-editor",
			"editor-cancellation",
			"icon-alert-actions",
			"multiple-matches",
			"uniform-alert-icon",
			"radar-hidden-alert-icon",
			"substring-default-preview",
			"mixed-interior-coordinates",
			"nearby-theme-overrides",
			"canvas-theme-refresh",
			"rule-toggle-invalidation",
			"coordinate-waypoint",
			"hidden-detection",
			"hidden-display-pause",
			"retained-draft",
		],
	};
}

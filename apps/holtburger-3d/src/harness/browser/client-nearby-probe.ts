import { UI_THEME_CHANGED_EVENT } from "../../app/ui-theme";
import { readMinimapTrackingAppearance } from "../../app/minimap-tracking-appearance";
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
	readonly owner: ClientNearby;
	readonly scene: RenderSceneInterestController;
	readonly baseline: () => void;
	readonly emit: (event: string, payload: unknown) => void;
	readonly selected: () => number | null;
	readonly commands: () => readonly { command: string }[];
	readonly messages: () => readonly ClientChatLine[];
	readonly waypoint: () => MapWaypointTarget | null;
}) {
	const { owner, emit } = dependencies;
	function require(condition: boolean, message: string): asserts condition {
		if (!condition) throw new Error(`Nearby probe: ${message}`);
	}
	const wait = (ms: number) =>
		new Promise<void>((resolve) => setTimeout(resolve, ms));
	const click = async (selector: string) => {
		const button = document.querySelector<HTMLButtonElement | HTMLInputElement>(
			selector,
		);
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
	const stroke = context.stroke;
	const clear = context.clearRect;
	let trackedStrokes = 0;
	let trackedAppearance: {
		color: string;
		width: number;
		dash: number[];
		radius: number;
	} | null = null;
	let lastRadius = 0;
	const arc = context.arc;
	context.arc = function (
		x,
		y,
		radius,
		startAngle,
		endAngle,
		counterclockwise,
	) {
		lastRadius = radius;
		arc.call(this, x, y, radius, startAngle, endAngle, counterclockwise);
	};
	const readTrackedAppearance = () => trackedAppearance;
	const trackedStrokeCount = () => trackedStrokes;
	context.clearRect = function (x, y, width, height) {
		trackedStrokes = 0;
		clear.call(this, x, y, width, height);
	};
	context.stroke = function (path?: Path2D) {
		if (this.getLineDash().length > 0) {
			trackedStrokes++;
			trackedAppearance = {
				color: String(this.strokeStyle),
				width: this.lineWidth,
				dash: this.getLineDash(),
				radius: lastRadius,
			};
		}
		if (path !== undefined) stroke.bind(this)(path);
		else stroke.bind(this)();
	};
	try {
		await settle();
		require(trackedStrokeCount() ===
			2, "both tracked entities are decorated in the same map frame");
		const baselineAppearance = readTrackedAppearance();
		require(baselineAppearance !==
			null, "tracked canvas appearance is available");
		const minimapScope = document.querySelector<HTMLElement>(".minimap");
		require(minimapScope !== null, "minimap scope exists");
		const baselineTracking = readMinimapTrackingAppearance(minimapScope);
		const theme = document.createElement("style");
		theme.textContent = `@layer overrides {
			:root {
				--ui-color-success: rgb(17, 34, 51);
				--ui-minimap-tracked-color: var(--ui-color-success);
				--ui-minimap-tracked-width: calc(1px + 2px);
				--ui-minimap-tracked-gap: 9px;
				--ui-minimap-tracked-dash-length: 5px;
				--ui-minimap-tracked-dash-gap: 3px;
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
			const themed = readTrackedAppearance();
			require(themed?.color === "#112233" &&
				themed.width === 3 &&
				themed.dash.join(",") ===
					"5,3", "theme CSS colors and calculated lengths reach the actual minimap canvas");
			require(themed.radius ===
				baselineAppearance.radius +
					9 -
					baselineTracking.gap, "theme ring spacing reaches canvas geometry");
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
			const scope = document.querySelector<HTMLElement>(".minimap");
			require(scope !== null, "minimap scope exists");
			const invalid = document.createElement("div");
			invalid.style.position = "relative";
			invalid.style.width = "200px";
			scope.append(invalid);
			try {
				invalid.style.setProperty("--ui-minimap-tracked-gap", "10%");
				invalid.style.setProperty("--ui-minimap-tracked-dash-length", "5%");
				const percentages = readMinimapTrackingAppearance(invalid);
				require(percentages.gap === 20 &&
					percentages.dash[0] ===
						10, "percentage ring dimensions resolve to used pixels");
				invalid.style.removeProperty("--ui-minimap-tracked-gap");
				invalid.style.removeProperty("--ui-minimap-tracked-dash-length");
				for (const [property, value, message] of [
					[
						"--ui-minimap-tracked-color",
						"not-a-color",
						"Invalid minimap theme color",
					],
					[
						"--ui-minimap-tracked-gap",
						"not-a-length",
						"Invalid minimap theme length",
					],
					["--ui-minimap-tracked-width", "0px", "must be positive"],
					["--ui-minimap-tracked-gap", "auto", "Invalid minimap theme length"],
				]) {
					invalid.style.setProperty(property, value);
					let failure = "";
					try {
						readMinimapTrackingAppearance(invalid);
					} catch (error) {
						if (!(error instanceof Error)) throw error;
						failure = error.message;
					}
					require(failure.includes(
						message,
					), `theme validation reports ${property}`);
					invalid.style.removeProperty(property);
				}
			} finally {
				invalid.remove();
			}
		} finally {
			theme.remove();
			document.dispatchEvent(new Event(UI_THEME_CHANGED_EVENT));
			await settle();
		}
		require(readTrackedAppearance()?.color ===
			baselineAppearance.color, "theme removal restores cached canvas appearance");

		const globToggle = '.alert-rules [aria-label="Alert for *Golem*"]';
		await click(globToggle);
		await settle();
		require(owner.trackedGuids().size ===
			1, "disabling a glob preserves the overlapping exact match");
		require(trackedStrokeCount() ===
			1, "rule edits redraw tracking without entity motion");
		await click(globToggle);
		await settle();
		require(trackedStrokeCount() ===
			2, "reactivating the rule restores both map decorations");
	} finally {
		context.arc = arc;
		context.stroke = stroke;
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
	require(!dependencies
		.commands()
		.slice(commandStart)
		.some(
			({ command }) => command === "examine_client_entity",
		), "catalog never appraises entities");
	return {
		passed: true,
		entities: facts.length,
		tracked: owner.trackedGuids().size,
		checks: [
			"compact-launcher",
			"catalog-row-controls",
			"pointer-hit-testing",
			"search",
			"selection",
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
			"canvas-decoration",
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

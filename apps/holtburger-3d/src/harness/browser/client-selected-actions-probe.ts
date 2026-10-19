import type { ClientChatLine } from "../../client/client-chat-policy";
import { INPUT_DEFAULTS } from "../../lib/input/input-defaults";
import { formatInputBindings } from "../../lib/input/input-presentation";
import { mount, tick, unmount } from "svelte";
import ClientSelectedEntityHud from "../../client/ClientSelectedEntityHud.svelte";
import ClientChat from "../../client/ClientChat.svelte";
import { ClientChatComposer } from "../../client/client-chat-composer.svelte";
import { CLIENT_CLOCK_FORMAT_DEFAULT } from "../../client/client-environment-settings";
import { deathLocationLines } from "../../client/client-death-commands";
import { runClientHelpCommand } from "../../client/client-command-help";
import { deathLocationResultSchema } from "../../client/client-death-contract";
import { EMPTY_CLIENT_SELECTED_DISPLAY } from "../../client/client-selected-entity-tracking";
import { CLIENT_UI_DEFAULTS } from "../../client/client-ui-defaults";
import { CLIENT_TUNING } from "../../client/client-tuning";

/** Exercise action eligibility, menu artwork, dispatch, and dismissal in a real browser. */
export async function probeSelectedActions(context: Map<unknown, unknown>) {
	const splitLabel = `Split stack (${formatInputBindings(INPUT_DEFAULTS.client.splitStack, "windows")})`;
	const target = document.createElement("div");
	target.className = "ui-theme";
	target.style.cssText = `position: fixed; top: 0; left: 0; pointer-events: none; width: ${CLIENT_UI_DEFAULTS.selectedEntity.size.width}px; height: ${CLIENT_UI_DEFAULTS.selectedEntity.size.height}px;`;
	document.body.append(target);
	let interact = false;
	let split = false;
	let invite = false;
	let swear = false;
	let friend = false;
	let ignore = false;
	const calls: string[] = [];
	// Match the viewport's press/release contract: releases select only after a press.
	const viewport = document.createElement("canvas");
	viewport.dataset.gameViewport = "";
	target.append(viewport);
	let viewportPressed = false;
	let viewportSelections = 0;
	viewport.addEventListener("pointerdown", () => {
		viewportPressed = true;
	});
	viewport.addEventListener("pointerup", () => {
		if (viewportPressed) viewportSelections += 1;
		viewportPressed = false;
	});
	const require = (condition: unknown, message: string) => {
		if (!condition) throw new Error(message);
	};
	const component = mount(ClientSelectedEntityHud, {
		target,
		context,
		props: {
			input: {
				...INPUT_DEFAULTS,
				client: {
					...INPUT_DEFAULTS.client,
					interact: [{ key: "f", ctrl: true }],
					examine: [],
				},
			},
			displayPlatform: "windows",
			selectedGuid: 1,
			readSelectedDisplay: () => ({
				...EMPTY_CLIENT_SELECTED_DISPLAY,
				name: "Selected action fixture",
				canInteract: interact,
				interactionLabel: "Trade",
			}),
			readCanSplit: () => split,
			readCanInvite: () => invite,
			readCanSwear: () => swear,
			readCanCorpsePermission: () => friend,
			onCorpsePermission: (granted: boolean) => {
				calls.push(granted ? "grant-corpse" : "revoke-corpse");
			},
			readCanAddFriend: () => friend,
			readCanIgnoreAccount: () => ignore,
			onAddFriend: () => {
				calls.push("friend");
			},
			onIgnoreAccount: () => {
				calls.push("ignore");
			},
			onInteract: () => {
				calls.push("trade");
			},
			onInvite: () => {
				calls.push("invite");
			},
			onSwear: () => {
				calls.push("swear");
			},
			onExamine: () => {
				calls.push("examine");
			},
			examinePending: false,
			onSplit: (source) => {
				require(source.isConnected, "Split dialog source was unmounted with the menu");
				calls.push("split");
			},
		},
	});
	const settle = async () => {
		await tick();
	};
	const sample = async () => {
		await new Promise((resolve) =>
			setTimeout(resolve, CLIENT_TUNING.selectedEntityHud.displayIntervalMs),
		);
		await settle();
	};
	const button = (label: string) => {
		const node = target.querySelector<HTMLButtonElement>(
			`button[aria-label="${label}"]`,
		);
		if (node === null) throw new Error(`Missing selected action: ${label}`);
		return node;
	};
	const menu = () => target.querySelector<HTMLElement>('[role="menu"]');
	const open = async () => {
		button("Selected entity actions").click();
		await settle();
	};
	try {
		await settle();
		require(target.querySelectorAll("button").length ===
			1, "No-action selection should retain only Examine");
		require(button("Examine").title ===
			"Examine (Unbound)", "Examine tooltip must describe its configured empty binding");
		interact = true;
		await sample();
		require(button("Trade").title ===
			"Trade (Ctrl + f)", "Direct interaction tooltip must use the configured shortcut");
		button("Trade").click();
		require(calls.join() === "trade" &&
			menu() === null, "Single action should execute directly");
		split = invite = swear = friend = ignore = true;
		await sample();
		await open();
		const rows = Array.from(
			target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
		);
		require(rows.map((row) => row.textContent?.trim()).join("|") ===
			`Trade (Ctrl + f)|Swear allegiance|Invite to party|Add friend|Ignore account|Grant corpse access|Revoke corpse access|${splitLabel}`, "Menu action labels or order are incorrect");
		require(rows.every(
			(row) => !row.hasAttribute("title"),
		), "Labeled menu actions should not have redundant tooltips");
		require(rows.every(
			(row) => row.querySelector("svg") !== null,
		), "Each menu action needs its icon");
		require(button("Examine")
			.isConnected, "Examine must remain outside the menu");
		for (const label of [
			"Trade (Ctrl + f)",
			"Swear allegiance",
			"Invite to party",
			"Add friend",
			"Ignore account",
			"Grant corpse access",
			"Revoke corpse access",
			splitLabel,
		]) {
			if (menu() === null) await open();
			const row = Array.from(
				target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
			).find((row) => row.textContent?.trim() === label);
			if (row === undefined) throw new Error(`Missing menu action: ${label}`);
			row.click();
			await settle();
			require(menu() === null, "Choosing an action must close the menu");
		}
		require(calls.join() ===
			"trade,trade,swear,invite,friend,ignore,grant-corpse,revoke-corpse,split", "Menu dispatched the wrong actions");
		await open();
		const triggerPress = new PointerEvent("pointerdown", {
			bubbles: true,
			cancelable: true,
		});
		button("Selected entity actions").dispatchEvent(triggerPress);
		await settle();
		require(menu() !==
			null, "Trigger press must leave the menu open for its click to toggle it closed");
		button("Selected entity actions").click();
		await settle();
		require(menu() === null, "Trigger must toggle the menu closed");
		await open();
		const dismissalPress = new PointerEvent("pointerdown", {
			bubbles: true,
			cancelable: true,
		});
		viewport.dispatchEvent(dismissalPress);
		await settle();
		require(menu() === null, "Outside pointer must dismiss the menu");
		viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
		require(dismissalPress.defaultPrevented &&
			!viewportPressed &&
			viewportSelections ===
				0, "Menu dismissal must consume the press without starting viewport selection");
		viewport.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
		viewport.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
		require(viewportSelections ===
			1, "The next viewport gesture must select normally after dismissal");
		await open();
		menu()?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		await settle();
		require(menu() === null, "Escape must dismiss the menu");
		await open();
		split = invite = swear = friend = ignore = false;
		await sample();
		require(menu() === null &&
			button("Trade")
				.isConnected, "Eligibility change must restore the single action and dismiss the menu");
		// Feed typed death-query output through production chat and its explicit waypoint link.
		const query = deathLocationResultSchema.parse({
			character: 7,
			locations: {
				kind: "recent",
				positions: [
					{
						landblockId: 0xda550001,
						coords: { x: 12, y: 34, z: 56 },
						rotation: { w: 1, x: 0, y: 0, z: 0 },
					},
					{
						landblockId: 0xda550100,
						coords: { x: 12, y: 34, z: 56 },
						rotation: { w: 1, x: 0, y: 0, z: 0 },
					},
					null,
				],
			},
		});
		let waypointActivations = 0;
		const messages: ClientChatLine[] = deathLocationLines(query).map(
			(message, id) => ({
				kind: "system",
				message,
				id,
				receivedAt: new Date(0),
			}),
		);
		runClientHelpCommand("/help", (entry) => {
			messages.push({ ...entry, id: messages.length, receivedAt: new Date(0) });
		});
		messages.push({
			kind: "formatted-system",
			id: messages.length,
			receivedAt: new Date(0),
			rows: [
				{
					indented: true,
					spans: [{ kind: "code", text: "<i>literal</i> 42.0N, 12.0E" }],
				},
			],
		});
		const chatTarget = document.createElement("div");
		target.append(chatTarget);
		const chat = mount(ClientChat, {
			target: chatTarget,
			context,
			props: {
				messages,
				clockFormat: CLIENT_CLOCK_FORMAT_DEFAULT,
				composer: new ClientChatComposer(),
				sentHistory: [],
				enabledTags: ["chat", "combat"],
				onEnabledTagsChange: () => {},
				onSend: async () => {
					throw new Error("Coordinate clicks must not submit chat");
				},
				onSendError: (message) => {
					throw new Error(`Unexpected chat submission failure: ${message}`);
				},
				onSetWaypoint: () => {
					waypointActivations += 1;
				},
			},
		});
		try {
			await settle();
			const help = Array.from(chatTarget.querySelectorAll("p")).find((row) =>
				row.textContent?.includes("Available commands"),
			);
			if (help === undefined)
				throw new Error("Missing formatted help response");
			require(help.querySelectorAll("strong").length ===
				1, "Help needs one timestamp for the entire response");
			require(help.querySelector("code")?.textContent ===
				"/help [command]", "Help commands must render as code");
			const heading = help.querySelector("em");
			require(heading !== null &&
				getComputedStyle(heading).fontStyle ===
					"italic", "Help headings must render in italics");
			const indented = help.querySelector<HTMLElement>(".indented");
			require(indented !== null &&
				parseFloat(getComputedStyle(indented).paddingInlineStart) >
					0, "Help command rows must be indented");
			require(chatTarget.textContent?.includes("<i>literal</i>") &&
				chatTarget.querySelector("i") ===
					null, "Formatted spans must preserve literal markup as text");
			require(waypointActivations ===
				0, "Query output must not create a waypoint automatically");
			const historyToggle = chatTarget.querySelector<HTMLButtonElement>(
				'button[aria-label="Interact with chat history"]',
			);
			if (historyToggle === null)
				throw new Error("Missing chat history interaction control");
			historyToggle.click();
			await settle();
			const links = chatTarget.querySelectorAll<HTMLButtonElement>(
				"button.waypoint-link",
			);
			require(links.length ===
				2, "Outdoor history and formatted coordinates should each offer a waypoint");
			require(chatTarget.textContent?.includes(
				"0xda550100",
			), "Indoor output must preserve its cell");
			links[0].click();
			await settle();
			require(waypointActivations ===
				1, "Explicit coordinate activation must set one waypoint");
			links[1].click();
			await settle();
			require(waypointActivations ===
				2, "Formatted code coordinates must retain waypoint activation");
		} finally {
			await unmount(chat);
			chatTarget.remove();
		}
		return { passed: true, calls, waypointActivations };
	} finally {
		await unmount(component);
		target.remove();
	}
}

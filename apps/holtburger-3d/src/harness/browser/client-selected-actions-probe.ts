import { mount, tick, unmount } from "svelte";
import ClientSelectedEntityHud from "../../client/ClientSelectedEntityHud.svelte";
import { EMPTY_CLIENT_SELECTED_DISPLAY } from "../../client/client-selected-entity-tracking";
import { CLIENT_UI_DEFAULTS } from "../../client/client-ui-defaults";
import { CLIENT_TUNING } from "../../client/client-tuning";

/** Exercise action eligibility, menu artwork, dispatch, and dismissal in a real browser. */
export async function probeSelectedActions(context: Map<unknown, unknown>) {
	const target = document.createElement("div");
	target.className = "ui-theme";
	target.style.cssText = `position: fixed; top: 0; left: 0; pointer-events: none; width: ${CLIENT_UI_DEFAULTS.selectedEntity.size.width}px; height: ${CLIENT_UI_DEFAULTS.selectedEntity.size.height}px;`;
	document.body.append(target);
	let interact = false;
	let split = false;
	let invite = false;
	let swear = false;
	const calls: string[] = [];
	const require = (condition: unknown, message: string) => {
		if (!condition) throw new Error(message);
	};
	const component = mount(ClientSelectedEntityHud, {
		target,
		context,
		props: {
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
		interact = true;
		await sample();
		button("Trade").click();
		require(calls.join() === "trade" &&
			menu() === null, "Single action should execute directly");
		split = invite = swear = true;
		await sample();
		await open();
		const rows = Array.from(
			target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
		);
		require(rows.map((row) => row.textContent?.trim()).join("|") ===
			"Trade|Swear allegiance|Invite to party|Split stack", "Menu action labels or order are incorrect");
		require(rows.every(
			(row) => row.querySelector("svg") !== null,
		), "Each menu action needs its icon");
		require(button("Examine")
			.isConnected, "Examine must remain outside the menu");
		for (const label of [
			"Trade",
			"Swear allegiance",
			"Invite to party",
			"Split stack",
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
			"trade,trade,swear,invite,split", "Menu dispatched the wrong actions");
		await open();
		button("Selected entity actions").click();
		await settle();
		require(menu() === null, "Trigger must toggle the menu closed");
		await open();
		document.body.dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true }),
		);
		await settle();
		require(menu() === null, "Outside pointer must dismiss the menu");
		await open();
		menu()?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		await settle();
		require(menu() === null, "Escape must dismiss the menu");
		await open();
		split = invite = swear = false;
		await sample();
		require(menu() === null &&
			button("Trade")
				.isConnected, "Eligibility change must restore the single action and dismiss the menu");
		return { passed: true, calls };
	} finally {
		await unmount(component);
		target.remove();
	}
}

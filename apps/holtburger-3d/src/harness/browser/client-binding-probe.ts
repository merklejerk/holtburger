import { CLIENT_KEYBOARD_DEFAULTS } from "../../client/client-input-settings";
import { formatInputBindings } from "../../lib/input/input-presentation";
import { mount, tick, unmount } from "svelte";
import ClientBindingProbe from "./ClientBindingProbe.svelte";
import type { ClientInputConfiguration } from "../../lib/input/input-contract";
import type { KeyboardInputPolicy } from "../../lib/input/keyboard-input-policy";

/** Compose the real Settings editor with accepted settings, HUD shortcut presentation, and a feature owner. */
export async function probeClientBindings(options: {
	readonly context: Map<unknown, unknown>;
	readonly keyboard: KeyboardInputPolicy;
	readonly initial: ClientInputConfiguration;
	readonly accept: (
		input: ClientInputConfiguration,
	) => ClientInputConfiguration;
	readonly interact: () => void;
	readonly submissions: () => number;
}) {
	const target = document.createElement("div");
	target.className = "ui-theme";
	document.body.append(target);
	const component = mount(ClientBindingProbe, {
		target,
		context: options.context,
		props: {
			initial: options.initial,
			accept: options.accept,
			interact: options.interact,
		},
	});
	const require = (condition: unknown, message: string) => {
		if (!condition) throw new Error(message);
	};
	const click = async (label: string) => {
		const button = Array.from(
			target.querySelectorAll<HTMLButtonElement>("button"),
		).find(
			(button) =>
				button.getAttribute("aria-label") === label ||
				button.textContent?.trim() === label,
		);
		if (button === undefined)
			throw new Error(`Missing binding probe button ${label}`);
		button.click();
		await tick();
	};
	const press = (
		key: string,
		code: string,
		modifiers: {
			shiftKey?: boolean;
			ctrlKey?: boolean;
			altKey?: boolean;
			metaKey?: boolean;
		} = {},
	) => {
		const active = document.activeElement ?? document.body;
		active.dispatchEvent(
			new KeyboardEvent("keydown", {
				key,
				code,
				...modifiers,
				bubbles: true,
				cancelable: true,
			}),
		);
		active.dispatchEvent(
			new KeyboardEvent("keyup", {
				key,
				code,
				...modifiers,
				bubbles: true,
				cancelable: true,
			}),
		);
	};
	try {
		await tick();
		const original = target.querySelector<HTMLButtonElement>(
			'button[aria-label="Trade"]',
		)?.title;
		// Removing each old alternative proves replacement instead of simply adding another shortcut.
		const interactRow = () =>
			Array.from(target.querySelectorAll<HTMLElement>(".binding-row")).find(
				(row) =>
					row.querySelector(".binding-label")?.textContent === "Interact",
			);
		while (interactRow()?.querySelector(".binding-key") !== null) {
			const row = interactRow();
			if (row === undefined) throw new Error("Missing Interact editor row");
			const binding = row.querySelector<HTMLButtonElement>(".binding-key");
			if (binding === null) break;
			binding.click();
			await tick();
		}
		await click("Add key for Interact");
		press("e", "KeyE");
		await tick();
		require(target
			.querySelector('[role="alert"]')
			?.textContent?.includes(
				"Examine",
			), "Capture must identify the real Examine conflict");
		await click("Replace");
		require(interactRow()?.querySelector("kbd")?.textContent ===
			"e", "Settings pill did not publish the accepted key");
		require(target.querySelector<HTMLButtonElement>(
			'button[aria-label="Trade"]',
		)?.title === "Trade (e)", "Direct HUD title did not update");
		options.keyboard.returnToGame();
		const before = options.submissions();
		for (const binding of options.initial.client.interact) {
			press(
				binding.key ?? binding.code,
				binding.code ?? `Key${binding.key.toUpperCase()}`,
				{
					shiftKey: Boolean(binding.shift),
					ctrlKey: Boolean(binding.ctrl),
					altKey: Boolean(binding.alt),
					metaKey: Boolean(binding.meta),
				},
			);
		}
		await tick();
		require(options.submissions() ===
			before, "Old interaction key still dispatched");
		press("e", "KeyE");
		await tick();
		require(options.submissions() ===
			before + 1, "New key did not reach the item interaction owner");
		await click("Toggle extra action");
		await click("Selected entity actions");
		require(target
			.querySelector<HTMLButtonElement>('[role="menuitem"]')
			?.textContent?.trim() ===
			"Trade (e)", "Popup label disagreed with direct HUD shortcut");
		await click("Selected entity actions");
		await click("Add key for Interact");
		press("e", "KeyE");
		await tick();
		require(interactRow()?.querySelectorAll("kbd").length === 1 &&
			target.querySelector("dialog") ===
				null, "Repeated capture should deduplicate the existing alternative");
		await click("Restore default keys for Interact");
		require(target.querySelector<HTMLButtonElement>(
			'button[aria-label="Examine"]',
		)?.title ===
			"Examine (Unbound)", "Conflict replacement must remove the old Examine alternative");
		await click("Restore default keyboard bindings");
		require(target.querySelector<HTMLButtonElement>(
			'button[aria-label="Examine"]',
		)?.title ===
			`Examine (${formatInputBindings(CLIENT_KEYBOARD_DEFAULTS.client.examine, "windows")})`, "Restore-all did not update the HUD");
		const splitRow = Array.from(
			target.querySelectorAll<HTMLElement>(".binding-row"),
		).find(
			(row) =>
				row.querySelector(".binding-label")?.textContent === "Split stack",
		);
		const splitKey = splitRow?.querySelector<HTMLButtonElement>(".binding-key");
		if (splitKey === undefined || splitKey === null)
			throw new Error("Missing split-stack default binding");
		splitKey.click();
		await tick();
		await click("Add key for Split stack");
		press("F9", "F9");
		await tick();
		await click("Selected entity actions");
		require(Array.from(target.querySelectorAll('[role="menuitem"]')).some(
			(item) => item.textContent?.trim() === "Split stack (F9)",
		), "Split-stack menu hint did not update after remapping");
		await click("Selected entity actions");
		await click("Restore default keys for Split stack");
		const movementBefore = target.querySelector(
			".binding-group .binding-row",
		)?.textContent;
		const powerRow = Array.from(target.querySelectorAll(".binding-row")).find(
			(row) =>
				row.querySelector(".binding-label")?.textContent ===
				"Increase jump power (precise mode)",
		);
		const powerKey = powerRow?.querySelector<HTMLButtonElement>(".binding-key");
		if (!powerKey) throw new Error("Missing power binding row");
		powerKey.click();
		await tick();
		await click("Add key for Increase jump power (precise mode)");
		press("i", "KeyI");
		await tick();
		require(target.querySelector(".jump-power-keys kbd")?.textContent ===
			"I", "Power keycap did not follow remapping");
		require(target.querySelector(".binding-group .binding-row")?.textContent ===
			movementBefore, "Power remapping changed movement");
		await click("Restore default keys for Increase jump power (precise mode)");
		require(target.querySelector(".jump-power-keys kbd")?.textContent ===
			formatInputBindings(
				CLIENT_KEYBOARD_DEFAULTS.preciseJump.increasePower,
				"windows",
			).toUpperCase(), "Power default did not restore its keycap");
		return {
			passed: true,
			original,
			remapped: "Trade (e)",
			oldKeyStopped: true,
			splitStackRemapped: true,
			precisePowerRemapped: true,
			featureSubmissions: options.submissions() - before,
		};
	} finally {
		await unmount(component);
		target.remove();
	}
}

import { createRawSnippet, mount, tick, unmount } from "svelte";
import PopupMenu from "../../app/PopupMenu.svelte";
import ClientMessageDialog from "../../client/ClientMessageDialog.svelte";
import ClientBindingDialog from "../../client/ClientBindingDialog.svelte";
import ClientQuantityDialog from "../../client/ClientQuantityDialog.svelte";
import InventoryCurrencyOverlay from "../../client/InventoryCurrencyOverlay.svelte";

/** Verify shared theme overrides on real overlay components without visual acceptance. */
export async function probeOverlayTheme(context: Map<unknown, unknown>) {
	const target = document.createElement("div");
	target.className = "ui-theme";
	document.body.append(target);
	const style = document.createElement("style");
	style.textContent = `@layer overrides { :root {
		--ui-overlay-background: rgb(11, 22, 33);
		--ui-overlay-color: rgb(44, 55, 66);
		--ui-overlay-border-color: rgb(77, 88, 99);
		--ui-overlay-radius: 13px;
		--ui-overlay-shadow: none;
		--ui-overlay-backdrop-filter: blur(3px);
		--ui-overlay-backdrop-background: rgba(22, 33, 44, 0.6);
		--ui-overlay-padding: 19px;
		--ui-overlay-gap: 9px;
		--ui-overlay-icon-size: 22px;
		--ui-dialog-padding: 17px;
		--ui-menu-disabled-opacity: 0.3;
	}
	.ui-panel { border-color: rgb(199, 188, 177); background: rgb(166, 155, 144); }
	}`;
	document.head.append(style);
	const require = (condition: boolean, message: string) => {
		if (!condition) throw new Error(message);
	};
	const element = (selector: string): HTMLElement => {
		const node = target.querySelector<HTMLElement>(selector);
		if (node === null) throw new Error(`Missing themed overlay: ${selector}`);
		return node;
	};
	const surface = (selector: string) => {
		const appearance = getComputedStyle(element(selector));
		require(appearance.backgroundColor ===
			"rgb(11, 22, 33)", `${selector} ignored overlay background`);
		require(appearance.color ===
			"rgb(44, 55, 66)", `${selector} ignored overlay text color`);
		require(appearance.borderTopColor ===
			"rgb(77, 88, 99)", `${selector} ignored overlay border color`);
		require(appearance.borderTopLeftRadius ===
			"13px", `${selector} ignored overlay radius`);
		require(appearance.boxShadow ===
			"none", `${selector} ignored overlay shadow`);
		require(appearance.backdropFilter ===
			"blur(3px)", `${selector} ignored overlay blur`);
	};
	const backdrop = (selector: string, pseudo?: string) => {
		require(getComputedStyle(element(selector), pseudo).backgroundColor ===
			"rgba(22, 33, 44, 0.6)", `${selector} ignored shared backdrop`);
	};
	let component: ReturnType<typeof mount> | null = null;
	const clear = async () => {
		if (component !== null) await unmount(component);
		component = null;
	};
	try {
		const anchor = document.createElement("button");
		anchor.textContent = "Theme menu";
		target.append(anchor);
		component = mount(PopupMenu, {
			target,
			context,
			props: {
				anchor,
				label: "Theme menu",
				items: [
					{ action: "enabled", label: "Enabled", disabled: false },
					{ action: "disabled", label: "Disabled", disabled: true },
				],
				icon: createRawSnippet(() => ({ render: () => "<span></span>" })),
				onselect: () => {},
				onclose: () => {},
			},
		});
		await tick();
		surface(".popup-menu");
		require(getComputedStyle(element(".popup-menu-icon")).width ===
			"22px", "Menu ignored overlay icon size");
		require(getComputedStyle(element(".popup-menu-item")).columnGap ===
			"9px", "Menu ignored overlay spacing");
		require(getComputedStyle(element(".popup-menu-item:disabled")).opacity ===
			"0.3", "Menu ignored disabled opacity");
		await clear();
		anchor.remove();
		component = mount(ClientMessageDialog, {
			target,
			context,
			props: {
				presentation: { kind: "popup", id: 1, text: "Theme fixture" },
				onDismiss: () => {},
				onRespond: () => {},
			},
		});
		await tick();
		surface(".ui-dialog");
		require(getComputedStyle(element(".ui-dialog h2")).color ===
			"rgb(44, 55, 66)", "Modal heading ignored overlay foreground");
		backdrop(".ui-dialog", "::backdrop");
		require(getComputedStyle(element(".ui-dialog")).paddingTop ===
			"17px", "Modal ignored dialog padding");
		await clear();
		component = mount(ClientBindingDialog, {
			target,
			context,
			props: {
				action: "Theme fixture",
				conflict: null,
				onKeydown: () => {},
				onKeyup: () => {},
				onReplace: () => {},
				onCancel: () => {},
			},
		});
		await tick();
		surface(".binding-dialog");
		backdrop(".binding-dialog-overlay");
		require(getComputedStyle(element(".binding-dialog")).paddingTop ===
			"17px", "Binding dialog ignored dialog padding");
		await clear();
		component = mount(ClientQuantityDialog, {
			target,
			context,
			props: {
				request: { name: "Theme fixture", maxAmount: 2 },
				onSubmit: () => {},
				onCancel: () => {},
			},
		});
		await tick();
		surface(".quantity-dialog");
		backdrop(".quantity-overlay");
		require(getComputedStyle(element(".quantity-dialog form")).paddingTop ===
			"17px", "Quantity dialog ignored dialog padding");
		await clear();
		component = mount(InventoryCurrencyOverlay, {
			target,
			context,
			props: {
				label: "Theme currency",
				rows: [],
				pending: false,
				displays: new Map(),
				children: createRawSnippet(() => ({
					render: () => "<span>Balance</span>",
				})),
			},
		});
		await tick();
		surface(".inventory-currency-overlay");
		require(getComputedStyle(element(".inventory-currency-overlay"))
			.paddingTop === "19px", "Currency popup ignored overlay padding");
		return { passed: true, surfaces: 5, sharedBackdrops: 3 };
	} finally {
		await clear();
		target.remove();
		style.remove();
	}
}

import { mount, tick, unmount } from "svelte";
import ClientMessageDialog from "../../client/ClientMessageDialog.svelte";
import ClientQuantityDialog from "../../client/ClientQuantityDialog.svelte";
import ClientBindingDialog from "../../client/ClientBindingDialog.svelte";
import ClientPartyCreateDialog from "../../client/ClientPartyCreateDialog.svelte";
import ClientPartyLeaveDialog from "../../client/ClientPartyLeaveDialog.svelte";
import ExplorerTexturePageModal from "../../explorer/ExplorerTexturePageModal.svelte";
import {
	TexturePixelFormat,
	TexturePurpose,
} from "../../lib/game/textures/types";
import type { ClientDialogPresentation } from "../../client/client-dialogs";

/** Exercise native and panel-scoped backdrop gestures without visual acceptance. */
export async function probeDialogBackdrops(context: Map<unknown, unknown>) {
	const target = document.createElement("div");
	target.className = "ui-theme";
	target.style.cssText =
		"position: fixed; inset: 20px; width: 400px; height: 300px;";
	document.body.append(target);
	let component: ReturnType<typeof mount> | null = null;
	const verified: string[] = [];
	let cancellations = 0;
	const cancel = () => {
		cancellations++;
	};
	const require = (condition: boolean, message: string) => {
		if (!condition) throw new Error(message);
	};
	async function exercise(label: string, blocked = false): Promise<void> {
		await tick();
		const dialog = target.querySelector("dialog");
		if (dialog === null) throw new Error(`Missing ${label} dialog`);
		const backdrop = dialog.matches(":modal") ? dialog : dialog.parentElement;
		if (backdrop === null) throw new Error(`Missing ${label} backdrop`);
		const bounds = dialog.getBoundingClientRect();
		const inside = {
			clientX: bounds.left + bounds.width / 2,
			clientY: bounds.top + bounds.height / 2,
		};
		const outside = { clientX: bounds.left - 5, clientY: bounds.top - 5 };
		const press = (element: HTMLElement, point: typeof inside) =>
			element.dispatchEvent(
				new PointerEvent("pointerdown", { ...point, bubbles: true }),
			);
		const click = (element: HTMLElement, point: typeof inside) =>
			element.dispatchEvent(
				new MouseEvent("click", { ...point, bubbles: true }),
			);
		const before = cancellations;
		press(dialog, inside);
		click(dialog, inside);
		press(dialog, inside);
		click(backdrop, outside);
		press(backdrop, outside);
		click(dialog, inside);
		press(backdrop, outside);
		backdrop.dispatchEvent(
			new PointerEvent("pointercancel", { bubbles: true }),
		);
		click(backdrop, outside);
		require(cancellations ===
			before, `${label} dismissed from an inside or canceled gesture`);
		press(backdrop, outside);
		click(backdrop, outside);
		await tick();
		require(cancellations ===
			before +
				(blocked
					? 0
					: 1), `${label} used the wrong backdrop cancellation policy`);
		if (component === null) throw new Error(`Missing ${label} component`);
		await unmount(component);
		component = null;
		verified.push(label);
	}
	try {
		const presentations: readonly {
			label: string;
			value: ClientDialogPresentation;
			blocked?: boolean;
		}[] = [
			{
				label: "message",
				value: { kind: "popup", id: 41, text: "Server message" },
			},
			{
				label: "local-confirmation",
				value: {
					kind: "local-confirmation",
					request: { requestId: "local-1", text: "Dismiss this member?" },
					submission: { kind: "ready", error: null },
				},
			},
			{
				label: "typed-confirmation",
				value: {
					kind: "local-confirmation",
					request: {
						requestId: "typed-1",
						text: "Abandon home?",
						typedConfirmation: { requiredText: "abandon" },
					},
					submission: { kind: "ready", error: null },
				},
			},
			{
				label: "server-confirmation",
				value: {
					kind: "confirmation",
					request: { requestId: "1", text: "Join party?" },
					submission: { kind: "ready", error: null },
				},
			},
			{
				label: "submitting-confirmation",
				blocked: true,
				value: {
					kind: "confirmation",
					request: { requestId: "1", text: "Join party?" },
					submission: { kind: "submitting" },
				},
			},
		];
		for (const { label, value, blocked } of presentations) {
			component = mount(ClientMessageDialog, {
				target,
				context,
				props: {
					presentation: value,
					onDismiss: (id) => {
						require(value.kind === "popup" &&
							id === value.id, "Backdrop dismissed a different message");
						cancel();
					},
					onRespond: (id, accepted) => {
						require(value.kind !== "popup" &&
							id === value.request.requestId &&
							!accepted, "Backdrop failed to decline the reviewed question");
						cancel();
					},
				},
			});
			await exercise(label, blocked);
		}
		component = mount(ClientPartyCreateDialog, {
			target,
			context,
			props: {
				preferences: { shareXp: true, shareLoot: false, ignoreRequests: false },
				onSubmit: () => {
					throw new Error("Backdrop created a party");
				},
				onCancel: cancel,
			},
		});
		await exercise("party-create");
		component = mount(ClientPartyLeaveDialog, {
			target,
			context,
			props: {
				candidates: [{ guid: 2, name: "Successor" }],
				onSubmit: () => {
					throw new Error("Backdrop handed off leadership");
				},
				onCancel: cancel,
			},
		});
		await exercise("party-handoff");
		for (const purpose of ["split", "buy"] as const) {
			component = mount(ClientQuantityDialog, {
				target,
				context,
				props: {
					request: { name: "Stack", maxAmount: 10 },
					purpose,
					onSubmit: () => {
						throw new Error("Backdrop submitted quantity");
					},
					onCancel: cancel,
				},
			});
			await exercise(`quantity-${purpose}`);
		}
		for (const conflict of [
			null,
			{ bindings: ["Ctrl+2"], actions: "Other action" },
		]) {
			component = mount(ClientBindingDialog, {
				target,
				context,
				props: {
					action: "Test action",
					conflict,
					onKeydown: () => {},
					onKeyup: () => {},
					onReplace: () => {
						throw new Error("Backdrop replaced a binding");
					},
					onCancel: cancel,
				},
			});
			await exercise(
				conflict === null ? "binding-capture" : "binding-conflict",
			);
		}
		component = mount(ExplorerTexturePageModal, {
			target,
			context,
			props: {
				page: {
					pageId: "page:backdrop-probe",
					purpose: TexturePurpose.ObjectDirectColor,
					width: 1,
					height: 1,
					byteLength: 4,
					entryCount: 0,
					entries: [],
					allocatedPixelRatio: 0,
					occupiedPixelRatio: 0,
					largestFreePixelRatio: 1,
				},
				preview: {
					format: TexturePixelFormat.RGBA8,
					width: 1,
					height: 1,
					pixels: new Uint8Array([255, 255, 255, 255]),
				},
				onClose: cancel,
			},
		});
		await exercise("texture-inspection");
		return { passed: true, verified };
	} finally {
		if (component !== null) await unmount(component);
		target.remove();
	}
}

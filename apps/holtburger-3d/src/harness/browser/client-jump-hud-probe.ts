import { MINIMUM_JUMP_POWER } from "../../client/client-host-contract";
import { mount, tick, unmount } from "svelte";
import ClientJumpPowerBar from "../../client/ClientJumpPowerBar.svelte";

/** Verify power-edge alignment, mode labels and theme overrides. */
export async function probeClientJumpHud() {
	const target = document.createElement("div");
	target.className = "ui-theme";
	target.style.cssText =
		"width:180px;height:220px;--ui-jump-bar-width:31px;--ui-jump-readout-font-size:32px;--ui-jump-gap:16px;--ui-keycap-size:2em;--ui-jump-fill-color:rgb(12, 34, 56)";
	document.body.append(target);
	let extent = 0.5;
	let component: ReturnType<typeof mount> | null = null;
	const element = (selector: string): HTMLElement => {
		const node = target.querySelector<HTMLElement>(selector);
		if (node === null) throw new Error(`Missing jump HUD element: ${selector}`);
		return node;
	};
	const require = (condition: boolean, message: string) => {
		if (!condition) throw new Error(message);
	};
	const frame = () =>
		new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	try {
		for (const precise of [false, true]) {
			component = mount(ClientJumpPowerBar, {
				target,
				props: {
					active: true,
					previewExtent: null,
					precise,
					powerKeys: ["W", "S"],
					readExtent: () => extent,
					powerControl: precise
						? {
								setPower: (value) => {
									extent = Math.max(MINIMUM_JUMP_POWER, Math.min(1, value));
								},
							}
						: null,
				},
			});
			await tick();
			await frame();
			require(element(".jump-mode-label").textContent ===
				(precise
					? "PRECISE JUMP"
					: "MANUAL JUMP"), "Incorrect jump mode label");
			const label = element(".jump-mode-label").getBoundingClientRect();
			const bar = element(".jump-power-track").getBoundingClientRect();
			const gap = Number.parseFloat(
				getComputedStyle(element(".jump-power")).columnGap,
			);
			require(Math.abs(bar.left - label.right - gap) <
				1, "Mode label is not beside the bar");
			require(Math.abs(label.bottom - bar.bottom) <
				1, "Mode label does not share the bar's bottom edge");
			const textRange = document.createRange();
			textRange.selectNodeContents(element(".jump-mode-label"));
			require(Math.abs(textRange.getBoundingClientRect().bottom - bar.bottom) <
				2, "Mode text does not start at the bar's bottom edge");

			for (const power of [0, 0.25, 0.5, 1]) {
				extent = power;
				await frame();
				const fill = element(".jump-power-fill").getBoundingClientRect();
				const guide = element(".jump-power-level").getBoundingClientRect();
				const readout = element(".jump-power-readout").getBoundingClientRect();
				require(element(".jump-power-readout").textContent ===
					`${power * 100}%`, "Incorrect power percentage");
				require(Math.abs(guide.top - fill.top) <
					2, `Power guide is not aligned with fill edge: power=${power}, guide=${guide.top}, fill=${fill.top}, height=${fill.height}, scale=${element(".jump-power-scale").getBoundingClientRect().height}, track=${element(".jump-power-track").getBoundingClientRect().height}`);
				require(Math.abs(readout.bottom - guide.top) <
					2, "Percentage underline is not on the fill edge");
				require(readout.left >= fill.right, "Percentage is not beside the bar");
				const caption = element(".jump-power-caption");
				const captionRect = caption.getBoundingClientRect();
				require(element(".jump-power-label").textContent ===
					"POWER", "Incorrect power caption");
				if (precise) {
					const keys = [
						...caption.querySelectorAll<HTMLElement>("kbd.ui-keycap"),
					];
					require(keys.map((key) => key.textContent).join("/") ===
						"W/S", "Incorrect power keycaps");
					require(element(".jump-power-keys").getBoundingClientRect().top >
						element(".jump-power-label").getBoundingClientRect()
							.bottom, "Power keycaps are not on the next line");
					for (const key of keys)
						require(Math.abs(
							key.getBoundingClientRect().height -
								Number.parseFloat(getComputedStyle(key).fontSize) * 2,
						) < 1, "Keycap ignored themed sizing");
				}
				require(captionRect.top > guide.top &&
					Math.abs(captionRect.left - readout.left) <
						1, "POWER is not beneath the percentage underline");
				require(Number.parseFloat(getComputedStyle(caption).fontSize) <
					Number.parseFloat(
						getComputedStyle(element(".jump-power-readout")).fontSize,
					), "POWER font is not smaller than the percentage");
				require(captionRect.bottom <=
					target.getBoundingClientRect()
						.bottom, "Zero-power caption exceeds HUD bounds");

				require(readout.top >=
					target.getBoundingClientRect()
						.top, "Full-power percentage exceeds HUD bounds");
			}
			for (const [selector, property, expected] of [
				[".jump-power-track", "width", "31px"],
				[".jump-power-readout", "fontSize", "32px"],
				[".jump-power-fill", "backgroundColor", "rgb(12, 34, 56)"],
			] as const)
				require(getComputedStyle(element(selector))[property] ===
					expected, `Jump theme ignored ${property}`);
			if (precise) {
				const input = element(".jump-power-input");
				const focused = document.activeElement;
				for (const power of [0, 0.25, 0.75, 1]) {
					const bounds = input.getBoundingClientRect();
					const event = new PointerEvent("pointerdown", {
						button: 0,
						clientY: bounds.bottom - bounds.height * power,
						bubbles: true,
						cancelable: true,
					});
					input.dispatchEvent(event);
					await frame();
					require(Math.abs(extent - Math.max(MINIMUM_JUMP_POWER, power)) <
						0.001, "Bar click did not set the selected height");
					require(event.defaultPrevented &&
						document.activeElement ===
							focused, "Bar click stole keyboard focus");
				}
			}

			await unmount(component);
			component = null;
		}
		return { passed: true, modes: 2, powerLevels: 4, clickLevels: 4 };
	} finally {
		if (component !== null) await unmount(component);
		target.remove();
	}
}

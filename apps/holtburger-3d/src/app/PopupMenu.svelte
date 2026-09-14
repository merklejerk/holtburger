<script lang="ts" module>
	/** One command supplied by the menu's consumer; game behavior remains outside the menu. */
	interface PopupMenuItem<Action extends string> {
		/** Stable command identity for keyed rows and selection callbacks. */
		readonly action: Action;
		/** Visible command name and accessible menu-item label. */
		readonly label: string;
		/** Unavailable commands remain visible but cannot be selected. */
		readonly disabled: boolean;
	}
</script>

<script lang="ts" generics="Action extends string">
	import { onMount } from "svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	interface Props {
		/** Trigger rectangle used for placement; the caller owns its expanded/haspopup attributes. */
		readonly anchor: HTMLElement;
		/** Accessible name of the command menu. */
		readonly label: string;
		/** Ordered commands. Their identities must be unique within this menu. */
		readonly items: readonly PopupMenuItem<Action>[];
		/** Called after dismissal when an enabled command is activated. */
		readonly onselect: (action: Action) => void;
		/** The caller unmounts this open menu on dismissal. */
		readonly onclose: () => void;
	}
	let { anchor, label, items, onselect, onclose }: Props = $props();
	const { keyboard } = useAppInputPolicy();
	const id = $props.id();
	let surface: HTMLDivElement;
	let selected = $state<Action | null>(null);
	let closed = false;
	const enabled = $derived(items.filter((item) => !item.disabled));
	const active = $derived(
		enabled.find((item) => item.action === selected) ?? enabled[0] ?? null,
	);
	const itemId = (action: Action) => `${id}-${encodeURIComponent(action)}`;
	function dismiss() {
		if (closed) return;
		closed = true;
		onclose();
	}
	function choose(item: PopupMenuItem<Action>) {
		if (closed || item.disabled) return;
		dismiss();
		onselect(item.action);
	}
	function keydown(event: KeyboardEvent) {
		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp": {
				event.preventDefault();
				if (active === null) return;
				const direction = event.key === "ArrowDown" ? 1 : -1;
				const index = enabled.indexOf(active);
				selected =
					enabled[(index + direction + enabled.length) % enabled.length]
						?.action ?? null;
				break;
			}
			case "Home":
				event.preventDefault();
				selected = enabled[0]?.action ?? null;
				break;
			case "End":
				event.preventDefault();
				selected = enabled.at(-1)?.action ?? null;
				break;
			case "Enter":
			case " ":
				event.preventDefault();
				if (!event.repeat && active !== null) choose(active);
				break;
			case "Escape":
			case "Tab":
				event.preventDefault();
				dismiss();
				break;
		}
		if (selected !== null)
			document
				.getElementById(itemId(selected))
				?.scrollIntoView({ block: "nearest" });
	}
	function position() {
		const rect = anchor.getBoundingClientRect();
		const width = surface.offsetWidth;
		const height = surface.offsetHeight;
		const top =
			rect.bottom + height <= window.innerHeight
				? rect.bottom
				: rect.top - height;
		surface.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - width))}px`;
		surface.style.top = `${Math.max(0, Math.min(top, window.innerHeight - height))}px`;
	}
	// Exclude the trigger so its click can toggle the menu without reopening after dismissal.
	function outsidePointer(event: PointerEvent) {
		if (
			event.target instanceof Node &&
			!surface.contains(event.target) &&
			!anchor.contains(event.target)
		)
			dismiss();
	}
	onMount(() => {
		surface.showPopover();
		position();
		keyboard.activate(surface);
		const observer = new ResizeObserver(position);
		observer.observe(surface);
		window.addEventListener("resize", dismiss);
		document.addEventListener("pointerdown", outsidePointer, true);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", dismiss);
			document.removeEventListener("pointerdown", outsidePointer, true);
		};
	});
</script>

<div
	class="popup-menu"
	popover="manual"
	role="menu"
	tabindex="-1"
	aria-label={label}
	aria-activedescendant={active === null ? undefined : itemId(active.action)}
	bind:this={surface}
	onbeforetoggle={(event) => {
		if (event.newState === "closed") dismiss();
	}}
	use:keyboard.scope={{ transient: true, keydown, cancel: dismiss }}
>
	{#each items as item (item.action)}
		<button
			type="button"
			role="menuitem"
			tabindex="-1"
			class="popup-menu-item"
			class:highlighted={active?.action === item.action}
			id={itemId(item.action)}
			disabled={item.disabled}
			aria-disabled={item.disabled}
			onpointermove={() => {
				if (!item.disabled) selected = item.action;
			}}
			onclick={() => choose(item)}>{item.label}</button
		>
	{/each}
</div>

<style>
	@layer components {
		.popup-menu {
			position: fixed;
			inset: auto;
			margin: 0;
			padding: var(--ui-menu-padding);
			min-width: min(var(--ui-menu-min-width), 100vw);
			max-width: 100vw;
			max-height: 100vh;
			overflow: auto;
			border: 1px solid var(--ui-menu-border-color, var(--ui-color-border));
			border-radius: var(--ui-radius-control);
			background: var(--ui-menu-background, var(--ui-color-well));
			color: var(--ui-menu-color, var(--ui-color-text));
			box-shadow: var(--ui-menu-shadow, 0 4px 12px #0006);
			outline: none;
		}
		.popup-menu:popover-open {
			display: flex;
			flex-direction: column;
		}
		.popup-menu-item {
			display: block;
			width: 100%;
			flex: none;
			margin: 0;
			padding: var(--ui-menu-item-padding);
			border: 0;
			border-radius: 0;
			background: transparent;
			color: inherit;
			font: inherit;
			text-align: start;
			cursor: default;
		}
		.popup-menu-item.highlighted {
			background: var(--ui-menu-highlight-background, var(--ui-color-control));
			color: var(--ui-menu-highlight-color, var(--ui-color-highlight));
		}
		.popup-menu-item:disabled {
			color: var(--ui-menu-disabled-color, var(--ui-color-muted));
			opacity: 0.5;
		}
	}
</style>

<script lang="ts" module>
	/** Shared identity and presentation for a command or checked choice. */
	interface PopupMenuAction<Action extends string> {
		/** Stable identity, unique across the root and its child choices. */
		readonly action: Action;
		/** Visible command name and accessible menu-item label. */
		readonly label: string;
		/** Unavailable entries remain visible but cannot be selected. */
		readonly disabled: boolean;
	}

	/** A checked leaf stays open after selection and cannot open another submenu. */
	interface PopupMenuChoice<
		Action extends string,
	> extends PopupMenuAction<Action> {
		/** Checkbox toggles or one member of an exclusive radio group. */
		readonly selection: {
			readonly kind: "checkbox" | "radio";
			readonly checked: boolean;
		};
		/** Child choices are leaves; the popup owns exactly one submenu level. */
		readonly children?: never;
	}

	/** Commands dismiss; checked leaves stay open; a summary opens one menu of checked leaves. */
	export type PopupMenuItem<Action extends string> =
		| (PopupMenuAction<Action> & {
				readonly selection?: never;
				readonly children?: never;
		  })
		| PopupMenuChoice<Action>
		| (PopupMenuAction<Action> & {
				/** Summary checkmark describes the owner's current child selection. */
				readonly selection: {
					readonly kind: "summary";
					readonly checked: boolean;
				};
				/** Root-owned checked choices share keyboard input and dismissal. */
				readonly children: readonly PopupMenuChoice<Action>[];
		  });
</script>

<script
	lang="ts"
	generics="Action extends string, Item extends PopupMenuItem<Action>"
>
	import { onMount, type Snippet } from "svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	interface Props {
		/** Element trigger or captured viewport point; the caller owns trigger accessibility. */
		readonly anchor: HTMLElement | { readonly x: number; readonly y: number };
		/** Accessible name of the command menu. */
		readonly label: string;
		/** Ordered commands. Their identities must be unique within this menu. */
		readonly items: readonly (Item & PopupMenuItem<Action>)[];
		/** Dense symbol choices use a scrolling grid; ordinary command menus remain lists. */
		readonly layout?: "list" | "grid";
		/** Optional decorative artwork before each command label. */
		readonly icon?: Snippet<[Item]>;
		/** Commands dismiss before dispatch; checked choices stay open while the owner updates them. */
		readonly onselect: (action: Action) => void;
		/** The caller unmounts this open menu on dismissal. */
		readonly onclose: () => void;
	}
	let {
		anchor,
		label,
		items,
		icon,
		layout = "list",
		onselect,
		onclose,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	const id = $props.id();
	let surface: HTMLDivElement;
	let selected = $state<Item["action"] | null>(null);
	let closed = false;
	let childSurface = $state<HTMLDivElement>();
	let childOwner = $state<Action | null>(null);
	let childSelected = $state<Action | null>(null);
	const parent = $derived(
		items.find((item) => item.action === childOwner) ?? null,
	);
	const children = $derived(parent?.children ?? []);
	const childEnabled = $derived(children.filter((item) => !item.disabled));
	const childActive = $derived(
		childEnabled.find((item) => item.action === childSelected) ??
			childEnabled[0] ??
			null,
	);
	const checkedRows = $derived(
		items.some((item) => item.selection !== undefined),
	);
	function closeChild() {
		childOwner = null;
		childSelected = null;
	}
	function openChild(item: PopupMenuItem<Action>) {
		if (!item.children || item.disabled || childOwner === item.action) return;
		selected = item.action;
		childOwner = item.action;
		childSelected = null;
	}
	$effect(() => {
		if (childOwner !== null && !parent?.children) closeChild();
	});
	$effect(() => {
		if (parent !== null && childSurface) positionChild();
	});
	function positionChild() {
		if (!parent || !childSurface) return;
		// The themed root's backdrop filter creates a containing block. A nested top-layer
		// surface keeps viewport placement independent of that filter without another input owner.
		if (!childSurface.matches(":popover-open")) childSurface.showPopover();
		const row = document.getElementById(itemId(parent.action));
		if (!row) return;
		const rect = row.getBoundingClientRect();
		// Theme font metrics can produce fractional CSS pixels; offsetHeight rounds them.
		const { width, height } = childSurface.getBoundingClientRect();
		childSurface.style.left = `${Math.max(0, Math.min(rect.right + width <= window.innerWidth ? rect.right : rect.left - width, window.innerWidth - width))}px`;
		childSurface.style.top = `${Math.max(0, Math.min(rect.top, window.innerHeight - height))}px`;
	}
	const enabled = $derived(items.filter((item) => !item.disabled));
	const active = $derived(
		enabled.find((item) => item.action === selected) ?? enabled[0] ?? null,
	);
	const focusedItem = $derived(childOwner === null ? active : childActive);
	const itemId = (action: Item["action"]) =>
		`${id}-${encodeURIComponent(action)}`;
	function dismiss() {
		if (closed) return;
		closed = true;
		onclose();
	}
	function choose(item: PopupMenuItem<Action>) {
		if (closed || item.disabled) return;
		// Capture the callback before dismissal changes the caller's reactive menu props.
		if (item.children) {
			openChild(item);
			return;
		}
		const select = onselect;
		if (!item.selection) dismiss();
		select(item.action);
	}
	function keydown(event: KeyboardEvent) {
		const current: PopupMenuItem<Action> | null =
			childOwner === null ? active : childActive;
		const choices: readonly PopupMenuItem<Action>[] =
			childOwner === null ? enabled : childEnabled;
		const selectRow = (action: Action | null) => {
			if (childOwner === null) selected = action;
			else childSelected = action;
		};
		if (layout === "list" && event.key === "ArrowRight" && current?.children) {
			event.preventDefault();
			openChild(current);
			return;
		}
		if (
			(event.key === "ArrowLeft" || event.key === "Escape") &&
			childOwner !== null
		) {
			event.preventDefault();
			closeChild();
			return;
		}
		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp":
			case "ArrowLeft":
			case "ArrowRight": {
				if (
					layout === "list" &&
					(event.key === "ArrowLeft" || event.key === "ArrowRight")
				)
					return;
				event.preventDefault();
				if (current === null) return;
				const vertical = event.key === "ArrowDown" || event.key === "ArrowUp";
				const columns =
					layout === "grid" && vertical
						? getComputedStyle(surface).gridTemplateColumns.split(" ").length
						: 1;
				const direction =
					(event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1) *
					columns;
				const index = choices.indexOf(current);
				selectRow(
					choices[(index + direction + choices.length) % choices.length]
						?.action ?? null,
				);
				break;
			}
			case "Home":
				event.preventDefault();
				selectRow(choices[0]?.action ?? null);
				break;
			case "End":
				event.preventDefault();
				selectRow(choices.at(-1)?.action ?? null);
				break;
			case "Enter":
			case " ":
				event.preventDefault();
				if (!event.repeat && current !== null) choose(current);
				break;
			case "Escape":
			case "Tab":
				event.preventDefault();
				dismiss();
				break;
		}
		const scrollAction = childOwner === null ? selected : childSelected;
		if (scrollAction !== null)
			document
				.getElementById(itemId(scrollAction))
				?.scrollIntoView({ block: "nearest" });
	}
	function position() {
		const rect =
			anchor instanceof HTMLElement
				? anchor.getBoundingClientRect()
				: { left: anchor.x, top: anchor.y, bottom: anchor.y };
		const { width, height } = surface.getBoundingClientRect();
		const top =
			rect.bottom + height <= window.innerHeight
				? rect.bottom
				: rect.top - height;
		surface.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - width))}px`;
		surface.style.top = `${Math.max(0, Math.min(top, window.innerHeight - height))}px`;
		positionChild();
	}
	// Exclude the trigger so its click can toggle the menu without reopening after dismissal.
	function outsidePointer(event: PointerEvent) {
		if (
			event.target instanceof Node &&
			!surface.contains(event.target) &&
			!(anchor instanceof HTMLElement && anchor.contains(event.target))
		) {
			// A dismissal press belongs to the menu, not the canvas gesture beneath it.
			event.preventDefault();
			event.stopImmediatePropagation();
			dismiss();
		}
	}
	onMount(() => {
		surface.showPopover();
		position();
		keyboard.activate(surface);
		const observer = new ResizeObserver(position);
		observer.observe(surface);
		window.addEventListener("resize", dismiss);
		// Run before document-level input ownership can dismiss the menu and start a game press.
		window.addEventListener("pointerdown", outsidePointer, true);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", dismiss);
			window.removeEventListener("pointerdown", outsidePointer, true);
		};
	});
</script>

<div
	class="popup-menu ui-overlay-surface"
	class:symbol-grid={layout === "grid"}
	popover="manual"
	role="menu"
	tabindex="-1"
	aria-label={label}
	aria-activedescendant={focusedItem === null
		? undefined
		: itemId(focusedItem.action)}
	bind:this={surface}
	onscroll={positionChild}
	onbeforetoggle={(event) => {
		if (event.newState === "closed") dismiss();
	}}
	use:keyboard.scope={{ transient: true, keydown, cancel: dismiss }}
>
	{#each items as item (item.action)}
		<button
			type="button"
			role={item.selection?.kind === "checkbox"
				? "menuitemcheckbox"
				: item.selection?.kind === "radio"
					? "menuitemradio"
					: "menuitem"}
			aria-checked={item.selection?.kind === "summary"
				? undefined
				: item.selection?.checked}
			aria-haspopup={item.children ? "menu" : undefined}
			aria-expanded={item.children ? childOwner === item.action : undefined}
			aria-label={item.selection?.kind === "summary"
				? item.selection.checked
					? `${item.label}, selected`
					: `${item.label}, not selected`
				: undefined}
			tabindex="-1"
			class="popup-menu-item"
			class:highlighted={active?.action === item.action}
			id={itemId(item.action)}
			disabled={item.disabled}
			aria-disabled={item.disabled}
			title={layout === "grid" ? item.label : undefined}
			onpointermove={() => {
				if (!item.disabled) {
					selected = item.action;
					if (item.children) openChild(item);
					else closeChild();
				}
			}}
			onclick={() => choose(item)}
		>
			{#if checkedRows}<span class="popup-menu-check" aria-hidden="true"
					>{item.selection?.checked ? "✓" : ""}</span
				>{/if}
			{#if icon}
				<span class="popup-menu-icon" aria-hidden="true"
					>{@render icon(item)}</span
				>
				<span>{item.label}</span>
			{:else}{item.label}{/if}
			{#if item.children}<span class="popup-menu-arrow" aria-hidden="true"
					>›</span
				>{/if}
		</button>
	{/each}
	{#if parent !== null && parent.children}
		<div
			class="popup-menu-child ui-overlay-surface"
			popover="manual"
			role="menu"
			aria-label={parent.label}
			bind:this={childSurface}
		>
			{#each children as item (item.action)}
				<button
					type="button"
					role={item.selection.kind === "radio"
						? "menuitemradio"
						: "menuitemcheckbox"}
					aria-checked={item.selection.checked}
					tabindex="-1"
					id={itemId(item.action)}
					class="popup-menu-item"
					class:highlighted={childActive?.action === item.action}
					disabled={item.disabled}
					onpointermove={() => {
						if (!item.disabled) childSelected = item.action;
					}}
					onclick={() => choose(item)}
				>
					<span class="popup-menu-check" aria-hidden="true"
						>{item.selection.checked ? "✓" : ""}</span
					>{item.label}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	@layer components {
		.popup-menu,
		.popup-menu-child {
			position: fixed;
			box-sizing: border-box;
			inset: auto;
			margin: 0;
			padding: var(--ui-menu-padding);
			min-width: min(var(--ui-menu-min-width), 100vw);
			max-width: 100vw;
			max-height: 100vh;
			overflow: auto;
		}
		.popup-menu {
			outline: none;
		}
		.popup-menu-check {
			width: 1em;
			flex: none;
			text-align: center;
		}
		.popup-menu-arrow {
			margin-left: auto;
		}

		.popup-menu:popover-open {
			display: flex;
			flex-direction: column;
		}
		.popup-menu.symbol-grid {
			box-sizing: border-box;
			width: min(18rem, 100vw);
			min-width: 0;
			max-height: min(18rem, 100vh);
			overflow-x: hidden;
		}
		.popup-menu.symbol-grid:popover-open {
			display: grid;
			grid-template-columns: repeat(6, minmax(0, 1fr));
		}
		.symbol-grid .popup-menu-item {
			justify-content: center;
			min-width: 0;
			font-size: 1.75rem;
			line-height: 1;
			aspect-ratio: 1;
		}
		.popup-menu-item {
			display: flex;
			align-items: center;
			gap: var(--ui-overlay-gap);
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
			cursor: pointer;
		}
		.popup-menu-icon {
			width: var(--ui-overlay-icon-size);
			height: var(--ui-overlay-icon-size);
			flex: none;
		}
		.popup-menu-item.highlighted {
			background: var(--ui-menu-highlight-background, var(--ui-color-control));
			color: var(--ui-menu-highlight-color, var(--ui-color-highlight));
		}
		.popup-menu-item:disabled {
			cursor: default;
			color: var(--ui-menu-disabled-color, var(--ui-color-muted));
			opacity: var(--ui-menu-disabled-opacity);
		}
	}
</style>

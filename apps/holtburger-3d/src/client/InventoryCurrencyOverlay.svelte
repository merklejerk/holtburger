<script lang="ts">
	import { onMount, type Snippet } from "svelte";
	import ItemIcon from "../app/ItemIcon.svelte";
	import type { ItemIconDisplay } from "../app/item-icon-repository";
	import type { InventoryCurrencyRow } from "./client-inventory-state";

	interface Props {
		/** Footer trigger artwork and pyreal balance. */
		children: Snippet;
		/** Includes the currency name and balance because the artwork is decorative. */
		label: string;
		/** Inventory-state aggregates and their hydration status. */
		rows: readonly InventoryCurrencyRow[];
		pending: boolean;
		/** Images sampled by the panel under its display leases. */
		displays: ReadonlyMap<string, ItemIconDisplay>;
	}
	const { children, label, rows, pending, displays }: Props = $props();
	const id = $props.id();
	let trigger: HTMLButtonElement;
	let popup: HTMLDivElement;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	function cancelClose() {
		clearTimeout(closeTimer);
	}
	function close() {
		cancelClose();
		popup.hidePopover();
	}
	function position() {
		const rect = trigger.getBoundingClientRect();
		popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8))}px`;
		popup.style.top = `${Math.max(8, Math.min(rect.top - popup.offsetHeight - 4, window.innerHeight - popup.offsetHeight - 8))}px`;
	}
	function open() {
		cancelClose();
		popup.showPopover();
		position();
	}
	function scheduleClose() {
		cancelClose();
		closeTimer = setTimeout(() => {
			if (
				!trigger.matches(":hover, :focus") &&
				!popup.matches(":hover, :focus-within")
			)
				close();
		}, 150);
	}
	onMount(() => {
		const escape = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		const reposition = () => {
			if (popup.matches(":popover-open")) position();
		};
		const observer = new ResizeObserver(reposition);
		observer.observe(popup);
		observer.observe(trigger);
		window.addEventListener("keydown", escape);
		window.addEventListener("resize", reposition);
		window.addEventListener("scroll", reposition, true);
		return () => {
			cancelClose();
			observer.disconnect();
			window.removeEventListener("keydown", escape);
			window.removeEventListener("resize", reposition);
			window.removeEventListener("scroll", reposition, true);
		};
	});
</script>

<button
	bind:this={trigger}
	type="button"
	class="inventory-currency ui-hud-button"
	aria-label={label}
	aria-describedby={id}
	onpointerenter={open}
	onpointerleave={scheduleClose}
	onfocus={open}
	onblur={scheduleClose}
	onclick={open}
>
	{@render children()}
</button>
<div
	bind:this={popup}
	{id}
	popover="manual"
	role="tooltip"
	class="inventory-currency-overlay"
	onpointerenter={cancelClose}
	onpointerleave={scheduleClose}
>
	<strong>Alternate currencies</strong>
	{#if pending}<p role="status">Updating inventory…</p>
	{:else if rows.length === 0}<p>No alternate currencies carried.</p>
	{:else}
		<dl>
			{#each rows as row (row.wcid)}
				<div class="currency-row">
					<dt>
						<span class="currency-icon"
							><ItemIcon
								display={displays.get(row.iconKey)}
								name=""
								tooltipLabel={row.name}
							/></span
						><span>{row.name}</span>
					</dt>
					<dd>{row.count.toLocaleString()}</dd>
				</div>
			{/each}
		</dl>
	{/if}
</div>

<style>
	@layer components {
		.inventory-currency {
			display: inline-flex;
			align-items: center;
			gap: 0.35em;
		}
		.inventory-currency-overlay {
			white-space: normal;
			overflow-wrap: anywhere;
			position: fixed;
			inset: auto;
			margin: 0;
			padding: 10px;
			width: max-content;
			max-width: min(360px, calc(100vw - 16px));
			max-height: min(360px, calc(100vh - 16px));
			overflow: auto;
			background: var(--ui-color-well);
			color: var(--ui-color-text);
			border: 1px solid var(--ui-color-border);
			border-radius: var(--ui-radius-control);
		}
		p,
		dl {
			margin: 8px 0 0;
		}
		.currency-row {
			display: flex;
			align-items: center;
			gap: 16px;
			margin-top: 6px;
		}
		dt {
			display: flex;
			align-items: center;
			gap: 8px;
			flex: 1;
			min-width: 0;
		}
		dd {
			margin: 0;
			font-variant-numeric: tabular-nums;
		}
		.currency-icon {
			container: currency-art / inline-size;
			width: var(--ui-inventory-currency-icon-size);
			height: var(--ui-inventory-currency-icon-size);
			flex: none;
		}
		.currency-icon :global(.item-icon) {
			--ui-item-icon-rendering: var(
				--ui-inventory-currency-icon-upsample-filter
			);
		}
		@container currency-art (width < 32px) {
			.currency-icon :global(.item-icon) {
				--ui-item-icon-rendering: var(
					--ui-inventory-currency-icon-downsample-filter
				);
			}
		}
	}
</style>

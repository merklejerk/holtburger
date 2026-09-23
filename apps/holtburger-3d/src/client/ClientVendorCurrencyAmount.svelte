<script lang="ts">
	import UiIcon from "../app/UiIcon.svelte";
	import type { UiIconDisplay } from "../app/ui-icon-repository";

	interface Props {
		/** Vendor payment or sale currency, named in the tooltip and accessible label. */
		readonly name: string;
		/** Artwork leased by the vendor state; a neutral glyph stands in while unavailable. */
		readonly display: UiIconDisplay | undefined;
		/** Current price, balance, or queue total. */
		readonly amount: number;
		/** Balance after the queued trade, if a draft exists. */
		readonly projected?: number;
	}
	const { name, display, amount, projected }: Props = $props();
	const summary = $derived.by(() => {
		const current = amount.toLocaleString();
		if (projected === undefined)
			return { current, change: null, label: `${current} ${name}` };
		const after = projected.toLocaleString();
		const deltaValue = projected - amount;
		const delta = deltaValue.toLocaleString(undefined, {
			signDisplay: "exceptZero",
		});
		return {
			current,
			change: {
				after,
				delta,
				afterNegative: projected < 0,
			},
			label: `${current} to ${after} (${delta}) ${name}`,
		};
	});
</script>

<span
	class="vendor-currency-amount"
	role="img"
	aria-label={summary.label}
	title={name}
>
	<span class="currency-icon"
		><UiIcon {display} name="¤" tooltipLabel={name} /></span
	>
	<span
		>{summary.current}{#if summary.change !== null}
			→ <span class:negative={summary.change.afterNegative}
				>{summary.change.after}</span
			>
			<span class="currency-delta">({summary.change.delta})</span>{/if}</span
	>
</span>

<style>
	@layer components {
		.vendor-currency-amount {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			white-space: nowrap;
			font-variant-numeric: tabular-nums;
		}
		.negative {
			color: var(--ui-color-danger);
		}
		.currency-icon {
			container: vendor-currency-art / inline-size;
			width: var(--ui-inventory-currency-icon-size);
			height: var(--ui-inventory-currency-icon-size);
			flex: none;
		}
		.currency-icon :global(.ui-icon) {
			--ui-icon-rendering: var(--ui-inventory-currency-icon-upsample-filter);
		}
		@container vendor-currency-art (width < 32px) {
			.currency-icon :global(.ui-icon) {
				--ui-icon-rendering: var(
					--ui-inventory-currency-icon-downsample-filter
				);
			}
		}
	}
</style>

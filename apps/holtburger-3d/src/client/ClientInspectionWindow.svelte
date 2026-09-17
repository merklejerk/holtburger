<script lang="ts">
	import type { UiIconRepository } from "../app/ui-icon-repository";
	import ClientCreatureInspection from "./ClientCreatureInspection.svelte";
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import ClientItemInspection from "./ClientItemInspection.svelte";
	import type { ClientSpellServices } from "./client-spells";
	import type { ObjectInspection } from "./client-object-inspection-contract";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";

	interface Props {
		readonly inspection: ObjectInspection;
		readonly spells: ClientSpellServices | null;
		readonly icons: UiIconRepository | null;
		readonly placement: ClientHudPlacement;
		readonly viewport: ClientHudViewport;
		readonly onClose: () => void;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
	}
	const {
		inspection,
		spells,
		icons,
		placement,
		viewport,
		onClose,
		onPlacementChange,
	}: Props = $props();
</script>

<ClientHudWindow
	icon="examine"
	title={inspection.name}
	{placement}
	{viewport}
	{onClose}
	{onPlacementChange}
	minWidth={CLIENT_UI_DEFAULTS.inspection.minSize.width}
	minHeight={CLIENT_UI_DEFAULTS.inspection.minSize.height}
>
	<div class="inspection-scroll">
		{#if inspection.details.kind === "item"}
			<ClientItemInspection
				{inspection}
				item={inspection.details.details}
				{spells}
				{icons}
			/>
		{:else}
			<ClientCreatureInspection
				{inspection}
				creature={inspection.details.details}
			/>
		{/if}
	</div>
</ClientHudWindow>

<style>
	@layer components {
		.inspection-scroll {
			height: 100%;
			overflow: auto;
			scrollbar-gutter: stable;
		}
		.inspection-scroll :global(.inspection-body) {
			display: grid;
			gap: 14px;
			padding: 16px;
			line-height: 1.35;
		}
		.inspection-scroll :global(h2),
		.inspection-scroll :global(h3),
		.inspection-scroll :global(p),
		.inspection-scroll :global(dl),
		.inspection-scroll :global(dd),
		.inspection-scroll :global(ul),
		.inspection-scroll :global(blockquote) {
			margin: 0;
		}
		.inspection-scroll :global(h2) {
			font-size: 1.18rem;
			color: var(--ui-color-highlight);
		}
		.inspection-scroll :global(h3) {
			margin-bottom: 7px;
			padding-bottom: 3px;
			border-bottom: 1px solid
				color-mix(in srgb, var(--ui-color-border) 55%, transparent);
			font-size: 0.86rem;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--ui-color-accent);
		}
		.inspection-scroll :global(.inspection-hero),
		.inspection-scroll :global(.inspection-creature-hero) {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			align-items: center;
			gap: 14px;
		}
		.inspection-scroll :global(.inspection-kicker),
		.inspection-scroll :global(.inspection-diagnostic),
		.inspection-scroll :global(.inspection-scribe) {
			color: var(--ui-color-muted);
			font-size: 0.78rem;
		}
		.inspection-scroll :global(.inspection-description) {
			margin-top: 5px;
			white-space: pre-wrap;
		}
		.inspection-scroll :global(.inspection-artwork) {
			display: grid;
			justify-items: center;
			gap: 4px;
			width: 84px;
			text-align: center;
		}
		.inspection-scroll :global(.inspection-artwork-image) {
			display: grid;
			place-items: center;
			width: 64px;
			height: 64px;
			padding: 6px;
			border: 1px solid var(--ui-color-border);
			background: var(--ui-color-well);
			font-size: 1.5rem;
		}
		.inspection-scroll :global(.inspection-warning) {
			color: var(--ui-color-warning);
		}
		.inspection-scroll :global(.inspection-facts),
		.inspection-scroll :global(.inspection-attributes) {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 5px 16px;
		}
		.inspection-scroll :global(.inspection-facts > div),
		.inspection-scroll :global(.inspection-attributes > div) {
			display: flex;
			justify-content: space-between;
			gap: 8px;
			min-width: 0;
		}
		.inspection-scroll :global(.inspection-wide) {
			grid-column: 1 / -1;
		}
		.inspection-scroll :global(dt) {
			color: var(--ui-color-muted);
		}
		.inspection-scroll :global(dd) {
			text-align: right;
			overflow-wrap: anywhere;
		}
		.inspection-scroll :global(.inspection-enchantment-beneficial) {
			color: var(--ui-color-success);
		}
		.inspection-scroll :global(.inspection-enchantment-harmful) {
			color: var(--ui-color-danger);
		}
		.inspection-scroll :global(.inspection-unbuffed) {
			margin-left: 0.35em;
			color: var(--ui-color-muted);
			white-space: nowrap;
		}
		.inspection-scroll :global(ul) {
			padding-left: 20px;
		}
		.inspection-scroll :global(li + li) {
			margin-top: 3px;
		}
		.inspection-scroll :global(blockquote) {
			padding-left: 10px;
			border-left: 2px solid var(--ui-color-accent);
			white-space: pre-wrap;
		}
		.inspection-scroll :global(.inspection-scribe) {
			margin-top: 5px;
			text-align: right;
		}
		.inspection-scroll :global(.inspection-creature) {
			background: linear-gradient(
				145deg,
				color-mix(in srgb, var(--ui-color-danger) 8%, transparent),
				transparent 35%
			);
		}
		.inspection-scroll :global(.inspection-creature-mark) {
			display: grid;
			place-items: center;
			width: 58px;
			height: 58px;
			border: 1px solid var(--ui-color-danger);
			border-radius: 50%;
			color: var(--ui-color-danger);
			font-size: 1.4rem;
		}
		.inspection-scroll :global(.inspection-creature-description) {
			padding: 9px 11px;
			border-left: 2px solid var(--ui-color-danger);
			background: color-mix(in srgb, var(--ui-color-well) 75%, transparent);
		}
		.inspection-scroll :global(.inspection-vitals) {
			display: grid;
			gap: 8px;
		}
		.inspection-scroll :global(.inspection-vital > div) {
			display: flex;
			justify-content: space-between;
			margin-bottom: 3px;
		}
		.inspection-scroll :global(progress) {
			display: block;
			width: 100%;
			height: 10px;
			accent-color: var(--ui-color-health);
		}
		.inspection-scroll :global(.inspection-stamina progress) {
			accent-color: var(--ui-color-stamina);
		}
		.inspection-scroll :global(.inspection-mana progress) {
			accent-color: var(--ui-color-mana);
		}
		@media (max-width: 360px) {
			.inspection-scroll :global(.inspection-facts),
			.inspection-scroll :global(.inspection-attributes) {
				grid-template-columns: 1fr;
			}
		}
	}
</style>

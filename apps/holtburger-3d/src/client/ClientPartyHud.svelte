<script lang="ts">
	import { CLIENT_HUD_VITALS } from "./client-hud-vitals";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import ClientHudPanel from "./ClientHudPanel.svelte";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	import {
		PARTY_HUD_PREVIEW,
		PARTY_HUD_MAXIMUM_COLUMNS,
		readPartyHudGeometry,
		type PartyHudGeometry,
		partyVitalDisplay,
		type PartyHudDisplay,
	} from "./client-party-hud";
	import { CLIENT_TUNING } from "./client-tuning";

	interface Props {
		/** Coherent retained roster, independent of scene entities and management state. */
		readonly readPartyHudDisplay: () => PartyHudDisplay | null;
		/** Layout-only placeholder; the parent owns live subscription demand. */
		readonly preview: boolean;
		/** Select through the app-owned target identity owner. */
		readonly onSelectEntity: (guid: number) => void;
		/** Saved window geometry remains independent of themed cell dimensions. */
		readonly placement: ClientHudPlacement;
		/** Usable game viewport, allowing the shared shell to fit themed minima. */
		readonly viewport: ClientHudViewport;
		/** Layout mode exposes the shared move and resize controls. */
		readonly editable: boolean;
		/** App-owned admission for the resize affordance. */
		readonly resizable: boolean;
		/** Persist geometry edits through the existing layout owner. */
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
	}
	const {
		readPartyHudDisplay,
		preview,
		onSelectEntity,
		placement,
		viewport,
		editable,
		resizable,
		onPlacementChange,
	}: Props = $props();
	let geometry = $state<PartyHudGeometry | null>(null);
	/** The probe depends only on theme CSS, so resizing the panel cannot feed back into it. */
	function measureTheme(node: HTMLElement) {
		const update = () => {
			geometry = readPartyHudGeometry(node);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(node, { box: "border-box" });
		return { destroy: () => observer.disconnect() };
	}
	let party = $state<PartyHudDisplay | null>(null);
	const display = $derived(preview ? PARTY_HUD_PREVIEW : party);
	/** Host tuple indices describe wire facts independently of the shared display order. */
	const vitalIndices = {
		health: { current: 0, maximum: 3 },
		mana: { current: 2, maximum: 5 },
		stamina: { current: 1, maximum: 4 },
	} as const;

	$effect(() => {
		if (preview) return;
		const read = readPartyHudDisplay;
		party = read();
		const interval = window.setInterval(() => {
			party = read();
		}, CLIENT_TUNING.partyHud.displayIntervalMs);
		return () => window.clearInterval(interval);
	});
</script>

<div
	class="party-hud party-hud-theme-metrics"
	use:measureTheme
	aria-hidden="true"
></div>
{#if geometry !== null}
	<ClientHudPanel
		label="Party HUD"
		{placement}
		{viewport}
		{editable}
		{resizable}
		{onPlacementChange}
		minWidth={geometry.cellSize.width}
		minHeight={geometry.cellSize.height}
		contentHitTesting="descendants"
	>
		<section
			class="party-hud"
			style:--party-maximum-columns={PARTY_HUD_MAXIMUM_COLUMNS}
			aria-label={preview ? "Party HUD preview" : "Party vitals"}
		>
			{#if display !== null}
				{#each display.members as member (member.guid)}
					<button
						type="button"
						class="party-member ui-hud-control ui-hud-surface"
						aria-label={`Select ${member.name}`}
						disabled={preview || editable}
						onclick={() => onSelectEntity(member.guid)}
					>
						<span class="party-member__name ui-readout" title={member.name}>
							{#if member.guid === display.leader}
								<span
									class="party-member__leader"
									role="img"
									aria-label="Party leader"
									><ClientHudIcon name="leader" /></span
								>
							{/if}
							<strong>{member.name}</strong>
						</span>
						{#each CLIENT_HUD_VITALS as bar}
							{@const value = partyVitalDisplay(
								member.vitals[vitalIndices[bar.kind].current],
								member.vitals[vitalIndices[bar.kind].maximum],
							)}
							<span
								class={`party-member__vital ui-meter ui-meter--${bar.kind}`}
								style:height={`var(--ui-party-${bar.kind}-height)`}
								role="meter"
								aria-label={`${member.name}: ${bar.label}`}
								aria-valuemin="0"
								aria-valuemax="100"
								aria-valuenow={value.percent ?? undefined}
								aria-valuetext={value.quantity}
								title={`${bar.label}: ${value.quantity}`}
							>
								{#if value.percent !== null}<span
										class="vital-fill"
										style:width={`${value.percent}%`}
									></span>{/if}
							</span>
						{/each}
					</button>
				{/each}
			{/if}
		</section>
	</ClientHudPanel>
{/if}

<style>
	@layer components {
		.party-hud {
			/* Fit both name text and leader artwork; vital bars retain their own sizing policy. */
			--_ui-party-name-font-size: calc(
				var(--ui-party-name-font-size) * var(--ui-text-scale)
			);
			--_ui-party-name-height: max(
				var(--ui-party-name-height),
				calc(var(--_ui-party-name-font-size) * var(--ui-line-height-body)),
				calc(var(--ui-party-leader-icon-size) * var(--ui-icon-scale))
			);
			/* Resolve dependent row dimensions at the consumer so scoped theme overrides work. */
			--_ui-party-cell-height: calc(
				var(--_ui-party-name-height) + var(--ui-party-health-height) +
					var(--ui-party-stamina-height) + var(--ui-party-mana-height) + 3 *
					var(--ui-party-vital-gap)
			);
			display: grid;
			/* Roster rows extend past the saved panel height without clipping or scrolling. */
			overflow: visible;
			pointer-events: auto;
			/* Keep themed cell dimensions fixed. Width changes the number of columns;
			 * viewport fitting may shrink a single cell when even its minimum cannot fit. */
			grid-template-columns: repeat(
				auto-fill,
				minmax(
					min(100%, var(--ui-party-cell-width)),
					min(100%, var(--ui-party-cell-width))
				)
			);
			max-width: calc(
				var(--party-maximum-columns) * var(--ui-party-cell-width) +
					(var(--party-maximum-columns) - 1) * var(--ui-party-grid-gap)
			);
			gap: var(--ui-party-grid-gap);
			grid-auto-rows: var(--_ui-party-cell-height);
		}
		.party-hud-theme-metrics {
			position: fixed;
			left: -10000px;
			top: 0;
			visibility: hidden;
			pointer-events: none;
			box-sizing: content-box;
			width: var(--ui-party-cell-width);
			height: var(--_ui-party-cell-height);
			max-width: none;
			max-height: none;
			overflow: hidden;
		}
		.party-member {
			padding: 0;
			text-align: start;
			min-width: 0;
			display: grid;
			grid-template-rows: var(--_ui-party-name-height);
			gap: var(--ui-party-vital-gap);
		}
		.party-member::before {
			/* Keep each backing within its fixed cell. */
			inset: 0;
		}
		.party-member__name {
			display: flex;
			align-items: center;
			gap: var(--ui-party-name-gap);
			min-width: 0;
			font-size: var(--_ui-party-name-font-size);
			line-height: var(--_ui-party-name-height);
		}
		.party-member__name strong {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.party-member__leader {
			width: calc(var(--ui-party-leader-icon-size) * var(--ui-icon-scale));
			height: calc(var(--ui-party-leader-icon-size) * var(--ui-icon-scale));
			flex: none;
		}
		.party-member__leader :global(svg) {
			width: 100%;
			height: 100%;
		}
		.party-member__vital {
			min-height: 0;
		}
	}
</style>

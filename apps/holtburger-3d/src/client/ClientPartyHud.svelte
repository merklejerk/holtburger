<script lang="ts">
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
	const bars = [
		{ kind: "health", label: "Health", current: 0, maximum: 3 },
		{ kind: "stamina", label: "Stamina", current: 1, maximum: 4 },
		{ kind: "mana", label: "Mana", current: 2, maximum: 5 },
	] as const;

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
		minWidth={geometry.cellSize.width + geometry.scrollbarAllowance}
		minHeight={geometry.cellSize.height}
		contentHitTesting="descendants"
	>
		<div
			class="party-hud-scroll"
			style:--party-maximum-columns={PARTY_HUD_MAXIMUM_COLUMNS}
		>
			<section
				class="party-hud"
				aria-label={preview ? "Party HUD preview" : "Party vitals"}
			>
				{#if display !== null}
					{#each display.members as member (member.guid)}
						<div class="party-member ui-hud-surface">
							<div class="party-member__name ui-readout" title={member.name}>
								{#if member.guid === display.leader}
									<span
										class="party-member__leader"
										role="img"
										aria-label="Party leader"
										><ClientHudIcon name="leader" /></span
									>
								{/if}
								<strong>{member.name}</strong>
							</div>
							{#each bars as bar}
								{@const value = partyVitalDisplay(
									member.vitals[bar.current],
									member.vitals[bar.maximum],
								)}
								<div
									class={`party-member__vital ui-meter ui-meter--${bar.kind}`}
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
								</div>
							{/each}
						</div>
					{/each}
				{/if}
			</section>
		</div>
	</ClientHudPanel>
{/if}

<style>
	@layer components {
		.party-hud {
			/* Resolve dependent row dimensions at the consumer so scoped theme overrides work. */
			--_ui-party-cell-height: calc(
				var(--ui-party-name-height) + var(--ui-party-health-height) +
					var(--ui-party-stamina-height) + var(--ui-party-mana-height) + 3 *
					var(--ui-party-vital-gap)
			);
			display: grid;
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
		.party-hud-scroll {
			/* Scrollbar spacing cannot admit additional tracks into the inner grid. */
			max-height: 100%;
			overflow: auto;
			/* Reserve scroll space so adding a scrollbar cannot oscillate the column count. */
			scrollbar-gutter: stable;
			pointer-events: auto;
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
			padding-right: var(--ui-party-scrollbar-allowance);
			max-width: none;
			max-height: none;
			overflow: hidden;
			scrollbar-gutter: auto;
		}
		.party-member {
			min-width: 0;
			display: grid;
			grid-template-rows:
				var(--ui-party-name-height) var(--ui-party-health-height)
				var(--ui-party-stamina-height) var(--ui-party-mana-height);
			gap: var(--ui-party-vital-gap);
		}
		.party-member__name {
			display: flex;
			align-items: center;
			gap: var(--ui-party-name-gap);
			min-width: 0;
			font-size: var(--ui-party-name-font-size);
			line-height: var(--ui-party-name-height);
		}
		.party-member__name strong {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.party-member__leader {
			width: var(--ui-party-leader-icon-size);
			height: var(--ui-party-leader-icon-size);
			flex: none;
		}
		.party-member__leader :global(svg) {
			width: 100%;
			height: 100%;
		}
		.party-member__vital {
			height: auto;
			min-height: 0;
		}
	}
</style>

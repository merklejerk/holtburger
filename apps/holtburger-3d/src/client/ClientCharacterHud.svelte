<script lang="ts">
	import { untrack } from "svelte";
	import { CLIENT_HUD_VITALS } from "./client-hud-vitals";
	import { CLIENT_TUNING } from "./client-tuning";
	import type { ClientCharacterSheetState } from "./client-character-sheet-state";
	import type { CharacterSheet } from "./client-character-sheet-contract";
	import ClientConnectionBadge from "./ClientConnectionBadge.svelte";
	import type { ClientConnectionObservation } from "./client-lifecycle-session";
	import type { ClientVital } from "./client-host-contract";
	import { formatQuantity, progressPercent } from "../app/quantity-format";
	import { observeUiTheme } from "../app/ui-theme";

	interface Props {
		/** Reader for the browser session-owned transport observation. */
		readonly readConnection: () => ClientConnectionObservation | null;
		readonly playerName: string | null;
		readonly worldName: string | null;
		readonly vitals: readonly ClientVital[];
		/** Session-owned progression; sampled at the character sheet's display cadence. */
		readonly characterSheet: ClientCharacterSheetState | null;
		/** Natural text/bar height owns the outer HUD rectangle independently of saved placement. */
		readonly onContentHeightChange: (height: number) => void;
	}

	const {
		playerName,
		worldName,
		vitals,
		readConnection,
		characterSheet,
		onContentHeightChange,
	}: Props = $props();
	let focusedKind = $state<ClientVital["kind"]>("health");
	/** Only the level facts used by the identity and XP bar enter the bounded HUD display graph. */
	let level = $state.raw<CharacterSheet["level"] | null>(null);
	/** Measure intrinsic rows independently of the outer rectangle so theme changes can grow or shrink it. */
	function measureContentHeight(node: HTMLElement) {
		const rows = Array.from(node.children);
		const update = () => {
			const gap = Number.parseFloat(getComputedStyle(node).rowGap);
			if (!Number.isFinite(gap))
				throw new Error("Character HUD row gap must resolve to a CSS length");
			onContentHeightChange(
				rows.reduce(
					(height, row) => height + row.getBoundingClientRect().height,
					gap,
				),
			);
		};
		const stopTheme = observeUiTheme(node, update);
		const observer = new ResizeObserver(update);
		for (const row of rows) observer.observe(row);
		return {
			destroy: () => {
				observer.disconnect();
				stopTheme();
			},
		};
	}

	$effect(() => {
		const owner = characterSheet;
		let revision = -1;
		function sample(): void {
			const next = owner?.read();
			if (next === undefined) {
				level = null;
			} else if (next.revision !== revision) {
				revision = next.revision;
				level = next.sheet?.level ?? null;
			}
		}
		// Session identity owns the timer; sampled display facts must not restart it.
		untrack(sample);
		if (owner === null) return;
		const timer = window.setInterval(
			sample,
			CLIENT_TUNING.characterSheet.displayIntervalMs,
		);
		return () => window.clearInterval(timer);
	});
	/** Fill and exact hover/accessibility text share the level-cap decision. */
	const xpProgress = $derived.by(() => {
		if (level === null) return { percent: 0, description: undefined };
		const maximum = BigInt(level.xpForNextLevel);
		// At the level cap, zero means there is no next level to fill.
		if (maximum === 0n)
			return {
				percent: 100,
				description: `Maximum level · ${formatQuantity(BigInt(level.currentXp))} total XP`,
			};
		const current = BigInt(level.xpIntoLevel);
		return {
			percent: progressPercent(current, maximum),
			description: `${formatQuantity(current)} / ${formatQuantity(maximum)} XP`,
		};
	});

	function vital(kind: ClientVital["kind"]): ClientVital | undefined {
		return vitals.find((candidate) => candidate.kind === kind);
	}

	function fillPercent(value: ClientVital | undefined): number {
		if (!value || value.maximum === 0) return 0;
		return Math.max(0, Math.min(100, (value.current / value.maximum) * 100));
	}

	function quantity(value: ClientVital | undefined): string {
		return value
			? `${formatQuantity(value.current)} / ${formatQuantity(value.maximum)}`
			: "—";
	}
</script>

<section class="character-hud" use:measureContentHeight>
	<div class="identity-block">
		<header class="ui-readout">
			<span class="identity">
				{playerName ??
					"Awaiting character"}{#if playerName !== null && level !== null}
					<span class="level ui-muted">{" "}({level.level})</span>
				{/if}
			</span>
			<span class="server">
				<span class="world-name">on {worldName ?? "Unknown world"}</span>
				<ClientConnectionBadge {readConnection} />
			</span>
		</header>
		<progress
			class="xp-progress ui-progress"
			aria-label="Level experience"
			title={xpProgress.description}
			aria-valuetext={xpProgress.description}
			max="100"
			value={xpProgress.percent}
		></progress>
	</div>
	<div
		class="vitals"
		role="group"
		aria-label="Character vitals"
		onpointerleave={() => (focusedKind = "health")}
	>
		{#each CLIENT_HUD_VITALS as bar}
			{@const value = vital(bar.kind)}
			<div
				class={`vital ui-meter ui-meter--${bar.kind}`}
				data-focused={focusedKind === bar.kind}
				role="meter"
				aria-label={bar.label}
				aria-valuemin="0"
				aria-valuemax={value?.maximum ?? 0}
				aria-valuenow={value?.current ?? 0}
				aria-valuetext={quantity(value)}
				onpointerenter={() => (focusedKind = bar.kind)}
			>
				<span class="vital-fill" style:width={`${fillPercent(value)}%`}></span>
				<strong class="ui-readout" aria-hidden={focusedKind !== bar.kind}
					>{quantity(value)}</strong
				>
			</div>
		{/each}
	</div>
</section>

<style>
	@layer components {
		.character-hud {
			display: grid;
			box-sizing: border-box;
			/* Fit the painted HUD to its rows, independently of saved layout height. */
			height: fit-content;
			grid-template-rows: min-content min-content;
			align-content: start;
			gap: var(--ui-character-hud-gap);
		}
		.identity-block {
			display: grid;
			grid-template-rows: auto var(--ui-character-hud-xp-height);
			min-width: 0;
		}
		.xp-progress {
			display: block;
			height: var(--ui-character-hud-xp-height);
			border-radius: 0;
		}
		header {
			display: flex;
			align-items: center;
			gap: var(--ui-character-hud-inline-gap);
			min-width: 0;
			font-weight: 700;
		}
		.identity {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.level {
			font-weight: 400;
		}
		.server {
			display: flex;
			align-items: center;
			gap: var(--ui-character-hud-inline-gap);
			min-width: 0;
			margin-inline-start: auto;
		}
		.world-name {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: var(--ui-character-hud-server-color, var(--ui-color-muted));
			font-weight: var(--ui-character-hud-server-font-weight);
			font-style: var(--ui-character-hud-server-font-style);
		}
		.vitals {
			display: flex;
			flex-direction: column;
			/* Contiguous bars: the focused row gets half the area for its scaled text line. */
			block-size: max(
				36px,
				calc(
					2 * var(--ui-font-size-micro) * var(--ui-text-scale) *
						var(--ui-line-height-body)
				)
			);
		}
		.vital {
			position: relative;
			flex: 1 1 0;
			min-block-size: 0;
			height: auto;
			transition: flex-grow 140ms var(--ui-easing);
		}
		.vital[data-focused="true"] {
			flex-grow: 2;
		}
		.vital-fill {
			transition: width 120ms linear;
		}
		.vital strong {
			position: absolute;
			top: 0;
			left: 50%;
			transform: translateX(-50%);
			font-size: calc(var(--ui-font-size-micro) * var(--ui-text-scale));
			line-height: var(--ui-line-height-body);
			padding-block: 0;
			padding-inline: calc(14px + 3px);
			white-space: nowrap;
			opacity: 0;
			visibility: hidden;
			transition:
				opacity 100ms linear,
				visibility 0s 100ms;
		}
		.vital[data-focused="true"] strong {
			opacity: 1;
			visibility: visible;
			transition-delay: 40ms, 0s;
		}
		@media (prefers-reduced-motion: reduce) {
			.vital,
			.vital-fill,
			.vital strong {
				transition: none;
			}
		}
	}
</style>

<script lang="ts">
	import { untrack } from "svelte";
	import Sparkle from "../assets/icons/xp-sparkle.svg?component";
	import { createXpFeedback, xpPresentation } from "./client-xp-feedback";
	import { CLIENT_HUD_VITALS } from "./client-hud-vitals";
	import { CLIENT_TUNING } from "./client-tuning";
	import type { ClientCharacterSheetState } from "./client-character-sheet-state";
	import ClientConnectionBadge from "./ClientConnectionBadge.svelte";
	import type { ClientConnectionObservation } from "./client-lifecycle-session";
	import type { ClientVital } from "./client-host-contract";
	import { formatQuantity } from "../app/quantity-format";
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
	/** Identity-label level, sampled at the character sheet display cadence. */
	let level = $state<number | null>(null);
	/** Mounted identity markup owns the imperative XP animation lifetime. */
	let identityBlock = $state<HTMLElement | null>(null);
	/** Exact progress text and target fill, sampled at the same bounded display cadence. */
	let xpProgress = $state.raw(xpPresentation(null));
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
		const node = identityBlock;
		if (node === null) return;
		const feedback = createXpFeedback(node);
		let revision = -1;
		function sample(): void {
			const next = owner?.read();
			if (next !== undefined && next.revision === revision) return;
			revision = next?.revision ?? -1;
			const sheet = next?.sheet ?? null;
			level = sheet?.level.level ?? null;
			const presentation = xpPresentation(sheet?.level ?? null);
			xpProgress = presentation;
			feedback.update(sheet, presentation.percent);
		}
		// Snapshot resets (including the same character) retire effects without replay.
		const unsubscribe = owner?.subscribeGains((gain) => {
			if (gain === null) feedback.reset();
		});
		// Only owner and mounted markup own this timer, never sampled display facts.
		untrack(sample);
		const timer =
			owner === null
				? null
				: window.setInterval(
						sample,
						CLIENT_TUNING.characterSheet.displayIntervalMs,
					);
		return () => {
			if (timer !== null) window.clearInterval(timer);
			unsubscribe?.();
			feedback.destroy();
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
	<div class="identity-block" bind:this={identityBlock}>
		<header class="ui-readout">
			<span class="identity">{playerName ?? "Awaiting character"}</span>
			<span
				class="level ui-muted"
				hidden={playerName === null || level === null}>({level})</span
			>
			<span class="server">
				<span class="world-name">on {worldName ?? "Unknown world"}</span>
				<ClientConnectionBadge {readConnection} />
			</span>
		</header>
		<div class="xp-track">
			<progress
				class="xp-progress ui-progress"
				aria-label="Level experience"
				title={xpProgress.description}
				aria-valuetext={xpProgress.description}
				max="100"
				value={xpProgress.percent}
			></progress>
			<span class="xp-fill" aria-hidden="true"></span>
			<span class="xp-edge" aria-hidden="true"></span>
			<span class="xp-sparkles" aria-hidden="true">
				{#each Array(CLIENT_TUNING.xpFeedback.sparkleCapacity) as _, index (index)}
					<span class="xp-sparkle"><Sparkle /></span>
				{/each}
			</span>
		</div>
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
			/* Animation-owned amplitude; theme tokens own the visual response. */
			--xp-celebration-pulse: 0;
			display: grid;
			grid-template-rows: auto var(--ui-character-hud-xp-height);
			min-width: 0;
		}
		.xp-track {
			position: relative;
			/* Falling effects must paint above the later vital rows and their labels. */
			z-index: 1;
			min-width: 0;
			color: var(--ui-character-xp-color, var(--ui-color-success));
		}
		.identity-block:global([data-xp-celebration]) .xp-track {
			color: var(--ui-xp-celebration-color);
			filter: brightness(
				calc(
					1 + var(--ui-xp-celebration-brightness) * var(--xp-celebration-pulse)
				)
			);
		}
		.identity-block:global([data-xp-celebration="level-up"]) .level {
			color: var(--ui-xp-celebration-color);
		}
		.xp-fill {
			position: absolute;
			inset: 0;
			background-color: currentColor;
			background-image: var(--ui-progress-fill-image);
			transform-origin: left;
			transform: scaleX(0);
			pointer-events: none;
		}
		.xp-progress::-webkit-progress-value {
			opacity: 0;
		}
		.xp-progress::-moz-progress-bar {
			opacity: 0;
		}
		.xp-edge {
			position: absolute;
			top: calc(-1 * var(--ui-xp-edge-outset));
			bottom: calc(-1 * var(--ui-xp-edge-outset));
			width: var(--ui-xp-edge-width);
			opacity: 0;
			background: var(--ui-xp-edge-color, var(--ui-color-highlight));
			box-shadow: 0 0 var(--ui-xp-edge-glow-radius) currentColor;
			pointer-events: none;
		}
		.xp-sparkles {
			position: absolute;
			inset: 0;
			pointer-events: none;
		}
		.xp-sparkle {
			position: absolute;
			width: var(--ui-xp-sparkle-size);
			height: var(--ui-xp-sparkle-size);
			opacity: 0;
			color: var(--ui-xp-sparkle-color, var(--ui-xp-celebration-color));
			filter: drop-shadow(0 0 var(--ui-xp-sparkle-glow-radius) currentColor);
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
		.level:not([hidden]) {
			display: inline-block;
			flex-shrink: 0;
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

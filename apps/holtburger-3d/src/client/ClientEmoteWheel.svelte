<script lang="ts">
	import { onMount, tick } from "svelte";
	import BackIcon from "../assets/icons/hud-back.svg?component";
	import { dismissDialogOnBackdrop } from "../app/dialog-backdrop-dismiss";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import type { ClientSoulEmotes } from "./client-soul-emotes";
	import {
		EMOTE_CATEGORIES,
		emoteWheelEntries,
		emoteEntryEnabled,
		nextEmoteEntry,
		type EmoteWheelEntry,
	} from "./client-emote-wheel";

	interface Props {
		/** Static vocabulary resolved before opening. */
		readonly catalog: ClientSoulEmotes;
		/** Queue-acknowledged user history; never server acceptance. */
		readonly recent: readonly string[];
		readonly onClose: () => void;
		readonly onExecute: (token: string) => void;
	}
	const { catalog, recent, onClose, onExecute }: Props = $props();
	const { keyboard } = useAppInputPolicy();
	const id = $props.id();
	let surface: HTMLDivElement;
	let category = $state<number | null>(null);
	let selected = $state(-1);
	const entries = $derived(emoteWheelEntries(catalog, recent, category));
	const active = $derived(entries[selected]);
	const categoryLabel = $derived(
		category === null
			? "Choose a category"
			: category === EMOTE_CATEGORIES.length
				? "Recent"
				: EMOTE_CATEGORIES[category].label,
	);
	let closed = false;
	// Native initial focus finishes before this transient scope owns cancellation.
	let inputAcquired = false;
	function close(): void {
		if (!closed) {
			closed = true;
			onClose();
		}
	}
	function back(): void {
		if (category === null) close();
		else {
			category = null;
			selected = -1;
		}
	}
	function choose(entry: EmoteWheelEntry): void {
		if (closed || !emoteEntryEnabled(entry)) return;
		if (entry.kind === "category") {
			category = entry.index;
			selected = -1;
		} else if (entry.kind === "emote") {
			close();
			onExecute(entry.alias);
		}
	}
	function keydown(event: KeyboardEvent): void {
		const letter = event.key.toLowerCase();
		const direction =
			["ArrowLeft", "ArrowUp"].includes(event.key) ||
			["a", "w"].includes(letter)
				? -1
				: ["ArrowRight", "ArrowDown"].includes(event.key) ||
					  ["d", "s"].includes(letter)
					? 1
					: null;
		if (direction !== null) {
			event.preventDefault();
			selected = nextEmoteEntry(
				entries,
				selected < 0 && direction === -1 ? 0 : selected,
				direction,
			);
			return;
		}
		if (!["Home", "End", "Enter", " ", "Escape"].includes(event.key)) return;
		event.preventDefault();
		if (event.repeat && ["Enter", " ", "Escape"].includes(event.key)) return;
		if (event.key === "Escape") back();
		else if (event.key === "Home") selected = nextEmoteEntry(entries, -1, 1);
		else if (event.key === "End") selected = nextEmoteEntry(entries, 0, -1);
		else if (active !== undefined) choose(active);
	}

	// Percentages keep annular hit areas and labels aligned at every HUD scale.
	const INNER_RADIUS = 20;
	const OUTER_RADIUS = 49;
	const WEDGE_GAP = 1;
	const MAX_ARC_STEP_DEGREES = 4;
	function wedgeStyle(index: number, count: number): string {
		const center = (index * 360) / count - 90;
		const halfSector = 180 / count;
		const arc = (radius: number, reverse: boolean): string[] => {
			// Offset both radial boundaries by half the gap: parallel edges, not a tapered slit.
			const trim = (Math.asin(WEDGE_GAP / (2 * radius)) * 180) / Math.PI;
			const start = center - halfSector + trim;
			const sweep = 2 * (halfSector - trim);
			const steps = Math.ceil(sweep / MAX_ARC_STEP_DEGREES);
			return Array.from({ length: steps + 1 }, (_, step) => {
				const angle =
					((start + (sweep * (reverse ? steps - step : step)) / steps) *
						Math.PI) /
					180;
				return `${50 + radius * Math.cos(angle)}% ${50 + radius * Math.sin(angle)}%`;
			});
		};
		const outer = arc(OUTER_RADIUS, false);
		const inner = arc(INNER_RADIUS, true);
		const angle = (center * Math.PI) / 180;
		const labelRadius = (INNER_RADIUS + OUTER_RADIUS) / 2;
		return `clip-path: polygon(${[...outer, ...inner].join(",")}); --label-x: ${50 + labelRadius * Math.cos(angle)}%; --label-y: ${50 + labelRadius * Math.sin(angle)}%;`;
	}
	onMount(() => {
		void tick().then(() => {
			if (closed) return;
			keyboard.activate(surface);
			inputAcquired = true;
		});
		window.addEventListener("resize", close);
		return () => {
			closed = true;
			window.removeEventListener("resize", close);
		};
	});
</script>

<!-- A circular HUD has no frame/header; shared modal actions still own focus and dismissal. -->
<dialog
	class="client-emote-dialog"
	aria-label="Emotes"
	tabindex="-1"
	use:keyboard.modal
	use:dismissDialogOnBackdrop={close}
	oncancel={(event) => {
		event.preventDefault();
		close();
	}}
>
	<div
		class="emote-wheel"
		role="menu"
		aria-label={`Emotes · ${categoryLabel}`}
		aria-activedescendant={active === undefined
			? undefined
			: `${id}-${selected}`}
		tabindex="-1"
		bind:this={surface}
		use:dismissDialogOnBackdrop={close}
		use:keyboard.scope={{
			transient: true,
			keydown,
			cancel: () => {
				if (inputAcquired) close();
			},
		}}
	>
		{#each entries as entry, index}
			{@const enabled = emoteEntryEnabled(entry)}
			<button
				type="button"
				role="menuitem"
				tabindex="-1"
				id={`${id}-${index}`}
				class="emote-wedge emote-glass"
				class:highlighted={enabled && selected === index}
				style={wedgeStyle(index, entries.length)}
				disabled={!enabled}
				title={entry.kind === "missing"
					? entry.detail
					: entry.kind === "emote"
						? `*${entry.alias}*`
						: entry.disabled
							? "No recent emotes"
							: entry.label}
				onpointerenter={() => {
					if (enabled) selected = index;
				}}
				onclick={() => choose(entry)}
				><span class="emote-label">{entry.label}</span></button
			>
		{/each}
		<div class="emote-center">
			<span class="emote-center-label ui-readout"
				>{category === null ? "Emotes" : categoryLabel}</span
			>
			{#if category !== null}
				<button
					type="button"
					class="emote-back ui-hud-button ui-icon-button"
					tabindex="-1"
					aria-label="Back to emote categories"
					title="Back to emote categories (Escape)"
					onclick={back}
				>
					<BackIcon />
				</button>
			{/if}
		</div>
	</div>
</dialog>

<style>
	@layer components {
		.client-emote-dialog {
			padding: 0;
			border: 0;
			background: transparent;
			color: var(--ui-color-text);
			max-width: none;
			max-height: none;
			overflow: visible;
			--ui-overlay-backdrop-background: transparent;
		}
		.emote-wheel {
			position: relative;
			width: min(
				var(--ui-emote-wheel-size),
				calc(100vw - 2rem),
				calc(100dvh - 2rem)
			);
			aspect-ratio: 1;
			outline: none;
		}
		.emote-glass {
			appearance: none;
			background: var(--ui-hud-glass-color);
			backdrop-filter: var(--ui-hud-glass-filter);
			color: var(--ui-color-text);
			font: inherit;
			cursor: pointer;
			transition:
				transform var(--ui-emote-wheel-transition-duration) ease-out,
				background-color var(--ui-emote-wheel-transition-duration) ease-out,
				color var(--ui-emote-wheel-transition-duration) ease-out;
		}
		.emote-wedge {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			border: 0;
			border-radius: 50%;
			padding: 0;
		}
		.emote-label {
			position: absolute;
			left: var(--label-x);
			top: var(--label-y);
			transform: translate(-50%, -50%);
			width: 27%;
			text-align: center;
			white-space: normal;
			overflow-wrap: anywhere;
		}
		.emote-wedge.highlighted:not(:disabled) {
			background: var(
				--ui-emote-wheel-highlight-background,
				color-mix(in srgb, var(--ui-hud-glass-color) 55%, transparent)
			);
			color: var(--ui-color-highlight);
			transform: scale(var(--ui-emote-wheel-highlight-scale));
			z-index: 1;
		}
		.emote-wedge:disabled {
			color: var(--ui-color-muted);
			opacity: 0.4;
			cursor: default;
		}
		.emote-center {
			position: absolute;
			display: flex;
			flex-direction: column;
			align-items: center;
			left: 50%;
			top: 50%;
			transform: translate(-50%, -50%);
			width: max-content;
			max-width: 38%;
			box-sizing: border-box;
			padding-block: 3px;
			text-align: center;
			line-height: 1.2;
			white-space: nowrap;
		}
		.emote-center-label {
			max-width: 100%;
			box-sizing: border-box;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.emote-back {
			width: 28px;
			height: 28px;
			padding: 4px;
		}
		@media (prefers-reduced-motion: reduce) {
			.emote-glass {
				transition: none;
			}
			.emote-wedge.highlighted {
				transform: none;
			}
		}
	}
</style>

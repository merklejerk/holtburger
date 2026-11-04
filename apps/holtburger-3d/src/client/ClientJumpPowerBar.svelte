<script lang="ts">
	import { MINIMUM_JUMP_POWER } from "./client-host-contract";
	interface Props {
		readonly active: boolean;
		/** Editor-only extent used when no live charge exists; null removes the surface. */
		readonly previewExtent: number | null;
		/** Current mode, owned by the input arbiter. */
		readonly precise: boolean;
		/** Hot power sampled without cursor-rate Svelte updates. */
		readonly readExtent: () => number;
		/** Compact increase/decrease controls rendered as keycaps beneath POWER. */
		readonly powerKeys: readonly [string, string];
		/** Runtime precise-mode control; null keeps manual charge and layout previews read-only. */
		readonly powerControl: {
			readonly setPower: (power: number) => void;
		} | null;
	}
	let {
		active,
		previewExtent,
		precise,
		readExtent,
		powerKeys,
		powerControl,
	}: Props = $props();
	let trackElement = $state<HTMLDivElement | null>(null);
	let fillElement = $state<HTMLDivElement | null>(null);
	let levelElement = $state<HTMLDivElement | null>(null);
	let readoutElement = $state<HTMLDivElement | null>(null);
	let inputElement = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (
			(!active && previewExtent === null) ||
			trackElement === null ||
			fillElement === null ||
			levelElement === null ||
			readoutElement === null
		)
			return;
		const track = trackElement;
		const fill = fillElement;
		const level = levelElement;
		const readout = readoutElement;
		const update = (extent: number): void => {
			const clamped = Math.max(0, Math.min(1, extent));
			if (powerControl === null)
				track.setAttribute("aria-valuenow", String(clamped));
			const percent = `${clamped * 100}%`;
			fill.style.height = percent;
			if (inputElement !== null) inputElement.value = String(clamped);
			level.style.bottom = percent;
			const text = `${Math.round(clamped * 100)}%`;
			if (readout.textContent !== text) readout.textContent = text;
		};
		if (!active) {
			update(previewExtent ?? 0);
			return;
		}
		let frameHandle = 0;
		const sample = (): void => {
			update(readExtent());
			frameHandle = window.requestAnimationFrame(sample);
		};
		sample();
		return () => window.cancelAnimationFrame(frameHandle);
	});
</script>

{#if active || previewExtent !== null}
	<div
		class="jump-power"
		class:jump-power-precise={precise}
		aria-label="Jump power"
	>
		<div class="jump-mode-label">
			{precise ? "PRECISE JUMP" : "MANUAL JUMP"}
		</div>
		<div class="jump-power-meter">
			<div class="jump-power-scale">
				<div
					bind:this={trackElement}
					class="jump-power-track ui-hud-surface"
					role={powerControl === null ? "progressbar" : undefined}
					aria-label={powerControl === null ? "Jump" : undefined}
					aria-valuemin={powerControl === null ? 0 : undefined}
					aria-valuemax={powerControl === null ? 1 : undefined}
					aria-valuenow={powerControl === null ? 0 : undefined}
				>
					<div bind:this={fillElement} class="jump-power-fill"></div>
					{#if powerControl !== null}
						{@const setPower = powerControl.setPower}
						<input
							bind:this={inputElement}
							class="jump-power-input"
							type="range"
							aria-label="Set jump power"
							aria-orientation="vertical"
							min={MINIMUM_JUMP_POWER}
							max="1"
							step={MINIMUM_JUMP_POWER}
							onpointerdown={(event) => {
								if (event.button !== 0) return;
								// Keep gameplay keyboard ownership; pointer input chooses the clicked height directly.
								event.preventDefault();
								event.stopPropagation();
								const bounds = event.currentTarget.getBoundingClientRect();
								setPower((bounds.bottom - event.clientY) / bounds.height);
							}}
							oninput={(event) => setPower(event.currentTarget.valueAsNumber)}
						/>
					{/if}
					<!-- Share the fill's content box so theme borders cannot offset the guide. -->
					<div bind:this={levelElement} class="jump-power-level">
						<div bind:this={readoutElement} class="jump-power-readout"></div>
						<div class="jump-power-caption">
							<span class="jump-power-label">POWER</span>
							{#if precise}
								<span class="jump-power-keys"
									><kbd class="ui-keycap">{powerKeys[0]}</kbd><span
										aria-hidden="true">/</span
									><kbd class="ui-keycap">{powerKeys[1]}</kbd></span
								>
							{/if}
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	@layer components {
		.jump-power {
			/* Reserve the readout and caption outside the shared bar/label row. */
			--_jump-caption-space: calc(1em + 3px);
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
			pointer-events: none;
			width: 100%;
			height: 100%;
			padding: 6px;
			display: grid;
			grid-template-columns: max-content minmax(0, 1fr);
			grid-template-rows: var(--ui-jump-readout-font-size) minmax(0, 1fr) var(
					--_jump-caption-space
				);
			column-gap: calc(var(--ui-jump-gap) / 3);
		}
		.jump-mode-label {
			grid-column: 1;
			grid-row: 2;
			min-height: 0;
			writing-mode: vertical-rl;
			transform: rotate(180deg);
			text-align: start;
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
			letter-spacing: 0.12em;
			white-space: nowrap;
			color: var(--ui-color-muted);
		}
		.jump-power-precise {
			--_jump-caption-space: calc(1em + var(--ui-keycap-size) + 7px);
		}
		.jump-power-meter {
			grid-column: 2;
			grid-row: 2;
			position: relative;
			min-width: 0;
			height: 100%;
		}

		.jump-power-scale {
			position: relative;
			height: 100%;
		}
		.jump-power-track {
			position: relative;
			width: var(--ui-jump-bar-width);
			height: 100%;
			background: var(--_ui-hud-background-color);
		}
		.jump-power-level {
			position: absolute;
			left: 0;
			right: calc(-1 * (var(--ui-jump-gap) + 4ch));
			font-size: calc(var(--ui-jump-readout-font-size) * var(--ui-text-scale));
			height: 0;
			border-top: 1px solid var(--ui-color-text);
			pointer-events: none;
		}
		.jump-power-readout,
		.jump-power-caption {
			position: absolute;
			left: calc(var(--ui-jump-bar-width) + var(--ui-jump-gap));
		}
		.jump-power-readout {
			bottom: 1px;
			font-size: calc(var(--ui-jump-readout-font-size) * var(--ui-text-scale));
			font-weight: 700;
			font-variant-numeric: tabular-nums;
			line-height: 1;
			color: var(--ui-color-text);
		}
		.jump-power-caption {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: 4px;
			white-space: nowrap;
			top: 2px;
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
			font-weight: 600;
			line-height: 1;
			letter-spacing: 0.08em;
			color: var(--ui-color-muted);
		}
		.jump-power-keys {
			display: inline-flex;
			align-items: center;
			gap: 3px;
		}
		.jump-power-input {
			pointer-events: auto;
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			margin: 0;
			padding: 0;
			border: 0;
			opacity: 0;
			cursor: pointer;
			writing-mode: vertical-lr;
			direction: rtl;
		}
		.jump-power-track:has(.jump-power-input:focus-visible) {
			outline: 2px solid var(--ui-color-focus);
			outline-offset: 2px;
		}
		.jump-power-fill {
			position: absolute;
			bottom: 0;
			width: 100%;
			background: var(--ui-jump-fill-color);
		}
	}
</style>

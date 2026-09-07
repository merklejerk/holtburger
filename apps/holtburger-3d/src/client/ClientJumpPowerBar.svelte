<script lang="ts">
	import ClientHudIcon from "./ClientHudIcon.svelte";

	interface Props {
		readonly active: boolean;
		/** Editor-only extent used when no live charge exists; null removes the surface. */
		readonly previewExtent: number | null;
		/** Whether the precise-jump action may dispatch gameplay input. */
		readonly actionEnabled: boolean;
		readonly readExtent: () => number;
		readonly onEnterPrecise: () => void;
	}

	let {
		active,
		previewExtent,
		actionEnabled,
		readExtent,
		onEnterPrecise,
	}: Props = $props();
	let trackElement = $state<HTMLDivElement | null>(null);
	let fillElement = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (
			(!active && previewExtent === null) ||
			trackElement === null ||
			fillElement === null
		)
			return;
		const track = trackElement;
		const fill = fillElement;
		const updateExtent = (extent: number): void => {
			const clamped = Math.max(0, Math.min(1, extent));
			track.setAttribute("aria-valuenow", String(clamped));
			fill.style.height = `${clamped * 100}%`;
		};
		if (!active) {
			updateExtent(previewExtent ?? 0);
			return;
		}
		let frameHandle = 0;
		const sample = (): void => {
			updateExtent(readExtent());
			frameHandle = window.requestAnimationFrame(sample);
		};
		sample();
		return () => window.cancelAnimationFrame(frameHandle);
	});
</script>

{#if active || previewExtent !== null}
	<div class="jump-power" aria-label="Jump charge">
		<div
			bind:this={trackElement}
			class="jump-power-track ui-hud-surface"
			role="progressbar"
			aria-label="Jump"
			aria-valuemin="0"
			aria-valuemax="1"
			aria-valuenow="0"
		>
			<div bind:this={fillElement} class="jump-power-fill"></div>
		</div>
		<button
			type="button"
			class="jump-precise ui-hud-button"
			aria-label="Switch to precise jump"
			title="Cancel charge and enter precise jump"
			disabled={!actionEnabled}
			onpointerdown={(event) => event.preventDefault()}
			onclick={onEnterPrecise}><ClientHudIcon name="precise-jump" /></button
		>
	</div>
{/if}

<style>
	@layer components {
		.jump-power {
			width: 100%;
			height: 100%;
			padding: 4px;
			display: flex;
			flex-direction: column;
			gap: 5px;
			align-items: center;
		}
		.jump-power-track {
			position: relative;
			width: 12px;
			height: 88px;
			background: var(--_ui-hud-background-color);
			overflow: hidden;
		}
		.jump-precise {
			width: 28px;
			height: 28px;
			padding: 5px;
		}
		.jump-power-fill {
			position: absolute;
			bottom: 0;
			width: 100%;
			background: var(--ui-color-accent);
		}
	}
</style>

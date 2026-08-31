<script lang="ts">
	import ClientHudIcon from "./ClientHudIcon.svelte";

	interface Props {
		readonly active: boolean;
		readonly readExtent: () => number;
		readonly onEnterPrecise: () => void;
	}

	let { active, readExtent, onEnterPrecise }: Props = $props();
	let trackElement = $state<HTMLDivElement | null>(null);
	let fillElement = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!active || trackElement === null || fillElement === null) return;
		const track = trackElement;
		const fill = fillElement;
		let frameHandle = 0;
		const sample = (): void => {
			const extent = Math.max(0, Math.min(1, readExtent()));
			track.setAttribute("aria-valuenow", String(extent));
			fill.style.height = `${extent * 100}%`;
			frameHandle = window.requestAnimationFrame(sample);
		};
		sample();
		return () => window.cancelAnimationFrame(frameHandle);
	});
</script>

{#if active}
	<div class="jump-power" aria-label="Jump charge">
		<div
			bind:this={trackElement}
			class="jump-power-track"
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
			class="jump-precise"
			aria-label="Switch to precise jump"
			title="Cancel charge and enter precise jump"
			onpointerdown={(event) => event.preventDefault()}
			onclick={onEnterPrecise}><ClientHudIcon name="precise-jump" /></button
		>
	</div>
{/if}

<style>
	.jump-power {
		position: fixed;
		left: 50%;
		z-index: 5;
		transform: translateX(-50%);
		bottom: 72px;
		width: 38px;
		padding: 4px;
		display: flex;
		flex-direction: column;
		gap: 5px;
		align-items: center;
		border: 1px solid rgb(201 183 132 / 0.72);
		background: rgb(12 9 6 / 0.84);
		box-shadow: 0 2px 10px rgb(0 0 0 / 0.55);
	}

	.jump-power-track {
		position: relative;
		width: 12px;
		height: 88px;
		border: 1px solid rgb(0 0 0 / 0.8);
		background: rgb(37 29 18 / 0.92);
		overflow: hidden;
	}

	.jump-precise {
		width: 28px;
		height: 28px;
		border: 1px solid rgb(201 183 132 / 0.72);
		padding: 5px;
		background: rgb(52 40 23 / 0.94);
		color: var(--ac-ink);
		font: var(--ac-panel-font-size) var(--ac-font-ui);
		cursor: pointer;
	}

	.jump-precise:hover {
		background: rgb(81 61 31 / 0.96);
	}

	.jump-power-fill {
		position: absolute;
		bottom: 0;
		width: 100%;
		background: linear-gradient(0deg, #9e6d1e, #efd06f);
		box-shadow: inset 0 1px rgb(255 244 187 / 0.45);
	}
</style>

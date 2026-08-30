<script lang="ts">
	interface Props {
		readonly active: boolean;
		readonly readExtent: () => number;
		readonly status: string | null;
	}

	let { active, readExtent, status }: Props = $props();
	let extent = $state(0);

	$effect(() => {
		if (!active) {
			extent = 0;
			return;
		}
		let frameHandle = 0;
		const sample = (): void => {
			extent = Math.max(0, Math.min(1, readExtent()));
			frameHandle = window.requestAnimationFrame(sample);
		};
		sample();
		return () => window.cancelAnimationFrame(frameHandle);
	});
</script>

{#if active}
	<div class="jump-power" aria-label="Jump charge">
		<div
			class="jump-power-track"
			role="progressbar"
			aria-label="Jump"
			aria-valuemin="0"
			aria-valuemax="1"
			aria-valuenow={extent}
		>
			<div class="jump-power-fill" style:width={`${extent * 100}%`}></div>
		</div>
	</div>
{/if}
{#if status !== null}
	<p class="jump-status" aria-live="polite">{status}</p>
{/if}

<style>
	.jump-power,
	.jump-status {
		position: fixed;
		left: 50%;
		z-index: 5;
		transform: translateX(-50%);
	}

	.jump-power {
		bottom: 84px;
		width: min(320px, calc(100vw - 48px));
		padding: 5px;
		border: 1px solid rgb(201 183 132 / 0.72);
		background: rgb(12 9 6 / 0.84);
		box-shadow: 0 2px 10px rgb(0 0 0 / 0.55);
	}

	.jump-power-track {
		height: 14px;
		border: 1px solid rgb(0 0 0 / 0.8);
		background: rgb(37 29 18 / 0.92);
		overflow: hidden;
	}

	.jump-power-fill {
		height: 100%;
		background: linear-gradient(90deg, #9e6d1e, #efd06f);
		box-shadow: inset 0 1px rgb(255 244 187 / 0.45);
	}

	.jump-status {
		bottom: 54px;
		margin: 0;
		padding: 4px 8px;
		background: rgb(12 9 6 / 0.78);
		color: var(--ac-ink);
		font: var(--ac-panel-font-size) var(--ac-font-ui);
		text-shadow: 1px 1px #000;
	}
</style>

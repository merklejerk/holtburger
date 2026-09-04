<script lang="ts">
	import { onMount, untrack } from "svelte";

	import ClientHudIcon from "./ClientHudIcon.svelte";
	import { CLIENT_TUNING } from "./client-tuning";

	interface Props {
		/** Cold selection identity controlling whether the runtime surface is present. */
		readonly selectedGuid: number | null;
		/** Bounded display read kept separate from frame-hot target projection. */
		readonly readSelectedName: () => string | null;
	}

	const { selectedGuid, readSelectedName }: Props = $props();
	let selectedName = $state<string | null>(null);
	const displayName = $derived(selectedName ?? "Selected Entity");

	$effect(() => {
		const guid = selectedGuid;
		// Selection identity is cold UI state; the runtime lookup must not own this effect's lifecycle.
		untrack(() => {
			selectedName = guid === null ? null : readSelectedName();
		});
	});

	onMount(() => {
		const sample = (): void => {
			selectedName = selectedGuid === null ? null : readSelectedName();
		};
		const interval = window.setInterval(
			sample,
			CLIENT_TUNING.selectedEntityHud.displayIntervalMs,
		);
		return () => window.clearInterval(interval);
	});
</script>

<section class="selected-entity" aria-label={`Selected entity: ${displayName}`}>
	<div class="selected-entity__heading">
		<button type="button" disabled aria-label="Interact (not yet available)">
			<ClientHudIcon name="interact" />
		</button>
		<strong title={displayName}>{displayName}</strong>
		<button type="button" disabled aria-label="Examine (not yet available)">
			<ClientHudIcon name="examine" />
		</button>
	</div>
	<div class="selected-entity__health" aria-hidden="true">
		<div class="selected-entity__health-fill"></div>
	</div>
</section>

<style>
	.selected-entity {
		display: grid;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		padding: 7px 9px 9px;
		gap: 7px;
		border: 1px solid rgb(255 207 151 / 0.48);
		border-radius: 13px;
		background:
			linear-gradient(135deg, rgb(117 65 43 / 0.44), rgb(46 27 24 / 0.6)),
			rgb(45 28 24 / 0.44);
		box-shadow:
			inset 0 1px 0 rgb(255 235 205 / 0.18),
			0 7px 24px rgb(18 7 4 / 0.32);
		backdrop-filter: blur(12px) saturate(1.2);
		-webkit-backdrop-filter: blur(12px) saturate(1.2);
		color: #fff0dc;
		font-family: var(--ac-font-ui);
	}

	.selected-entity__heading {
		display: grid;
		grid-template-columns: 34px minmax(0, 1fr) 34px;
		gap: 8px;
		align-items: center;
		min-height: 32px;
	}

	.selected-entity__heading strong {
		overflow: hidden;
		font-size: 15px;
		font-weight: 650;
		letter-spacing: 0.02em;
		text-align: center;
		text-overflow: ellipsis;
		text-shadow: 0 1px 3px rgb(29 10 6 / 0.9);
		white-space: nowrap;
	}

	.selected-entity__heading button {
		display: grid;
		width: 34px;
		height: 30px;
		min-height: 0;
		padding: 6px;
		place-items: center;
		border: 1px solid rgb(255 218 169 / 0.28);
		border-radius: 8px;
		background: rgb(255 221 182 / 0.08);
		color: rgb(255 225 188 / 0.72);
		box-shadow: inset 0 1px 0 rgb(255 246 226 / 0.08);
		cursor: not-allowed;
		opacity: 1;
		pointer-events: auto;
	}

	.selected-entity__heading button :global(svg) {
		width: 18px;
		height: 18px;
	}

	.selected-entity__health {
		overflow: hidden;
		border: 1px solid rgb(255 213 174 / 0.22);
		border-radius: 999px;
		background: rgb(30 13 12 / 0.68);
		box-shadow: inset 0 2px 4px rgb(8 2 2 / 0.58);
	}

	.selected-entity__health-fill {
		width: 68%;
		height: 100%;
		background: linear-gradient(90deg, #9d3028, #dc6750);
		box-shadow:
			inset 0 1px 0 rgb(255 205 179 / 0.3),
			0 0 10px rgb(211 75 53 / 0.3);
	}
</style>

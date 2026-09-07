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
	<div class="selected-entity__heading ui-hud-group">
		<button
			class="ui-hud-button"
			type="button"
			disabled
			aria-label="Interact (not yet available)"
		>
			<ClientHudIcon name="interact" />
		</button>
		<strong title={displayName}><span>{displayName}</span></strong>
		<button
			class="ui-hud-button"
			type="button"
			disabled
			aria-label="Examine (not yet available)"
		>
			<ClientHudIcon name="examine" />
		</button>
	</div>
	<div class="selected-entity__health ui-hud-surface" aria-hidden="true">
		<div class="selected-entity__health-fill"></div>
	</div>
</section>

<style>
	@layer components {
		.selected-entity {
			display: grid;
			box-sizing: border-box;
			width: 100%;
			height: 100%;
			grid-template-rows: 24px 5px;
			gap: 3px;
		}
		.selected-entity__heading {
			display: grid;
			grid-template-columns: 24px minmax(0, 1fr) 24px;
			gap: 4px;
			align-items: center;
		}
		.selected-entity__heading strong {
			font-weight: 600;
			text-align: center;
			white-space: nowrap;
			min-width: 0;
		}
		.selected-entity__heading strong span {
			display: block;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.selected-entity__heading button {
			display: grid;
			width: 24px;
			height: 24px;
			padding: 4px;
			place-items: center;
			pointer-events: auto;
		}
		.selected-entity__heading button :global(svg) {
			width: 16px;
			height: 16px;
		}
		.selected-entity__health {
			overflow: hidden;
			background: var(--_ui-hud-background-color);
		}
		.selected-entity__health-fill {
			width: 68%;
			height: 100%;
			background: var(--ui-color-health);
		}
	}
</style>

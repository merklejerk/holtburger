<script lang="ts">
	import { onMount } from "svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";

	interface Props {
		/** Action whose binding is being captured or replaced. */
		readonly action: string;
		/** Conflicting shortcut labels and actions; null while waiting for a key. */
		readonly conflict: {
			readonly bindings: readonly string[];
			readonly actions: string;
		} | null;
		readonly onKeydown: (event: KeyboardEvent) => void;
		readonly onKeyup: (event: KeyboardEvent) => void;
		readonly onReplace: () => void;
		readonly onCancel: () => void;
	}
	let { action, conflict, onKeydown, onKeyup, onReplace, onCancel }: Props =
		$props();
	const { keyboard } = useAppInputPolicy();
	let dialog: HTMLDialogElement;
	onMount(() => keyboard.activate(dialog));
</script>

<div class="binding-dialog-overlay">
	<dialog
		open
		class="binding-dialog ui-panel"
		aria-label={`Set key for ${action}`}
		tabindex="-1"
		bind:this={dialog}
		use:keyboard.scope={{
			nativeControls: true,
			keydown: onKeydown,
			keyup: onKeyup,
		}}
	>
		<strong
			>{conflict === null
				? `Add key for ${action}`
				: `Replace key for ${action}`}</strong
		>
		{#if conflict === null}
			<p>Press a key or chord. Escape cancels.</p>
		{:else}
			<p class="binding-dialog-conflict" role="alert">
				{#each conflict.bindings as binding, index}
					{#if index > 0}<span>/</span>{/if}
					<kbd class="binding-dialog-key">{binding}</kbd>
				{/each}
				<span>conflicts with {conflict.actions}.</span>
			</p>
		{/if}
		<div class="binding-dialog-actions">
			<button type="button" class="ui-button" onclick={onCancel}>Cancel</button>
			{#if conflict !== null}
				<button type="button" class="ui-button" onclick={onReplace}
					>Replace</button
				>
			{/if}
		</div>
	</dialog>
</div>

<style>
	@layer components {
		.binding-dialog-overlay {
			position: absolute;
			inset: 0;
			z-index: 5;
			display: grid;
			place-items: center;
			background: rgb(0 0 0 / 35%);
		}
		.binding-dialog {
			position: relative;
			box-sizing: border-box;
			width: min(25rem, calc(100% - 16px));
			max-height: calc(100% - 16px);
			margin: 8px;
			padding: 12px;
			overflow: auto;
			color: var(--ui-color-text);
		}
		p {
			margin: 12px 0;
		}
		.binding-dialog-conflict {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 4px;
		}
		.binding-dialog-key {
			display: inline-flex;
			min-width: 30px;
			min-height: 24px;
			box-sizing: border-box;
			align-items: center;
			justify-content: center;
			padding: 1px 8px;
			border: 1px solid var(--ui-color-border);
			border-radius: 999px;
			background: var(--ui-color-control);
			color: inherit;
			font: inherit;
			white-space: nowrap;
		}
		.binding-dialog-actions {
			display: flex;
			flex-wrap: wrap;
			justify-content: flex-end;
			gap: 8px;
		}
	}
</style>

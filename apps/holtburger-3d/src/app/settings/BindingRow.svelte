<script lang="ts">
	import AddIcon from "../../assets/icons/hud-add.svg?component";
	import ResetIcon from "../../assets/icons/hud-reset.svg?component";
	import type { KeyBinding } from "../../lib/input/input-contract";
	import type { InputPlatform } from "../../lib/input/input-platform";
	import {
		formatInputBinding,
		formatInputPill,
	} from "../../lib/input/input-presentation";

	interface Props {
		readonly label: string;
		readonly bindings: readonly KeyBinding[];
		readonly platform: InputPlatform;
		readonly onRemove: (index: number, source: HTMLButtonElement) => void;
		readonly onAdd: (source: HTMLButtonElement) => void;
		readonly onReset: (source: HTMLButtonElement) => void;
	}

	const { label, bindings, platform, onRemove, onAdd, onReset }: Props =
		$props();
</script>

<div class="binding-row">
	<span class="binding-label">{label}</span>
	<div class="binding-keys">
		{#each bindings as binding, index}
			<button
				type="button"
				class="binding-key ui-keycap"
				aria-label={`Remove ${formatInputBinding(binding, platform)} from ${label}`}
				title={`Remove binding: ${formatInputBinding(binding, platform)}`}
				onclick={(event) => onRemove(index, event.currentTarget)}
				><kbd aria-hidden="true">{formatInputPill(binding, platform)}</kbd><span
					class="binding-key-remove"
					aria-hidden="true">×</span
				></button
			>
		{:else}<span class="ui-muted">Unbound</span>{/each}
	</div>
	<div class="binding-actions ui-icon-actions">
		<button
			type="button"
			class="ui-button ui-icon-button"
			aria-label={`Add key for ${label}`}
			title={`Add key for ${label}`}
			onclick={(event) => onAdd(event.currentTarget)}><AddIcon /></button
		>
		<button
			type="button"
			class="ui-button ui-icon-button"
			aria-label={`Restore default keys for ${label}`}
			title={`Restore default keys for ${label}`}
			onclick={(event) => onReset(event.currentTarget)}><ResetIcon /></button
		>
	</div>
</div>

<style>
	@layer components {
		.binding-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas: "label actions" "keys actions";
			column-gap: 8px;
			row-gap: 2px;
			align-items: center;
			padding: 5px 2px;
			border-bottom: 1px solid var(--ui-color-border);
		}
		.binding-label {
			grid-area: label;
			font-weight: 600;
		}
		.binding-keys {
			grid-area: keys;
			min-width: 0;
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: 3px;
		}
		.binding-actions {
			grid-area: actions;
			flex-wrap: nowrap;
			gap: 3px;
		}
		.binding-key {
			cursor: pointer;
		}
		.binding-key kbd,
		.binding-key-remove {
			grid-area: 1 / 1;
		}
		.binding-key kbd {
			font: inherit;
		}
		.binding-key-remove {
			font-size: 1.25em;
			line-height: 1;
			opacity: 0;
			pointer-events: none;
		}
		.binding-key:hover,
		.binding-key:focus-visible {
			border-color: var(--ui-color-accent);
			color: var(--ui-color-accent);
		}
		.binding-key:focus-visible {
			outline: 2px solid var(--ui-color-accent);
			outline-offset: 2px;
		}
		.binding-key:hover kbd,
		.binding-key:focus-visible kbd {
			opacity: 0;
		}
		.binding-key:hover .binding-key-remove,
		.binding-key:focus-visible .binding-key-remove {
			opacity: 1;
		}
	}
</style>

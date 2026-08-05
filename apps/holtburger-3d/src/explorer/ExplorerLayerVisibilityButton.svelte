<script lang="ts">
	interface Props {
		/** Human-readable layer name used by the button's accessible action label. */
		readonly label: string;
		/** Whether the layer currently contributes renderer frame work. */
		readonly visible: boolean;
		readonly updateVisible: (visible: boolean) => void;
	}

	let { label, visible, updateVisible }: Props = $props();
</script>

<button
	type="button"
	class:layer-hidden={!visible}
	class="explorer-layer-visibility"
	aria-label={`${visible ? "Hide" : "Show"} ${label} rendering`}
	aria-pressed={visible}
	title={`${visible ? "Hide" : "Show"} ${label} rendering`}
	onclick={() => updateVisible(!visible)}
>
	<svg aria-hidden="true" viewBox="0 0 24 24">
		<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
		<circle cx="12" cy="12" r="3" />
		{#if !visible}<path class="visibility-slash" d="m4 4 16 16" />{/if}
	</svg>
</button>

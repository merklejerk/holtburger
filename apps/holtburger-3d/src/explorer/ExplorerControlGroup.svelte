<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		/** User-facing label for the collapsible control group. */
		readonly title: string;
		/** Whether the group starts expanded when its panel is mounted. */
		readonly initiallyOpen?: boolean;
		/** Disable every form control in the group without changing disclosure state. */
		readonly disabled?: boolean;
		readonly children: Snippet;
	}

	let {
		title,
		initiallyOpen = false,
		disabled = false,
		children,
	}: Props = $props();
</script>

<details class="explorer-control-group" open={initiallyOpen}>
	<summary>{title}</summary>
	<fieldset {disabled}>
		<legend class="sr-only">{title}</legend>
		{@render children()}
	</fieldset>
</details>

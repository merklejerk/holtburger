<script lang="ts">
	interface Props {
		/** Current boolean control value. */
		readonly checked: boolean;
		/** Human-readable control name. */
		readonly label: string;
		/** Status text rendered when the control is checked. */
		readonly checkedLabel: string;
		/** Status text rendered when the control is unchecked. */
		readonly uncheckedLabel: string;
		/** Publish one user-authored value replacement. */
		readonly onCheckedChange: (checked: boolean) => void;
	}

	const {
		checked,
		label,
		checkedLabel,
		uncheckedLabel,
		onCheckedChange,
	}: Props = $props();
</script>

<label class="toggle-field ui-theme">
	<input
		{checked}
		type="checkbox"
		onchange={(event) => onCheckedChange(event.currentTarget.checked)}
	/>
	<span>{label}</span>
	<strong aria-hidden="true">{checked ? checkedLabel : uncheckedLabel}</strong>
</label>

<style>
	.toggle-field {
		display: grid;
		grid-template-columns: 15px minmax(0, 1fr) auto;
		gap: 7px;
		align-items: center;
		min-height: 25px;
		padding: 3px 5px;
	}
	input {
		width: 15px;
		height: 15px;
		padding: 0;
		margin: 0;
		cursor: pointer;
	}
	strong {
		color: var(--ui-color-muted);
		font-weight: 400;
	}
</style>

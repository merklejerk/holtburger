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

<label class="toggle-field">
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
		border: 1px solid rgb(200 148 42 / 0.38);
		background: rgb(6 5 4 / 0.32);
	}

	input {
		appearance: none;
		min-width: 15px;
		min-height: 15px;
		width: 15px;
		height: 15px;
		padding: 0;
		margin: 0;
		border: 1px solid #6b704f;
		border-radius: 50%;
		background: radial-gradient(
			circle at 35% 30%,
			#b5ae91 0 11%,
			#5d5d48 32%,
			#292b20 70%,
			#101109 100%
		);
		box-shadow:
			inset 0 1px 1px rgb(255 255 224 / 0.24),
			0 1px 1px #000;
		cursor: pointer;
	}

	input:checked {
		background: radial-gradient(
			circle at 35% 30%,
			#efffd3 0 12%,
			#97ff5a 28%,
			#3f9b20 64%,
			#173d13 100%
		);
		box-shadow:
			0 0 5px rgb(126 242 45 / 0.75),
			inset 0 1px 1px rgb(239 255 211 / 0.72);
	}

	input:focus-visible {
		outline: 1px solid var(--ac-gold-bright);
		outline-offset: 2px;
	}

	input:disabled {
		cursor: not-allowed;
		filter: grayscale(0.8);
		opacity: 0.45;
	}

	span {
		color: var(--ac-ink);
		font-size: 0.76rem;
	}

	strong {
		color: var(--ac-ink-muted);
		font-family: var(--ac-font-ui);
		font-size: 0.72rem;
		font-weight: 400;
	}
</style>

<script lang="ts">
	import { onMount } from "svelte";
	import UiDialog from "../app/UiDialog.svelte";
	interface Props {
		/** Name-sorted current members eligible to receive leadership. */
		readonly candidates: readonly { guid: number; name: string }[];
		/** Submit the chosen successor and leave in one user action. */
		readonly onSubmit: (successor: number) => void;
		/** Retire the draft without sending either command. */
		readonly onCancel: () => void;
	}
	const { candidates, onSubmit, onCancel }: Props = $props();
	let successor = $state<number | null>(null);
	let select: HTMLSelectElement;
	onMount(() => select.focus());
</script>

<UiDialog
	className="client-party-leave-dialog"
	title="Pass leadership and leave"
	{onCancel}
>
	<form
		onsubmit={(event) => {
			event.preventDefault();
			if (successor !== null) onSubmit(successor);
		}}
	>
		<label
			>New party leader
			<select
				class="ui-input"
				bind:this={select}
				bind:value={successor}
				required
			>
				<option value={null} disabled>Choose a member</option>
				{#each candidates as member (member.guid)}<option value={member.guid}
						>{member.name}</option
					>{/each}
			</select>
		</label>
		<div class="ui-dialog-actions">
			<button class="ui-button" type="button" onclick={onCancel}>Cancel</button>
			<button class="ui-button" type="submit" disabled={successor === null}
				>Pass leadership and leave</button
			>
		</div>
	</form>
</UiDialog>

<style>
	@layer components {
		form,
		label {
			display: grid;
			gap: 0.75rem;
		}
	}
</style>

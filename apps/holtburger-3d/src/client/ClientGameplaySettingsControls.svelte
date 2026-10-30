<script lang="ts">
	import type {
		ClientGameplayOption,
		ClientGameplayPreferences,
	} from "./client-gameplay-options-contract";

	interface Props {
		/** Current character's mirrored server-saved options; absent until description arrives. */
		readonly preferences: ClientGameplayPreferences | null;
		/** Lifecycle admission supplied by the session shell. */
		readonly enabled: boolean;
		readonly onChange: (
			option: ClientGameplayOption,
			enabled: boolean,
		) => Promise<void>;
	}
	let { preferences, enabled, onChange }: Props = $props();
	let pending = $state(false);
	let error = $state<string | null>(null);
	const sections = [
		{
			title: "Crafting",
			controls: [
				{
					option: "craftSuccessDialog",
					label: "Confirm crafting attempts with success chance",
				},
			],
		},
		{
			title: "Item use",
			controls: [
				{
					option: "confirmRareUse",
					label: "Confirm rare gem use",
				},
			],
		},
		{
			title: "Player interactions",
			controls: [
				{
					option: "allowItemGive",
					label: "Allow other players to give you items",
				},
				{
					option: "ignoreTradeRequests",
					label: "Ignore trade requests",
				},
				{
					option: "ignoreAllegianceRequests",
					label: "Ignore allegiance requests",
				},
			],
		},
		{
			title: "Privacy",
			controls: [
				{
					option: "useDeception",
					label: "Attempt to deceive other players",
				},
				{
					option: "shareBirthDate",
					label: "Show birth date to other players",
				},
				{
					option: "shareAge",
					label: "Show character age to other players",
				},
				{
					option: "shareDeaths",
					label: "Show death count to other players",
				},
				{
					option: "shareTitles",
					label: "Show title count to other players",
				},
				{
					option: "shareChessRank",
					label: "Show chess rank to other players",
				},
				{
					option: "shareFishingSkill",
					label: "Show fishing skill to other players",
				},
			],
		},
	] as const satisfies readonly {
		readonly title: string;
		readonly controls: readonly {
			readonly option: ClientGameplayOption;
			readonly label: string;
		}[];
	}[];

	async function change(
		option: ClientGameplayOption,
		value: boolean,
	): Promise<void> {
		if (!enabled || preferences === null || pending) return;
		pending = true;
		error = null;
		try {
			await onChange(option, value);
		} catch (cause) {
			console.error("Gameplay setting update failed", cause);
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			pending = false;
		}
	}
</script>

<div class="settings-section">
	{#if error !== null}<p role="alert">{error}</p>{/if}
	{#each sections as section}
		<details class="ui-disclosure ui-disclosure-section" open>
			<summary>{section.title}</summary>
			<div class="settings-section ui-disclosure-body">
				{#each section.controls as control}
					<label class="ui-checkbox">
						<input
							type="checkbox"
							checked={preferences?.[control.option] === true}
							disabled={!enabled || preferences === null || pending}
							onchange={(event) => {
								const requested = event.currentTarget.checked;
								// Native toggling is an intent; only mirrored preferences change the displayed value.
								event.currentTarget.checked =
									preferences?.[control.option] === true;
								void change(control.option, requested);
							}}
						/>
						{control.label}
					</label>
				{/each}
			</div>
		</details>
	{/each}
</div>

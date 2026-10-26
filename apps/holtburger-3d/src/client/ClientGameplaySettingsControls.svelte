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
					description:
						"Show the server’s success estimate and ask for confirmation before supported crafting operations.",
				},
			],
		},
		{
			title: "Item use",
			controls: [
				{
					option: "confirmRareUse",
					label: "Confirm rare gem use",
					description: "Ask for confirmation before using a rare gem.",
				},
			],
		},
		{
			title: "Player interactions",
			controls: [
				{
					option: "allowItemGive",
					label: "Allow other players to give you items",
					description: "",
				},
				{
					option: "ignoreTradeRequests",
					label: "Ignore trade requests",
					description: "",
				},
				{
					option: "ignoreAllegianceRequests",
					label: "Ignore allegiance requests",
					description: "",
				},
			],
		},
		{
			title: "Privacy",
			controls: [
				{
					option: "useDeception",
					label: "Attempt to deceive other players",
					description:
						"Use Deception to resist other players’ appraisal attempts.",
				},
				{
					option: "shareBirthDate",
					label: "Show birth date to other players",
					description: "",
				},
				{
					option: "shareAge",
					label: "Show character age to other players",
					description: "",
				},
				{
					option: "shareDeaths",
					label: "Show death count to other players",
					description: "",
				},
				{
					option: "shareTitles",
					label: "Show title count to other players",
					description: "",
				},
				{
					option: "shareChessRank",
					label: "Show chess rank to other players",
					description: "",
				},
				{
					option: "shareFishingSkill",
					label: "Show fishing skill to other players",
					description: "",
				},
			],
		},
	] as const satisfies readonly {
		readonly title: string;
		readonly controls: readonly {
			readonly option: ClientGameplayOption;
			readonly label: string;
			readonly description: string;
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
	{#if !enabled || preferences === null}
		<p>Enter the world with a character to change gameplay settings.</p>
	{/if}
	{#if error !== null}<p role="alert">{error}</p>{/if}
	{#each sections as section}
		<details class="ui-disclosure ui-disclosure-section" open>
			<summary>{section.title}</summary>
			<div class="settings-section ui-disclosure-body">
				{#each section.controls as control}
					<div>
						<label class="ui-checkbox">
							<input
								type="checkbox"
								checked={preferences?.[control.option] === true}
								disabled={!enabled || preferences === null || pending}
								aria-describedby={control.description
									? `gameplay-${control.option}-description`
									: undefined}
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
						{#if control.description}<p
								id={`gameplay-${control.option}-description`}
							>
								{control.description}
							</p>{/if}
					</div>
				{/each}
			</div>
		</details>
	{/each}
</div>

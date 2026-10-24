<script lang="ts">
	import { onMount } from "svelte";
	import UiTabs from "../app/UiTabs.svelte";
	import UiTabPanel from "../app/UiTabPanel.svelte";
	import ClientModelPreview from "./ClientModelPreview.svelte";
	import type { ClientObjectPreviewService } from "./client-object-preview-service";
	import type { CharacterManagementState } from "./client-host-contract";
	import {
		characterCreationDraftSchema,
		type CharacterCreationCatalog,
		type CharacterCreationDraft,
	} from "./client-character-creation-contract";
	import {
		CharacterCreationPreviewResolver,
		characterManagementPending,
		creationBuildBalance,
		creationAppearanceRequest,
		NO_CREATION_HEADGEAR,
		creationFaceFraming,
		creationGender,
		creationHeritage,
		creationPreviewSource,
		initialCreationDraft,
		randomizeCreationClothing,
		type CharacterCreationServices,
		type CreationAppearance,
		type CreationPreviewResolution,
	} from "./client-character-creation";

	interface Props {
		readonly services: CharacterCreationServices;
		readonly previewService: ClientObjectPreviewService;
		readonly management: CharacterManagementState;
		readonly onCancel: () => void;
	}
	const { services, previewService, management, onCancel }: Props = $props();
	type Editor = {
		readonly catalog: CharacterCreationCatalog;
		readonly draft: CharacterCreationDraft;
	};
	let editor = $state.raw<Editor | null>(null);
	let loadError = $state<string | null>(null);
	let commandError = $state<string | null>(null);
	let submission = $state.raw<{
		readonly before: CharacterManagementState;
	} | null>(null);
	let resolution = $state.raw<CreationPreviewResolution>({
		kind: "pending",
		previous: null,
	});
	let resolver: CharacterCreationPreviewResolver | null = null;
	let face = $state(false);
	let page = $state<"appearance" | "skills-stats" | "review">("appearance");
	const tabs = [
		{
			value: "appearance",
			label: "Appearance",
			id: "creation-appearance-tab",
			panelId: "creation-appearance",
		},
		{
			value: "skills-stats",
			label: "Skills & Stats",
			id: "creation-skills-stats-tab",
			panelId: "creation-skills-stats",
		},
		{
			value: "review",
			label: "Review",
			id: "creation-review-tab",
			panelId: "creation-review",
		},
	] as const;
	const ordinalChoices = [
		{ field: "hairStyle", count: "hairStyles", label: "Hair / body style" },
		{ field: "hairColor", count: "hairColors", label: "Hair color" },
		{ field: "eyes", count: "eyes", label: "Eyes" },
		{ field: "eyeColor", count: "eyeColors", label: "Eye color" },
		{ field: "nose", count: "noses", label: "Nose" },
		{ field: "mouth", count: "mouths", label: "Mouth" },
	] as const;
	const attributes = [
		"Strength",
		"Endurance",
		"Coordination",
		"Quickness",
		"Focus",
		"Self",
	] as const;
	const advancements = [
		{ value: 1, label: "Untrained" },
		{ value: 2, label: "Trained" },
		{ value: 3, label: "Specialized" },
	] as const;
	const heritage = $derived(
		editor === null
			? null
			: creationHeritage(editor.catalog, editor.draft.heritage),
	);
	const gender = $derived(
		editor === null || heritage === null
			? null
			: creationGender(heritage, editor.draft.gender),
	);
	const balance = $derived(
		editor === null || heritage === null
			? null
			: creationBuildBalance(heritage, editor.draft),
	);
	const invalidAttributes = $derived.by(() => {
		const current = editor;
		return (
			current !== null &&
			current.draft.attributes.some(
				(value) =>
					!Number.isInteger(value) ||
					value < current.catalog.minimumAttribute ||
					value > current.catalog.maximumAttribute,
			)
		);
	});

	const busy = $derived(
		submission !== null || characterManagementPending(management),
	);
	const resolved = $derived(
		resolution.kind === "ready" ? resolution.preview : resolution.previous,
	);
	const source = $derived(
		resolved === null ? null : creationPreviewSource(resolved.visual),
	);
	const framing = $derived(
		face && resolved !== null
			? creationFaceFraming(resolved.heritage, resolved.visual.body.scale)
			: ({ kind: "body" } as const),
	);

	function readEditor(): Editor {
		if (editor === null)
			throw new Error("Character creation choices are not loaded.");
		return editor;
	}
	function updateDraft(draft: CharacterCreationDraft): void {
		editor = { ...readEditor(), draft };
		commandError = null;
	}
	function requestPreview(draft: CharacterCreationDraft): void {
		if (resolver === null)
			throw new Error("Character creation preview is not mounted.");
		resolver.request(creationAppearanceRequest(draft, face));
	}
	function changeAppearance(
		field: keyof CreationAppearance,
		value: number,
	): void {
		const current = readEditor().draft;
		const next = {
			...current,
			appearance: { ...current.appearance, [field]: value },
		};
		updateDraft(next);
		requestPreview(next);
	}
	function setFaceMode(next: boolean): void {
		if (face === next) return;
		face = next;
		const draft = readEditor().draft;
		if (draft.appearance.headgearStyle !== NO_CREATION_HEADGEAR)
			requestPreview(draft);
	}
	function randomizeClothes(): void {
		const current = readEditor();
		const body = creationGender(
			creationHeritage(current.catalog, current.draft.heritage),
			current.draft.gender,
		);
		const draft = {
			...current.draft,
			appearance: randomizeCreationClothing(
				current.draft.appearance,
				body,
				Math.random,
			),
		};
		updateDraft(draft);
		requestPreview(draft);
	}
	function changeBody(heritageId: number, genderId: number): void {
		const current = readEditor();
		const draft = initialCreationDraft(
			current.catalog,
			heritageId,
			genderId,
			current.draft.name,
			Math.random,
		);
		updateDraft(draft);
		requestPreview(draft);
	}
	function changeHeritage(id: number): void {
		const chosen = creationHeritage(readEditor().catalog, id);
		const body = chosen.genders[0];
		if (body === undefined)
			throw new Error(`Heritage ${id} has no body choices.`);
		changeBody(id, body.id);
	}
	function changeAttribute(index: number, value: number): void {
		const draft = readEditor().draft;
		const attributes: CharacterCreationDraft["attributes"] = [
			...draft.attributes,
		];
		attributes[index] = value;
		updateDraft({ ...draft, attributes });
	}
	function changeSkill(id: number, value: number): void {
		const draft = readEditor().draft;
		const skills = [...draft.skills];
		skills[id] = value;
		updateDraft({ ...draft, skills });
	}
	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (busy) return;
		commandError = null;
		submission = { before: management };
		try {
			await services.submit(
				characterCreationDraftSchema.parse(readEditor().draft),
			);
		} catch (error) {
			submission = null;
			commandError = error instanceof Error ? error.message : String(error);
		}
	}
	$effect(() => {
		// Authority takes over admission once it observes the request; retain the local gap meanwhile.
		if (
			submission !== null &&
			management.kind !== "idle" &&
			management !== submission.before
		)
			submission = null;
	});
	onMount(() => {
		let current = true;
		const owner = new CharacterCreationPreviewResolver(
			services.resolveAppearance,
			(state) => {
				if (current) resolution = state;
			},
		);
		resolver = owner;
		void services
			.loadCatalog()
			.then((catalog) => {
				if (!current) return;
				const heritage = catalog.heritages[0];
				const gender = heritage?.genders[0];
				if (heritage === undefined || gender === undefined)
					throw new Error("Character creation catalog has no body choices.");
				const draft = initialCreationDraft(
					catalog,
					heritage.id,
					gender.id,
					"",
					Math.random,
				);
				editor = { catalog, draft };
				requestPreview(draft);
			})
			.catch((error: unknown) => {
				if (current)
					loadError = error instanceof Error ? error.message : String(error);
			});
		return () => {
			current = false;
			owner.dispose();
			resolver = null;
		};
	});
</script>

<h1>Create a character</h1>
{#if loadError !== null}
	<p class="ui-error" role="alert">{loadError}</p>
{:else if editor === null || heritage === null || gender === null || balance === null}
	<p role="status">Loading character choices…</p>
{:else}
	<div class="creation-layout">
		<div class="creation-preview">
			<div class="creation-viewport">
				<ClientModelPreview
					{source}
					{framing}
					rotation="subject"
					service={previewService}
					emptyMessage="Preparing character…"
				/>
				<div class="creation-focus">
					<button
						class="ui-button"
						type="button"
						aria-pressed={!face}
						onclick={() => setFaceMode(false)}>Body</button
					>
					<button
						class="ui-button"
						type="button"
						aria-pressed={face}
						onclick={() => setFaceMode(true)}>Face</button
					>
				</div>
			</div>
			{#if resolution.kind === "failed"}<p class="ui-error" role="alert">
					{resolution.message}
				</p>{/if}
		</div>
		<div class="creation-editor ui-tabbed-panel">
			<UiTabs
				label="Character creation"
				{tabs}
				selected={page}
				onSelect={(value) => (page = value)}
			/>
			<UiTabPanel
				id="creation-appearance"
				labelledBy="creation-appearance-tab"
				active={page === "appearance"}
			>
				<fieldset class="creation-fields" disabled={busy}>
					<legend>Body and appearance</legend>
					<label
						>Heritage<select
							class="ui-input"
							value={editor.draft.heritage}
							onchange={(event) =>
								changeHeritage(Number(event.currentTarget.value))}
							>{#each editor.catalog.heritages as choice}<option
									value={choice.id}>{choice.name}</option
								>{/each}</select
						></label
					>
					<label
						>Body<select
							class="ui-input"
							value={editor.draft.gender}
							onchange={(event) =>
								changeBody(
									readEditor().draft.heritage,
									Number(event.currentTarget.value),
								)}
							>{#each heritage.genders as choice}<option value={choice.id}
									>{choice.name}</option
								>{/each}</select
						></label
					>
					{#each ordinalChoices as control}
						{#if gender[control.count] > 1}<label
								>{control.label}<select
									class="ui-input"
									value={editor.draft.appearance[control.field]}
									onchange={(event) =>
										changeAppearance(
											control.field,
											Number(event.currentTarget.value),
										)}
									>{#each Array.from({ length: gender[control.count] }, (_, index) => index) as index}<option
											value={index}>{index + 1}</option
										>{/each}</select
								></label
							>{/if}
					{/each}
					<label
						>Skin shade<input
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={editor.draft.appearance.skinHue}
							oninput={(event) =>
								changeAppearance("skinHue", Number(event.currentTarget.value))}
						/></label
					>
					{#if gender.hairColors > 0}<label
							>Hair shade<input
								type="range"
								min="0"
								max="1"
								step="0.01"
								value={editor.draft.appearance.hairHue}
								oninput={(event) =>
									changeAppearance(
										"hairHue",
										Number(event.currentTarget.value),
									)}
							/></label
						>{/if}
					{#if heritage.usesStarterClothing}
						<button class="ui-button" type="button" onclick={randomizeClothes}
							>Randomize clothes</button
						>
					{/if}
				</fieldset>
			</UiTabPanel>
			<UiTabPanel
				id="creation-skills-stats"
				labelledBy="creation-skills-stats-tab"
				active={page === "skills-stats"}
			>
				<fieldset class="creation-fields" disabled={busy}>
					<legend>Attributes and skills</legend>
					<p>Attribute points remaining: {balance.attributes}</p>
					{#each attributes as label, index}<label
							>{label}<input
								class="ui-input"
								type="number"
								min={editor.catalog.minimumAttribute}
								max={editor.catalog.maximumAttribute}
								step="1"
								value={editor.draft.attributes[index]}
								oninput={(event) =>
									changeAttribute(index, Number(event.currentTarget.value))}
							/></label
						>{/each}
					<p>Skill credits remaining: {balance.skills}</p>
					{#each heritage.skills as skill}
						<label title={skill.description}
							>{skill.name}<select
								class="ui-input"
								value={editor.draft.skills[skill.id]}
								onchange={(event) =>
									changeSkill(skill.id, Number(event.currentTarget.value))}
								>{#each advancements as choice}<option
										value={choice.value}
										disabled={choice.value < skill.minimumAdvancement ||
											(choice.value >= 2 && skill.trainedCost === null) ||
											(choice.value === 3 &&
												skill.specializationUpgradeCost === null)}
										>{choice.label}{choice.value === 2
											? ` (${skill.trainedCost ?? "unavailable"})`
											: choice.value === 3 &&
												  skill.trainedCost !== null &&
												  skill.specializationUpgradeCost !== null
												? ` (${skill.trainedCost + skill.specializationUpgradeCost})`
												: ""}</option
									>{/each}</select
							></label
						>
					{/each}
				</fieldset>
			</UiTabPanel>
			<UiTabPanel
				id="creation-review"
				labelledBy="creation-review-tab"
				active={page === "review"}
			>
				<form class="creation-fields" onsubmit={submit}>
					<fieldset class="creation-fields" disabled={busy}>
						<legend>Review and create</legend>
						<label
							>Name<input
								class="ui-input"
								type="text"
								required
								value={editor.draft.name}
								oninput={(event) =>
									updateDraft({
										...readEditor().draft,
										name: event.currentTarget.value,
									})}
							/></label
						>
						<label
							>Starting area<select
								class="ui-input"
								value={editor.draft.startArea}
								onchange={(event) =>
									updateDraft({
										...readEditor().draft,
										startArea: Number(event.currentTarget.value),
									})}
								>{#each heritage.startAreaIds as id}{@const area =
										editor.catalog.startAreas.find(
											(entry) => entry.id === id,
										)}{#if area !== undefined}<option value={id}
											>{area.name}</option
										>{/if}{/each}</select
							></label
						>
						<p>{heritage.name} · {gender.name}</p>
						<p>
							Attribute points remaining: {balance.attributes} · Skill credits remaining:
							{balance.skills}
						</p>
						{#if invalidAttributes}<p class="ui-error">
								Each attribute must be an integer from {editor.catalog
									.minimumAttribute} to {editor.catalog.maximumAttribute}.
							</p>{/if}
						<p class="ui-muted">
							Creation returns to character selection. Enter the world when you
							are ready.
						</p>
						<button
							class="ui-button"
							type="submit"
							disabled={balance.attributes !== 0 ||
								balance.skills < 0 ||
								invalidAttributes ||
								editor.draft.name.trim().length === 0}
							>{busy ? "Creating…" : "Create character"}</button
						>
					</fieldset>
				</form>
			</UiTabPanel>
		</div>
	</div>
{/if}
{#if commandError !== null}<p class="ui-error" role="alert">
		{commandError}
	</p>{/if}
{#if management.kind === "rejected" && management.operation === "create"}<p
		class="ui-error"
		role="alert"
	>
		{management.message}
	</p>{/if}
{#if management.kind === "uncertain"}<p class="ui-error" role="alert">
		{management.message}
	</p>{/if}
<button class="ui-button" type="button" disabled={busy} onclick={onCancel}
	>Cancel</button
>

<style>
	@layer components {
		.creation-layout {
			display: grid;
			grid-template-columns: minmax(240px, 1fr) minmax(280px, 1fr);
			gap: 16px;
			min-height: 420px;
		}
		.creation-preview {
			display: flex;
			flex-direction: column;
			align-items: center;
		}
		.creation-viewport {
			position: relative;
			width: 100%;
			max-width: 360px;
			aspect-ratio: 3 / 4;
			/* Portrait framing keeps the finite authored backdrop's edges outside the view. */
			min-height: 0;
		}
		.creation-focus {
			position: absolute;
			bottom: 8px;
			inset-inline: 0;
			display: flex;
			justify-content: center;
			gap: 8px;
		}
		.creation-editor {
			max-height: min(65vh, 680px);
			min-height: 360px;
		}
		.creation-fields {
			display: grid;
			gap: 12px;
			border: 0;
			padding: 8px;
			margin: 0;
		}
		.creation-fields label {
			display: grid;
			grid-template-columns: minmax(100px, 1fr) minmax(120px, 1fr);
			align-items: center;
			gap: 12px;
		}
		.creation-fields p {
			margin: 0;
		}
		@media (max-width: 700px) {
			.creation-layout {
				grid-template-columns: 1fr;
			}
		}
	}
</style>

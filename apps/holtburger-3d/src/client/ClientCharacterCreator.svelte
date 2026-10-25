<script lang="ts">
	import AppearanceIcon from "../assets/icons/pregame-appearance.svg?component";
	import BuildIcon from "../assets/icons/pregame-skills-stats.svg?component";
	import ReviewIcon from "../assets/icons/pregame-review.svg?component";
	import HeritageIcon from "../assets/icons/hud-world.svg?component";
	import BodyIcon from "../assets/icons/pregame-body.svg?component";
	import HairIcon from "../assets/icons/pregame-hair.svg?component";
	import NoseIcon from "../assets/icons/pregame-nose.svg?component";
	import MouthIcon from "../assets/icons/pregame-mouth.svg?component";
	import ShadeIcon from "../assets/icons/pregame-shade.svg?component";
	import FaceIcon from "../assets/icons/pregame-face.svg?component";
	import EyeIcon from "../assets/icons/hud-eye.svg?component";
	import ClothesIcon from "../assets/icons/equipment-chest.svg?component";
	import RandomizeIcon from "../assets/icons/hud-reset.svg?component";
	import BackIcon from "../assets/icons/hud-back.svg?component";
	import RotateIcon from "../assets/icons/layout-rotate.svg?component";
	import { onMount } from "svelte";
	import UiTabs from "../app/UiTabs.svelte";
	import UiTabPanel from "../app/UiTabPanel.svelte";
	import ClientPregameScreen from "./ClientPregameScreen.svelte";
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
		/** Return to the character roster without submitting the draft. */
		readonly onBack: () => void;
	}
	const { services, previewService, management, onBack }: Props = $props();
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
	const stepIcons = {
		appearance: AppearanceIcon,
		"skills-stats": BuildIcon,
		review: ReviewIcon,
	};
	const step = $derived(tabs.findIndex((tab) => tab.value === page));
	const ordinalChoices = [
		{
			field: "hairStyle",
			count: "hairStyles",
			label: "Hair / body style",
			icon: HairIcon,
		},
		{
			field: "hairColor",
			count: "hairColors",
			label: "Hair color",
			icon: HairIcon,
		},
		{ field: "eyes", count: "eyes", label: "Eyes", icon: EyeIcon },
		{
			field: "eyeColor",
			count: "eyeColors",
			label: "Eye color",
			icon: EyeIcon,
		},
		{ field: "nose", count: "noses", label: "Nose", icon: NoseIcon },
		{ field: "mouth", count: "mouths", label: "Mouth", icon: MouthIcon },
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

<ClientPregameScreen branding="corner" showPortalLogo={true} backdrop={true}>
	{#snippet footer()}
		<button
			class="pregame-action pregame-quiet ui-button"
			type="button"
			disabled={busy}
			onclick={onBack}
			><span class="pregame-icon" aria-hidden="true"><BackIcon /></span
			>Back</button
		>
	{/snippet}
	<div class="creation-layout">
		<h1>Create a character</h1>
		<aside class="creation-navigation">
			<UiTabs
				label="Character creation"
				{tabs}
				selected={page}
				orientation="vertical"
				onSelect={(value) => (page = value)}
			>
				{#snippet tabLabel(value, label)}
					{@const Icon = stepIcons[value]}
					<span class="creation-step-icon pregame-icon" aria-hidden="true"
						><Icon /></span
					>
					<span>{label}</span>
				{/snippet}
			</UiTabs>
		</aside>
		<div class="creation-preview">
			<div class="creation-viewport">
				<ClientModelPreview
					{source}
					{framing}
					rotation="subject"
					keyboardNavigation={false}
					service={previewService}
					emptyMessage="Preparing character…"
				/>
			</div>
			<div class="creation-focus">
				<span class="creation-rotate ui-muted"
					><span class="pregame-icon" aria-hidden="true"><RotateIcon /></span
					>Drag to rotate</span
				>
				<button
					class="pregame-action ui-button"
					type="button"
					disabled={editor === null}
					aria-pressed={!face}
					onclick={() => setFaceMode(false)}
					><span class="pregame-icon" aria-hidden="true"><BodyIcon /></span
					>Body</button
				>
				<button
					class="pregame-action ui-button"
					type="button"
					disabled={editor === null}
					aria-pressed={face}
					onclick={() => setFaceMode(true)}
					><span class="pregame-icon" aria-hidden="true"><FaceIcon /></span
					>Face</button
				>
			</div>
			{#if resolution.kind === "failed"}<p class="ui-error" role="alert">
					{resolution.message}
				</p>{/if}
		</div>
		<section class="creation-editor" aria-label="Character settings">
			<header class="creation-editor-heading">
				<span
					>{String(step + 1).padStart(2, "0")} / {String(tabs.length).padStart(
						2,
						"0",
					)}</span
				>
				<h2>{tabs[step].label}</h2>
			</header>
			<div class="creation-settings">
				{#if loadError !== null}
					<p class="ui-error" role="alert">{loadError}</p>
				{:else if editor === null || heritage === null || gender === null || balance === null}
					<p role="status">Loading character choices…</p>
				{:else}
					<UiTabPanel
						id="creation-appearance"
						labelledBy="creation-appearance-tab"
						active={page === "appearance"}
					>
						<fieldset class="creation-fields" disabled={busy}>
							<legend class="sr-only">Body and appearance</legend>
							<label
								><span class="creation-label"
									><span class="pregame-icon" aria-hidden="true"
										><HeritageIcon /></span
									>Heritage</span
								><select
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
								><span class="creation-label"
									><span class="pregame-icon" aria-hidden="true"
										><BodyIcon /></span
									>Body</span
								><select
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
							<h2 class="creation-section">
								<span class="pregame-icon" aria-hidden="true"><FaceIcon /></span
								>Features &amp; color
							</h2>
							{#each ordinalChoices as control}
								{@const Icon = control.icon}
								{#if gender[control.count] > 1}<label
										><span class="creation-label"
											><span class="pregame-icon" aria-hidden="true"
												><Icon /></span
											>{control.label}</span
										><select
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
								><span class="creation-label"
									><span class="pregame-icon" aria-hidden="true"
										><ShadeIcon /></span
									>Skin shade</span
								><input
									type="range"
									min="0"
									max="1"
									step="0.01"
									value={editor.draft.appearance.skinHue}
									oninput={(event) =>
										changeAppearance(
											"skinHue",
											Number(event.currentTarget.value),
										)}
								/></label
							>
							{#if gender.hairColors > 0}<label
									><span class="creation-label"
										><span class="pregame-icon" aria-hidden="true"
											><ShadeIcon /></span
										>Hair shade</span
									><input
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
								<button
									class="pregame-action ui-button creation-randomize"
									type="button"
									onclick={randomizeClothes}
									><span class="pregame-icon" aria-hidden="true"
										><ClothesIcon /></span
									>Randomize clothes<span
										class="pregame-icon"
										aria-hidden="true"><RandomizeIcon /></span
									></button
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
						<form
							id="creation-review-form"
							class="creation-fields"
							onsubmit={submit}
						>
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
									Attribute points remaining: {balance.attributes} · Skill credits
									remaining:
									{balance.skills}
								</p>
								{#if invalidAttributes}<p class="ui-error">
										Each attribute must be an integer from {editor.catalog
											.minimumAttribute} to {editor.catalog.maximumAttribute}.
									</p>{/if}
								<p class="ui-muted">
									Creation returns to character selection. Enter the world when
									you are ready.
								</p>
							</fieldset>
						</form>
					</UiTabPanel>
				{/if}
				<div class="creation-feedback">
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
				</div>
			</div>
			<div class="creation-actions">
				{#if page !== "appearance"}<button
						class="pregame-action pregame-quiet ui-button"
						type="button"
						disabled={busy}
						onclick={() => (page = tabs[step - 1].value)}
						><span class="pregame-icon" aria-hidden="true"><BackIcon /></span
						>Previous</button
					>{/if}
				{#if page === "review"}
					<button
						class="pregame-primary pregame-action ui-button"
						type="submit"
						form="creation-review-form"
						disabled={busy ||
							editor === null ||
							balance === null ||
							balance.attributes !== 0 ||
							balance.skills < 0 ||
							invalidAttributes ||
							editor.draft.name.trim().length === 0}
						>{busy ? "Creating…" : "Create character"}</button
					>
				{:else}
					<button
						class="pregame-primary pregame-action ui-button"
						type="button"
						disabled={busy || editor === null}
						onclick={() => (page = tabs[step + 1].value)}
						>{tabs[step + 1].label}<span
							class="creation-next pregame-icon"
							aria-hidden="true"><BackIcon /></span
						></button
					>
				{/if}
			</div>
		</section>
	</div>
</ClientPregameScreen>

<style>
	@layer components {
		.creation-layout {
			isolation: isolate;
			display: grid;
			grid-template-columns: minmax(150px, 0.6fr) minmax(220px, 1.4fr) minmax(
					340px,
					1fr
				);
			grid-template-rows: auto minmax(0, 1fr);
			gap: clamp(16px, 2vw, 40px);
			min-width: 0;
			min-height: 0;
		}
		.creation-navigation {
			grid-column: 1;
			grid-row: 2;
			position: relative;
			min-width: 0;
			min-height: 0;
		}
		.creation-navigation::before,
		.creation-editor::before {
			content: "";
			position: absolute;
			z-index: -1;
			pointer-events: none;
		}
		.creation-navigation::before {
			inset: -100vh -80px -100vh -100vw;
		}
		h1 {
			grid-column: 1 / 3;
			grid-row: 1;
			z-index: 1;
			padding-left: 24px;
			margin: 0;
			line-height: 1.15;
		}
		.creation-preview {
			min-height: 0;
			grid-column: 2;
			grid-row: 1 / 3;
			display: grid;
			grid-template-rows: minmax(0, 1fr) auto;
			min-width: 0;
			gap: 12px;
		}
		.creation-viewport {
			min-height: 0;
		}
		.creation-focus {
			display: flex;
			align-items: center;
			justify-content: center;
			flex-wrap: wrap;
			gap: 8px;
		}
		.creation-rotate {
			display: inline-flex;
			align-items: center;
			gap: 6px;
		}
		.creation-editor {
			grid-column: 3;
			grid-row: 1 / 3;
			position: relative;
			display: grid;
			grid-template-rows: auto minmax(0, 1fr) auto;
			min-height: 0;
			min-width: 0;
		}
		.creation-editor::before {
			inset: -100vh -100vw -100vh -32px;
		}
		.creation-editor-heading {
			display: flex;
			align-items: baseline;
			gap: 16px;
			padding-bottom: 16px;
		}
		h2 {
			margin: 0;
		}
		.creation-settings {
			display: grid;
			grid-template-rows: minmax(0, 1fr) auto;
			min-height: 0;
		}
		.creation-settings :global(.tab-panel) {
			overflow-x: hidden;
			padding-block: 16px;
			scrollbar-gutter: stable;
		}
		.creation-fields {
			display: grid;
			gap: 16px;
			min-width: 0;
			border: 0;
			padding: 0;
			margin: 0;
		}
		.creation-fields > legend {
			padding-bottom: 16px;
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
		.creation-label {
			display: inline-flex;
			align-items: center;
			gap: 10px;
		}
		.creation-section {
			display: flex;
			align-items: center;
			gap: 10px;
			padding-top: 20px;
			margin-top: 4px;
		}
		.creation-randomize {
			width: 100%;
		}
		.creation-actions {
			display: flex;
			align-items: center;
			gap: 16px;
			padding-top: 20px;
		}
		.creation-actions .pregame-primary {
			flex: 1;
		}
		.creation-next {
			transform: rotate(180deg);
		}
		@media (max-width: 850px) {
			.creation-layout {
				grid-template-columns: minmax(0, 1fr);
				overflow: clip;
			}
			.creation-layout > * {
				grid-column: 1;
				grid-row: auto;
			}
			.creation-navigation::before {
				inset: -80px -100vw;
			}
			.creation-editor::before {
				inset: -24px -100vw;
			}
			h1 {
				margin-bottom: 0;
			}
			.creation-viewport {
				height: 50vh;
			}
			.creation-editor {
				grid-template-rows: auto auto auto;
			}
			.creation-settings {
				grid-template-rows: auto auto;
			}
		}
	}
	@layer overrides {
		.creation-navigation :global(.ui-tabs[aria-orientation="vertical"]) {
			position: relative;
			border: 0;
			margin: 0 0 24px;
			gap: 28px;
		}

		/* One continuous rail connects every phase; each button owns only its diamond. */
		.creation-navigation :global(.ui-tabs::before) {
			content: "";
			position: absolute;
			inset: -160px auto -72px 0;
			width: 1px;
			pointer-events: none;
		}
		.creation-navigation :global(.ui-tab) {
			position: relative;
			display: grid;
			justify-items: start;
			align-content: start;
			gap: 12px;
			padding: 12px 12px 12px 28px;
			text-align: left;
			border: 0;
		}
		.creation-navigation :global(.ui-tab::before) {
			content: "";
			position: absolute;
			left: -5px;
			top: 28px;
			width: 10px;
			height: 10px;
			transform: rotate(45deg);
		}
		.creation-step-icon {
			width: calc(34px * var(--ui-icon-scale));
			height: calc(34px * var(--ui-icon-scale));
		}
		@media (max-width: 850px) {
			.creation-navigation :global(.ui-tabs::before) {
				top: -24px;
				bottom: -12px;
			}
		}
	}
</style>

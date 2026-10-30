<script lang="ts">
	import MaleIcon from "../assets/icons/pregame-male.svg?component";
	import FemaleIcon from "../assets/icons/pregame-female.svg?component";
	import ChevronIcon from "../assets/icons/dropdown-chevron.svg?component";
	import UpgradeTriangle from "../assets/icons/character-upgrade-triangle.svg?component";
	import AppearanceIcon from "../assets/icons/pregame-appearance.svg?component";
	import BuildIcon from "../assets/icons/pregame-skills-stats.svg?component";
	import ReviewIcon from "../assets/icons/pregame-review.svg?component";
	import HeritageIcon from "../assets/icons/hud-world.svg?component";
	import BodyIcon from "../assets/icons/pregame-body.svg?component";
	import HairIcon from "../assets/icons/pregame-hair.svg?component";
	import NoseIcon from "../assets/icons/pregame-nose.svg?component";
	import MouthIcon from "../assets/icons/pregame-mouth.svg?component";
	import FaceIcon from "../assets/icons/pregame-face.svg?component";
	import EyeIcon from "../assets/icons/hud-eye.svg?component";
	import ClothesIcon from "../assets/icons/equipment-chest.svg?component";
	import WarningIcon from "../assets/icons/pregame-warning.svg?component";
	import RandomizeIcon from "../assets/icons/hud-reset.svg?component";
	import BackIcon from "../assets/icons/hud-back.svg?component";
	import RotateIcon from "../assets/icons/layout-rotate.svg?component";
	import { onMount } from "svelte";
	import UiPaletteDropdown from "../app/UiPaletteDropdown.svelte";
	import UiTabs from "../app/UiTabs.svelte";
	import UiTabPanel from "../app/UiTabPanel.svelte";
	import { characterManagementPending } from "./client-character-selection";
	import { creationNameSchema } from "./client-character-creation-name";
	import ClientPregameScreen from "./ClientPregameScreen.svelte";
	import ClientPregameExpandableRow from "./ClientPregameExpandableRow.svelte";
	import ClientPregameCharacter from "./ClientPregameCharacter.svelte";
	import type { PregameCharacterPresentation } from "./client-pregame-character";
	import type { CharacterManagementState } from "./client-host-contract";
	import {
		characterCreationDraftSchema,
		CREATION_ATTRIBUTES,
		type CharacterCreationCatalog,
		type CharacterCreationDraft,
	} from "./client-character-creation-contract";
	import {
		CharacterCreationPreviewResolver,
		CharacterCreationStatsResolver,
		type CreationStatsResolution,
		creationAppearanceRequest,
		NO_CREATION_HEADGEAR,
		creationFaceFraming,
		creationGender,
		creationHeritage,
		creationPreviewSource,
		initialCreationDraft,
		initialCreationAppearance,
		randomizeCreationClothing,
		randomizeCreationAppearance,
		creationShadeIndex,
		type CharacterCreationServices,
		type CreationAppearance,
		type CreationPreviewResolution,
	} from "./client-character-creation";

	import {
		creationBuildControls,
		applyCreationAttribute,
		applyCreationSkill,
		creationSkillFormulaText,
		reconcileCreationHeritage,
	} from "./client-character-creation-build";

	interface Props {
		readonly services: CharacterCreationServices;
		readonly scene: PregameCharacterPresentation;
		readonly management: CharacterManagementState;
		/** Return to the character roster without submitting the draft. */
		readonly onBack: () => void;
	}
	const { services, scene, management, onBack }: Props = $props();
	type Editor = {
		readonly catalog: CharacterCreationCatalog;
		readonly draft: CharacterCreationDraft;
	};
	let editor = $state.raw<Editor | null>(null);
	// Retain edited visuals by race/body for this creator session; consumers read only on selection.
	const bodyAppearances = new Map<string, CreationAppearance>();
	let loadError = $state<string | null>(null);
	let commandError = $state<string | null>(null);
	// Inline name feedback starts after the first edit, rather than flagging the initial blank draft.
	let nameEdited = $state(false);
	let submission = $state.raw<{
		readonly before: CharacterManagementState;
	} | null>(null);
	let resolution = $state.raw<CreationPreviewResolution>({
		kind: "pending",
		previous: null,
	});
	let resolver: CharacterCreationPreviewResolver | null = null;
	let statsResolver: CharacterCreationStatsResolver | null = null;
	let statsResolution = $state.raw<CreationStatsResolution>({
		kind: "pending",
		previous: null,
	});
	const startingStats = $derived(
		statsResolution.kind === "pending"
			? statsResolution.previous
			: statsResolution.kind === "ready" &&
				  statsResolution.stats.kind === "standard"
				? statsResolution.stats
				: null,
	);
	const startingSkills = $derived(
		new Map(startingStats?.skills.map((skill) => [skill.id, skill]) ?? []),
	);
	function startingSkillLevel(id: number): string {
		const skill = startingSkills.get(id);
		if (skill === undefined)
			throw new Error(`Starting stats omitted skill ${id}.`);
		return skill.usable ? String(skill.value) : "Unavailable";
	}

	let face = $state(false);
	let page = $state<"race" | "appearance" | "skills-stats" | "review">("race");
	const tabs = [
		{
			value: "race",
			label: "Race",
			id: "creation-race-tab",
			panelId: "creation-race",
		},
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
		race: HeritageIcon,
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
		{ field: "eyes", count: "eyes", label: "Eyes", icon: EyeIcon },
		{ field: "nose", count: "noses", label: "Nose", icon: NoseIcon },
		{ field: "mouth", count: "mouths", label: "Mouth", icon: MouthIcon },
	] as const;
	const attributes = CREATION_ATTRIBUTES;
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
	const buildControls = $derived(
		editor === null || heritage === null
			? null
			: creationBuildControls(editor.catalog, heritage, editor.draft),
	);
	const balance = $derived(
		buildControls === null ? null : buildControls.balance,
	);

	const nameValidation = $derived(
		editor === null ? null : creationNameSchema.safeParse(editor.draft.name),
	);
	const nameError = $derived(
		nameEdited && nameValidation !== null && !nameValidation.success
			? nameValidation.error.issues[0].message
			: null,
	);

	const canSubmit = $derived(
		editor !== null &&
			balance !== null &&
			balance.attributes === 0 &&
			balance.skills >= 0 &&
			nameValidation?.success === true,
	);
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
		if (statsResolver === null)
			throw new Error("Character creation stats are not mounted.");
		statsResolver.request(draft);
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
	function randomizeAppearance(): void {
		const current = readEditor();
		const body = creationGender(
			creationHeritage(current.catalog, current.draft.heritage),
			current.draft.gender,
		);
		const draft = {
			...current.draft,
			appearance: randomizeCreationAppearance(
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
		if (
			heritageId === current.draft.heritage &&
			genderId === current.draft.gender
		)
			return;
		bodyAppearances.set(
			`${current.draft.heritage}:${current.draft.gender}`,
			current.draft.appearance,
		);
		const key = `${heritageId}:${genderId}`;
		let appearance = bodyAppearances.get(key);
		if (appearance === undefined) {
			const body = creationGender(
				creationHeritage(current.catalog, heritageId),
				genderId,
			);
			appearance = initialCreationAppearance(body, Math.random);
			bodyAppearances.set(key, appearance);
		}
		const draft =
			heritageId === current.draft.heritage
				? { ...current.draft, gender: genderId, appearance }
				: reconcileCreationHeritage(
						current.catalog,
						current.draft,
						heritageId,
						appearance,
					);
		updateDraft(draft);
		requestPreview(draft);
	}

	function changeHeritage(id: number): void {
		try {
			changeBody(id, readEditor().draft.gender);
		} catch (error) {
			commandError = error instanceof Error ? error.message : String(error);
		}
	}
	function changeAttribute(index: number, value: number): void {
		const controls = buildControls;
		if (controls === null) throw new Error("Creation controls are not loaded.");
		const control = controls.attributes[index];
		if (control === undefined)
			throw new Error(`Unknown creation attribute ${index}.`);
		updateDraft(applyCreationAttribute(readEditor().draft, control, value));
	}
	function changeSkill(id: number, direction: "upgrade" | "downgrade"): void {
		const controls = buildControls;
		if (controls === null) throw new Error("Creation controls are not loaded.");
		const row = controls.skills.find((entry) => entry.skill.id === id);
		if (row === undefined) throw new Error(`Unknown creation skill ${id}.`);
		updateDraft(applyCreationSkill(readEditor().draft, id, row[direction]));
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		nameEdited = true;
		if (busy || page !== "review" || !canSubmit) return;
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
		const statsOwner = new CharacterCreationStatsResolver(
			services.resolveStats,
			(state) => {
				if (current) statsResolution = state;
			},
		);
		statsResolver = statsOwner;
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
					initialCreationAppearance(gender, Math.random),
				);
				editor = { catalog, draft };
				statsOwner.request(draft);
				requestPreview(draft);
			})
			.catch((error: unknown) => {
				if (current)
					loadError = error instanceof Error ? error.message : String(error);
			});
		return () => {
			current = false;
			owner.dispose();
			statsOwner.dispose();
			statsResolver = null;
			resolver = null;
		};
	});
</script>

{#snippet startingVitals()}
	{#if startingStats !== null}
		<section aria-label="Starting vitals" class="creation-vitals">
			<h3 class="ui-section-heading">Starting vitals</h3>
			<dl
				class="creation-summary"
				aria-busy={statsResolution.kind === "pending"}
			>
				{#each ["Health", "Stamina", "Mana"] as label, index}
					<div>
						<dt>{label}</dt>
						<dd class="ui-mono" data-vital={label}>
							{startingStats.vitals[index]}
						</dd>
					</div>
				{/each}
			</dl>
		</section>
	{/if}
{/snippet}

<ClientPregameScreen branding="corner" showPortalLogo={true} backdrop={true}>
	{#snippet footer()}
		<button
			class="creation-back pregame-action pregame-quiet ui-button"
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
			<div class="creation-identity">
				<label class="creation-name ui-hud-group"
					><span id="creation-name-label" class="creation-name-label"
						>Character name</span
					><span class="creation-name-editor"
						><input
							class="ui-input"
							type="text"
							placeholder="Enter a name"
							title={nameError === null ? undefined : nameError}
							aria-labelledby="creation-name-label"
							aria-invalid={nameError !== null}
							aria-describedby={nameError === null
								? undefined
								: "creation-name-error"}
							required
							form="creation-review-form"
							disabled={busy || editor === null}
							value={editor === null ? "" : editor.draft.name}
							oninput={(event) => {
								nameEdited = true;
								updateDraft({
									...readEditor().draft,
									name: event.currentTarget.value,
								});
							}}
						/>
						{#if nameError !== null}
							<span
								class="creation-name-error-icon pregame-icon"
								title={nameError}
								aria-hidden="true"><WarningIcon /></span
							>
							<span id="creation-name-error" class="sr-only" role="alert"
								>{nameError}</span
							>
						{/if}
					</span>
				</label>
				<!-- Olthoi gender records share the same body and appearance choices; retain the draft value. -->
				{#if heritage === null || (heritage.id !== 12 && heritage.id !== 13)}
					<div class="creation-gender" role="group" aria-label="Gender">
						{#each [{ id: 1, name: "Male", icon: MaleIcon }, { id: 2, name: "Female", icon: FemaleIcon }] as choice}
							{@const Icon = choice.icon}
							<button
								class="ui-button ui-icon-button pregame-action pregame-round-button"
								type="button"
								data-gender={choice.id}
								aria-label={choice.name}
								title={choice.name}
								aria-pressed={editor !== null &&
									editor.draft.gender === choice.id}
								disabled={busy ||
									heritage === null ||
									!heritage.genders.some((body) => body.id === choice.id)}
								onclick={() =>
									changeBody(readEditor().draft.heritage, choice.id)}
							>
								<span class="pregame-icon" aria-hidden="true"><Icon /></span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
			<div class="creation-viewport">
				<ClientPregameCharacter
					source={source === null
						? null
						: { subjectId: "creation", visual: source }}
					{framing}
					{scene}
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
				{:else if editor === null || heritage === null || gender === null || balance === null || buildControls === null}
					<p role="status">Loading character choices…</p>
				{:else}
					{@const draft = editor.draft}
					<UiTabPanel
						id="creation-race"
						labelledBy="creation-race-tab"
						active={page === "race"}
					>
						<fieldset class="creation-fields" disabled={busy}>
							<legend class="sr-only">Race</legend>
							<label
								><span class="creation-label"
									><span class="pregame-icon" aria-hidden="true"
										><HeritageIcon /></span
									>Race</span
								><select
									class="ui-input"
									value={editor.draft.heritage}
									onchange={(event) => {
										changeHeritage(Number(event.currentTarget.value));
										event.currentTarget.value = String(
											readEditor().draft.heritage,
										);
									}}
									>{#each editor.catalog.heritages as choice}<option
											value={choice.id}>{choice.name}</option
										>{/each}</select
								></label
							>
						</fieldset>
						<section class="creation-lore" aria-label={`${heritage.name} lore`}>
							{#each heritage.lore as paragraph}<p>{paragraph}</p>{/each}
						</section>

						<section aria-label="Racial benefits">
							<h3 class="ui-section-heading">Racial benefits</h3>
							<ul>
								{#each heritage.benefits.descriptions as benefit}<li>
										{benefit}
									</li>{/each}
							</ul>
							{#each heritage.benefits.skillGroups as group}
								<section
									class="creation-starting-skills"
									aria-label={group.label}
								>
									<h4 class="ui-section-heading">{group.label}</h4>
									<ul>
										{#each group.skills as name}<li>{name}</li>{/each}
									</ul>
								</section>
							{/each}
						</section>
					</UiTabPanel>
					<UiTabPanel
						id="creation-appearance"
						labelledBy="creation-appearance-tab"
						active={page === "appearance"}
					>
						<fieldset class="creation-fields" disabled={busy}>
							<legend class="sr-only">Body and appearance</legend>
							{#each ordinalChoices as control}
								{@const Icon = control.icon}
								{#if gender[control.count] > 1}<div class="creation-field">
										<span
											class="creation-label"
											id={`creation-appearance-${control.field}`}
											><span class="pregame-icon" aria-hidden="true"
												><Icon /></span
											>{control.label}</span
										><span class="creation-variant creation-appearance-variant">
											<button
												class="ui-button ui-icon-button pregame-action pregame-round-button"
												type="button"
												aria-label={`Previous ${control.label}`}
												title={`Previous ${control.label}`}
												disabled={editor.draft.appearance[control.field] === 0}
												onclick={() =>
													changeAppearance(
														control.field,
														readEditor().draft.appearance[control.field] - 1,
													)}
											>
												<span
													class="pregame-icon creation-step-decrease"
													aria-hidden="true"><ChevronIcon /></span
												>
											</button>
											<input
												type="range"
												aria-labelledby={`creation-appearance-${control.field}`}
												min="0"
												max={gender[control.count] - 1}
												step="1"
												value={editor.draft.appearance[control.field]}
												aria-valuetext={`${editor.draft.appearance[control.field] + 1} of ${gender[control.count]}`}
												oninput={(event) =>
													changeAppearance(
														control.field,
														event.currentTarget.valueAsNumber,
													)}
											/>
											<button
												class="ui-button ui-icon-button pregame-action pregame-round-button"
												type="button"
												aria-label={`Next ${control.label}`}
												title={`Next ${control.label}`}
												disabled={editor.draft.appearance[control.field] ===
													gender[control.count] - 1}
												onclick={() =>
													changeAppearance(
														control.field,
														readEditor().draft.appearance[control.field] + 1,
													)}
											>
												<span
													class="pregame-icon creation-step-increase"
													aria-hidden="true"><ChevronIcon /></span
												>
											</button>
											<span class="ui-muted" aria-hidden="true"
												>{editor.draft.appearance[control.field] + 1} / {gender[
													control.count
												]}</span
											>
										</span>
									</div>{/if}
							{/each}
							<div class="creation-field">
								<span>Skin color</span><UiPaletteDropdown
									label="Skin color"
									colors={gender.skinColors}
									value={creationShadeIndex(
										editor.draft.appearance.skinHue,
										gender.skinColors.length,
									)}
									visible={page === "appearance"}
									disabled={busy}
									onchange={(index) =>
										changeAppearance(
											"skinHue",
											(index + 0.5) / gender.skinColors.length,
										)}
								/>
							</div>
							{#if gender.hairColors.length > 0}
								{@const shades =
									gender.hairColors[editor.draft.appearance.hairColor]}
								<div class="creation-field">
									<span>Hair color</span><UiPaletteDropdown
										label="Hair color"
										colors={gender.hairColors.map(
											(colors) =>
												colors[
													creationShadeIndex(
														draft.appearance.hairHue,
														colors.length,
													)
												],
										)}
										value={editor.draft.appearance.hairColor}
										visible={page === "appearance"}
										disabled={busy}
										onchange={(index) => changeAppearance("hairColor", index)}
									/>
								</div>
								<div class="creation-field">
									<span>Hair shade</span><UiPaletteDropdown
										label="Hair shade"
										colors={shades}
										value={creationShadeIndex(
											editor.draft.appearance.hairHue,
											shades.length,
										)}
										visible={page === "appearance"}
										disabled={busy}
										onchange={(index) =>
											changeAppearance(
												"hairHue",
												(index + 0.5) / shades.length,
											)}
									/>
								</div>
							{/if}
							{#if gender.eyeColors.length > 0}
								<div class="creation-field">
									<span>Eye color</span><UiPaletteDropdown
										label="Eye color"
										colors={gender.eyeColors}
										value={editor.draft.appearance.eyeColor}
										visible={page === "appearance"}
										disabled={busy}
										onchange={(index) => changeAppearance("eyeColor", index)}
									/>
								</div>
							{/if}
							<button
								class="pregame-action ui-button creation-randomize"
								type="button"
								onclick={randomizeAppearance}
								><span class="pregame-icon" aria-hidden="true"
									><RandomizeIcon /></span
								>Randomize appearance</button
							>

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
							<legend class="sr-only">Attributes and skills</legend>
							<section aria-labelledby="creation-attributes-heading">
								<h3
									id="creation-attributes-heading"
									class="ui-section-heading creation-build-heading"
								>
									Attributes
								</h3>
								<div class="creation-fields">
									{#each buildControls.attributes as control}
										<div class="creation-attribute-row">
											<details>
												<summary>{control.label}</summary>
												<div class="creation-description">
													<p>
														{editor.catalog.attributeDescriptions[
															control.index
														]}
													</p>
												</div>
											</details>
											<label
												><span class="sr-only">{control.label}</span><span
													class="creation-variant"
													><input
														type="range"
														class="creation-attribute-range"
														class:exhausted={buildControls.balance
															.attributes === 0}
														title={buildControls.balance.attributes === 0
															? "No attribute points remaining. Lower an attribute to reclaim points."
															: undefined}
														min={control.minimum}
														max={control.maximum}
														step="1"
														value={control.value}
														oninput={(event) =>
															changeAttribute(
																control.index,
																event.currentTarget.valueAsNumber,
															)}
													/><span class="ui-mono" aria-hidden="true"
														>{control.value}</span
													></span
												></label
											>
										</div>
									{/each}
								</div>
							</section>
							{@render startingVitals()}
							<section aria-labelledby="creation-skills-heading">
								<h3
									id="creation-skills-heading"
									class="ui-section-heading creation-build-heading"
								>
									Skills
								</h3>
								{#if startingStats !== null}<p class="ui-muted">
										Starting skill levels
									</p>{/if}
								<div class="creation-skill-groups">
									{#each advancements.toReversed() as group}
										{@const rows = buildControls.skills.filter(
											(row) => row.training === group.value,
										)}
										<section
											aria-labelledby={`creation-skill-group-${group.value}`}
										>
											<h4
												id={`creation-skill-group-${group.value}`}
												class="creation-skill-group-heading"
											>
												{group.label}
											</h4>
											{#if rows.length === 0}<p class="ui-muted">None</p>{/if}
											{#each rows as row (row.skill.id)}
												{@const formula = creationSkillFormulaText(
													row.skill.formula,
												)}
												<ClientPregameExpandableRow
													className="creation-skill-row"
												>
													{#snippet summary()}<span class="creation-skill-name"
															>{row.skill.name}</span
														>
														{#if startingStats !== null}
															{@const startingLevel = startingSkillLevel(
																row.skill.id,
															)}
															<span
																class="creation-skill-level ui-mono"
																data-starting-skill={row.skill.id}
																aria-label={`${row.skill.name} starting level: ${startingLevel}`}
																title={startingLevel}
																>{startingLevel === "Unavailable"
																	? "—"
																	: startingLevel}</span
															>
														{/if}
													{/snippet}
													{#snippet actions()}
														{#each ["downgrade", "upgrade"] as direction}
															{@const action =
																direction === "upgrade"
																	? row.upgrade
																	: row.downgrade}
															{@const caption =
																action.kind === "blocked"
																	? action.reason
																	: `${Math.abs(action.credits)} credits ${direction === "upgrade" ? "cost" : "refunded"}`}
															<button
																class="ui-stat-action"
																class:active={action.kind === "available"}
																type="button"
																data-direction={direction === "upgrade"
																	? "up"
																	: "down"}
																disabled={action.kind === "blocked"}
																aria-label={`${row.skill.name}: ${action.label}. ${caption}`}
																title={`${action.label}: ${caption}`}
																onclick={() =>
																	changeSkill(
																		row.skill.id,
																		direction === "upgrade"
																			? "upgrade"
																			: "downgrade",
																	)}
															>
																<span
																	class="ui-stat-action-shape"
																	aria-hidden="true"><UpgradeTriangle /></span
																><span class="ui-stat-action-label"
																	>{action.credits === null
																		? "—"
																		: Math.abs(action.credits)}</span
																>
															</button>
														{/each}
													{/snippet}

													{#if row.skill.description.length > 0}<p>
															{row.skill.description}
														</p>{/if}
													{#if formula !== null}<p class="ui-mono">
															Formula: {formula}
														</p>{/if}
												</ClientPregameExpandableRow>
											{/each}
										</section>
									{/each}
								</div>
							</section>
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
								<legend class="sr-only">Review and create</legend>
								<label
									>Starting town<select
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
								<dl class="creation-summary creation-review-identity ui-well">
									<div class="creation-review-name">
										<dt>Name</dt>
										<dd>{draft.name.trim() || "Not entered"}</dd>
									</div>
									<div>
										<dt>Race</dt>
										<dd>{heritage.name}</dd>
									</div>
									<div>
										<dt>Gender</dt>
										<dd>{gender.name}</dd>
									</div>
								</dl>
								<dl class="creation-summary creation-credit-balances ui-well">
									<div>
										<dt>Attribute points remaining</dt>
										<dd>{balance.attributes}</dd>
									</div>
									<div>
										<dt>Skill credits remaining</dt>
										<dd>{balance.skills}</dd>
									</div>
								</dl>
								<section aria-labelledby="creation-review-attributes-heading">
									<h3
										id="creation-review-attributes-heading"
										class="ui-section-heading"
									>
										Starting attributes
									</h3>
									<dl class="creation-summary creation-review-attributes">
										{#each attributes as label, index}<div>
												<dt>{label}</dt>
												<dd>{draft.attributes[index]}</dd>
											</div>{/each}
									</dl>
								</section>
								{@render startingVitals()}
								<div class="creation-review-skills">
									{#each advancements
										.filter((entry) => entry.value >= 2)
										.toReversed() as advancement}
										{@const skills = heritage.skills
											.filter(
												(skill) => draft.skills[skill.id] === advancement.value,
											)
											.toSorted((a, b) => a.name.localeCompare(b.name))}
										<section
											aria-labelledby={`creation-review-skills-${advancement.value}`}
										>
											<h3
												id={`creation-review-skills-${advancement.value}`}
												class="ui-section-heading"
											>
												{advancement.label} skills
											</h3>
											{#if skills.length === 0}<p class="ui-muted">
													None
												</p>{:else}<ul class="creation-skills">
													{#each skills as skill}<li>
															{skill.name}{#if startingStats !== null}<span
																	class="ui-mono"
																	data-starting-skill={skill.id}
																	>{startingSkillLevel(skill.id)}</span
																>{/if}
														</li>{/each}
												</ul>{/if}
										</section>
									{/each}
								</div>
							</fieldset>
						</form>
					</UiTabPanel>
				{/if}
				<div class="creation-feedback">
					{#if page === "skills-stats" && balance !== null}
						<dl
							class="creation-summary creation-credit-balances creation-build-balances ui-well"
							aria-label="Remaining creation points"
						>
							<div>
								<dt>Attribute points remaining</dt>
								<dd id="creation-attribute-credits">{balance.attributes}</dd>
							</div>
							<div>
								<dt>Skill credits remaining</dt>
								<dd id="creation-skill-credits">{balance.skills}</dd>
							</div>
						</dl>
					{/if}
					{#if statsResolution.kind === "failed"}<p
							class="ui-error"
							role="alert"
						>
							Starting stats: {statsResolution.message}
						</p>{/if}
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
				{#if page !== "race"}<button
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
						disabled={busy || !canSubmit}
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
			grid-template-rows: auto minmax(0, 1fr) auto;
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
			padding: 16px;
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
		.creation-fields label,
		.creation-field {
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
		.creation-identity {
			position: relative;
			z-index: 1;
			display: grid;
			justify-items: center;
		}
		.creation-gender {
			--creation-gender-size: 64px;
			position: absolute;
			top: calc(100% + 24px);
			display: grid;
			grid-template-columns: repeat(2, var(--creation-gender-size));
			align-items: center;
			justify-items: center;
			gap: 16px;
		}
		.creation-gender button {
			width: var(--creation-gender-size);
			height: var(--creation-gender-size);
			padding: 0;
		}
		/* Scale the entire control inside its reserved slot, including its border and glyph. */
		.creation-gender button[aria-pressed="false"] {
			transform: scale(0.8125);
		}

		.creation-starting-skills {
			margin-top: 16px;
		}
		.creation-gender .pregame-icon {
			width: calc(var(--creation-gender-size) * 0.75);
			height: calc(var(--creation-gender-size) * 0.75);
		}
		/* The appearance modifier must override the generic two-column variant grid. */
		.creation-variant.creation-appearance-variant {
			grid-template-columns: auto minmax(0, 1fr) auto auto;
			gap: 4px;
		}
		.creation-appearance-variant button {
			width: 24px;
			height: 24px;
		}
		.creation-step-decrease {
			transform: rotate(90deg);
		}
		.creation-step-increase {
			transform: rotate(-90deg);
		}
		.creation-name {
			position: relative;
			z-index: 1;
			width: min(100%, 14rem);
			padding-block: 10px;
			min-width: 0;
			justify-self: center;
			display: grid;
			gap: 8px;
		}
		.creation-name-editor {
			position: relative;
			display: block;
		}
		.creation-name-error-icon {
			position: absolute;
			inset-inline-start: calc(100% + 8px);
			top: 50%;
			transform: translateY(-50%);
		}

		.creation-name input {
			min-height: 40px;
			padding: 6px 8px;
			min-width: 0;
		}
		.creation-variant {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			gap: 8px;
		}
		.creation-variant input {
			width: 100%;
			min-width: 0;
			margin: 0;
		}
		.creation-variant > span {
			min-width: 6ch;
			text-align: right;
			font-variant-numeric: tabular-nums;
		}

		.creation-feedback {
			display: grid;
		}
		.creation-credit-balances.creation-build-balances {
			margin: 12px 16px 0;
		}

		.creation-lore {
			display: grid;
			gap: 12px;
			margin-block: 16px;
		}
		.creation-lore p {
			white-space: pre-line;
		}
		.creation-attribute-row {
			display: grid;
			grid-template-columns: minmax(100px, 1fr) minmax(120px, 1fr);
			align-items: start;
			gap: 12px;
		}
		.creation-fields .creation-attribute-row > label {
			display: block;
		}
		.creation-attribute-row summary {
			cursor: pointer;
		}
		.creation-skill-groups {
			display: grid;
			gap: 20px;
		}
		.creation-description {
			display: grid;
			gap: 8px;
			padding: 0 0 12px 14px;
		}
		.creation-description p {
			white-space: pre-wrap;
			overflow-wrap: anywhere;
		}
		.creation-skill-level {
			margin-inline-start: 8px;
		}
		.creation-vitals {
			display: grid;
			gap: 8px;
		}
		.creation-summary {
			display: grid;
			gap: 6px 16px;
			margin: 0;
		}
		.creation-summary > div {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: baseline;
			gap: 8px;
			min-width: 0;
		}
		.creation-summary dd {
			margin: 0;
			text-align: right;
			overflow-wrap: anywhere;
		}
		.creation-review-identity.ui-well,
		.creation-credit-balances.ui-well {
			padding: 12px;
		}
		.creation-credit-balances,
		.creation-review-attributes,
		.creation-review-skills {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 8px 20px;
		}
		.creation-credit-balances > div {
			grid-template-columns: minmax(0, 1fr);
			gap: 4px;
		}
		.creation-credit-balances dd {
			text-align: left;
		}
		.creation-review-skills > section {
			min-width: 0;
		}
		.creation-skills {
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.creation-skills li {
			display: flex;
			justify-content: space-between;
			gap: 12px;
			padding-block: 4px;
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
		@media (min-width: 851px) and (max-height: 900px) {
			/* Keep scaled text controls readable while reserving room for the world character. */
			.creation-rotate,
			.creation-focus .pregame-icon,
			.creation-back .pregame-icon {
				display: none;
			}
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

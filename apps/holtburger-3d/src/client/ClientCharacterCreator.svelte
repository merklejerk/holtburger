<script lang="ts">
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
	import ClientModelPreview from "./ClientModelPreview.svelte";
	import type { ClientObjectPreviewService } from "./client-object-preview-service";
	import type { CharacterManagementState } from "./client-host-contract";
	import {
		characterCreationDraftSchema,
		CREATION_ATTRIBUTES,
		type CharacterCreationCatalog,
		type CharacterCreationDraft,
	} from "./client-character-creation-contract";
	import {
		CharacterCreationPreviewResolver,
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
	} from "./client-character-creation-build";

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
				: initialCreationDraft(
						current.catalog,
						heritageId,
						genderId,
						current.draft.name,
						appearance,
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
							<legend class="sr-only">Race and starting town</legend>
							<label
								><span class="creation-label"
									><span class="pregame-icon" aria-hidden="true"
										><HeritageIcon /></span
									>Race</span
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
						</fieldset>
					</UiTabPanel>
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
							{#each ordinalChoices as control}
								{@const Icon = control.icon}
								{#if gender[control.count] > 1}<label
										><span class="creation-label"
											><span class="pregame-icon" aria-hidden="true"
												><Icon /></span
											>{control.label}</span
										><span class="creation-variant">
											<input
												type="range"
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
											<span class="ui-muted" aria-hidden="true"
												>{editor.draft.appearance[control.field] + 1} / {gender[
													control.count
												]}</span
											>
										</span></label
									>{/if}
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
										<label
											><span>{control.label}</span><span
												class="creation-variant"
												><input
													type="range"
													class="creation-attribute-range"
													class:exhausted={buildControls.balance.attributes ===
														0}
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
									{/each}
								</div>
							</section>
							<section aria-labelledby="creation-skills-heading">
								<h3
									id="creation-skills-heading"
									class="ui-section-heading creation-build-heading"
								>
									Skills
								</h3>
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
												<div class="creation-skill-row">
													<details>
														<summary>{row.skill.name}</summary>
														<div class="creation-skill-description">
															{#if row.skill.description.length > 0}<p>
																	{row.skill.description}
																</p>{/if}
															{#if formula !== null}<p class="ui-mono">
																	Formula: {formula}
																</p>{/if}
														</div>
													</details>
													<div class="creation-skill-actions">
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
													</div>
												</div>
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
									<div>
										<dt>Starting town</dt>
										<dd>
											{editor.catalog.startAreas.find(
												(area) => area.id === draft.startArea,
											)?.name}
										</dd>
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
													{#each skills as skill}<li>{skill.name}</li>{/each}
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

		.creation-skill-groups {
			display: grid;
			gap: 20px;
		}
		.creation-skill-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			column-gap: 12px;
		}
		.creation-skill-row details {
			min-width: 0;
		}
		.creation-skill-row summary {
			min-height: 36px;
			padding-block: 8px;
			overflow-wrap: anywhere;
			cursor: pointer;
		}
		.creation-skill-description {
			display: grid;
			gap: 8px;
			padding: 0 0 12px 14px;
		}
		.creation-skill-description p {
			white-space: pre-wrap;
			overflow-wrap: anywhere;
		}
		.creation-skill-actions {
			display: flex;
			align-self: start;
			gap: calc(8px * var(--ui-icon-scale));
			margin-block: 4px;
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

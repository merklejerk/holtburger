import {
	characterSheetSchema,
	progressionTargetKey,
	type CharacterSheet,
	type ProgressionIntent,
	type ProgressionQuote,
	type StatTarget,
} from "../../client/client-character-sheet-contract";
import { CLIENT_TUNING } from "../../client/client-tuning";

/** Existing session seams drive real purchase controls, authoritative updates and retained markup. */
interface Harness {
	setCharacterSheet(sheet: unknown): void;
	replyProgression(evaluation: unknown): void;
	inventoryDragCommands(): readonly {
		readonly command: string;
		readonly args: unknown;
	}[];
}

/** Verify rewards through the production sampled sheet and its DOM animation owner. */
export async function probeProgressionFeedback(
	harness: Harness,
	input: unknown,
) {
	const base = characterSheetSchema.parse(input);
	const skill = base.skills[0];
	if (skill === undefined)
		throw new Error("Progression feedback needs a skill fixture");
	let current: CharacterSheet = {
		...base,
		vitals: [],
		attributes: base.attributes.slice(0, 1),
		skills: [
			{
				...skill,
				stat: {
					...skill.stat,
					training: "Untrained" as const,
					ranks: 0,
					spent_xp: 0,
				},
			},
		],
	};
	const panel = document.querySelector<HTMLElement>(".character-sheet");
	if (panel === null) throw new Error("Missing character sheet");
	const sleep = (ms: number) =>
		new Promise((resolve) => setTimeout(resolve, ms));
	const settle = () =>
		sleep(CLIENT_TUNING.characterSheet.displayIntervalMs + 40);
	const row = (target: StatTarget) => {
		const value = [
			...panel.querySelectorAll<HTMLDetailsElement>(
				"[data-progression-target]",
			),
		].find(
			(row) => row.dataset.progressionTarget === progressionTargetKey(target),
		);
		if (value === undefined) throw new Error("Missing reward target");
		return value;
	};
	const labels = () => [
		...panel.querySelectorAll<HTMLElement>(".progression-reward-label"),
	];
	const requestId = () => {
		const request = harness
			.inventoryDragCommands()
			.filter((entry) => entry.command === "evaluate_client_progression")
			.at(-1)?.args;
		if (
			typeof request !== "object" ||
			request === null ||
			!("requestId" in request) ||
			typeof request.requestId !== "number"
		)
			throw new Error("Missing progression evaluation request");
		return request.requestId;
	};
	const offer = async (
		intent: ProgressionIntent,
		target: StatTarget,
		ranks: number,
		training: "Untrained" | null,
	): Promise<ProgressionQuote> => {
		const quote = {
			scope_id: 9,
			quote: {
				character: base.character,
				intent,
				target_state: { training, ranks, spent_xp: ranks * 100 },
				resulting_ranks: ranks + 1,
				xp_spent: 100,
				credits_spent: training === null ? 0 : 2,
				available_xp: base.level.unspentXp,
				available_credits: 2,
			},
		};
		harness.replyProgression({
			requestId: requestId(),
			evaluations: [{ intent, result: { Ok: quote } }],
		});
		await settle();
		const selected = row(target);
		selected.open = true;
		const group = selected.parentElement?.closest("details");
		if (group instanceof HTMLDetailsElement) group.open = true;
		await sleep(20);
		// Finish disclosure layout before scrolling the controls into view and starting a reward.
		await Promise.all(
			selected
				.getAnimations({ subtree: true })
				.filter((animation) => animation instanceof CSSTransition)
				.map((animation) => animation.finished),
		);
		selected.scrollIntoView({ block: "nearest" });
		await sleep(20);
		const button = selected.querySelector<HTMLButtonElement>(".actions button");
		if (button === null || button.disabled)
			throw new Error(`Reward purchase was unavailable: ${button?.title}`);
		const shape = button.querySelector<HTMLElement>(".ui-stat-action-shape");
		if (shape === null) throw new Error("Missing upgrade arrow");
		// Disclosure content can remain hidden until its opening transition starts.
		for (let i = 0; i < 100 && shape.getBoundingClientRect().width === 0; i++)
			await sleep(10);
		const before = shape.getBoundingClientRect();
		if (before.width === 0)
			throw new Error("Upgrade arrow did not become visible");
		button.dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
		);
		if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
			const press = button.getAnimations()[0];
			if (press === undefined)
				throw new Error("Upgrade press did not compress");
			press.pause();
			press.currentTime = CLIENT_TUNING.characterSheet.feedback.pressMs * 0.3;
			const during = shape.getBoundingClientRect();
			if (
				Math.abs(
					before.left + before.width / 2 - (during.left + during.width / 2),
				) > 0.5
			)
				throw new Error(
					`Upgrade press shifted the arrow horizontally: ${JSON.stringify({ before: before.toJSON(), during: during.toJSON(), button: button.getBoundingClientRect().toJSON(), shapeTransform: getComputedStyle(shape).transform, buttonTransform: getComputedStyle(button).transform })}`,
				);
			if (during.width >= before.width)
				throw new Error("Upgrade press did not shrink the arrow");
			press.play();
		}
		button.click();
		await sleep(20);
		return quote;
	};
	const waitForReward = async () => {
		for (let i = 0; i < 100; i++) {
			if (labels().length > 0) return;
			await sleep(10);
		}
		throw new Error("Confirmed upgrade did not animate");
	};
	harness.setCharacterSheet({ ...current, attributes: [], skills: [] });
	harness.setCharacterSheet(current);
	await settle();
	if (labels().length !== 0)
		throw new Error("Snapshot initialization celebrated an upgrade");
	const target = { Skill: skill.stat.skill_type };
	await offer(
		{ Train: { skill: skill.stat.skill_type } },
		target,
		0,
		"Untrained",
	);
	const dialog = document.querySelector<HTMLDialogElement>(
		"dialog.client-skill-training-dialog",
	);
	if (dialog === null) throw new Error("Missing training review");
	dialog
		.querySelector<HTMLButtonElement>(".ui-dialog-actions button:last-child")
		?.click();
	current = {
		...current,
		skills: [
			{
				...skill,
				stat: { ...skill.stat, training: "Trained", ranks: 0, spent_xp: 0 },
			},
		],
	};
	harness.setCharacterSheet(current);
	await waitForReward();
	if (
		!labels().some((label) => label.textContent === "Trained") ||
		!row(target).querySelector(".progression-training-wash")
	)
		throw new Error("Training did not celebrate its relocated row");
	const attr = current.attributes[0];
	if (attr === undefined) throw new Error("Missing reward attribute");
	const attribute = { Attribute: attr.attr_type };
	// Let training expire before checking independent rank labels.
	await sleep(CLIENT_TUNING.characterSheet.feedback.trainingMs + 20);
	const raise = async (checkSynergy: boolean) => {
		const stat = current.attributes[0];
		if (stat === undefined) throw new Error("Missing rank fixture");
		await offer(
			{ Raise: { target: attribute, ranks: 1 } },
			attribute,
			stat.ranks,
			null,
		);
		if (labels().length !== 0)
			throw new Error("Submission celebrated before confirmation");
		current = {
			...current,
			attributes: [
				{
					...stat,
					ranks: stat.ranks + 1,
					spent_xp: (stat.ranks + 1) * 100,
					base: stat.base + 1,
					current: stat.current + 1,
				},
			],
		};
		current = {
			...current,
			skills: current.skills.map((row) => {
				const formula = row.stat.breakdown.formula;
				if (typeof formula === "string")
					throw new Error("Synergy probe requires an applied formula");
				return {
					...row,
					stat: {
						...row.stat,
						base: row.stat.base + 1,
						current: row.stat.current + 1,
						breakdown: {
							...row.stat.breakdown,
							formula: {
								Applied: {
									...formula.Applied,
									first: {
										...formula.Applied.first,
										base: formula.Applied.first.base + 1,
									},
									base_result: formula.Applied.base_result + 1,
								},
							},
						},
					},
				};
			}),
		};
		if (checkSynergy) {
			const selected = row(attribute);
			selected.open = false;
			await sleep(20);
			await Promise.all(
				selected
					.getAnimations({ subtree: true })
					.filter((animation) => animation instanceof CSSTransition)
					.map((animation) => animation.finished),
			);
			selected.querySelector("summary")?.scrollIntoView({ block: "nearest" });
			await sleep(20);
		}
		harness.setCharacterSheet(current);
		await waitForReward();
		const value = row(target).querySelector<HTMLElement>(".progression-value");
		if (checkSynergy && (value === null || value.getAnimations().length === 0))
			throw new Error("Visible synergy increase did not glint");
	};
	await raise(true);
	if (
		labels().some(
			(label) =>
				!label.matches(":popover-open") ||
				getComputedStyle(label).pointerEvents !== "none",
		)
	)
		throw new Error(
			"Reward labels did not escape clipping in the noninteractive top layer",
		);
	const ring = panel.querySelector<HTMLElement>(".progression-reward-ring");
	if (ring !== null && !ring.matches(":popover-open"))
		throw new Error("Reward ring remained inside window clipping");
	if (!labels().some((label) => label.textContent === "+1"))
		throw new Error("Wrong confirmed rank label");
	const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
	if (still) {
		if (panel.querySelector(".progression-reward-ring"))
			throw new Error("Reduced motion retained an expanding ring");
		for (const animation of panel.getAnimations({ subtree: true })) {
			if (
				animation.effect instanceof KeyframeEffect &&
				animation.effect
					.getKeyframes()
					.some(
						(frame) =>
							typeof frame.transform === "string" && frame.transform !== "none",
					)
			)
				throw new Error("Reduced motion retained reward travel or scaling");
		}
	}
	// Exercise overlap separately with the disclosure kept open and its anchor stationary.
	await sleep(
		Math.max(
			CLIENT_TUNING.characterSheet.feedback.ringMs,
			CLIENT_TUNING.characterSheet.feedback.floatMs,
		) + 20,
	);
	await raise(false);
	// A second purchase before the first label expires must retain both independent effects.
	const stat = current.attributes[0];
	if (stat === undefined) throw new Error("Missing second rank fixture");
	await offer(
		{ Raise: { target: attribute, ranks: 1 } },
		attribute,
		stat.ranks,
		null,
	);
	current = {
		...current,
		attributes: [
			{ ...stat, ranks: stat.ranks + 1, spent_xp: (stat.ranks + 1) * 100 },
		],
	};
	harness.setCharacterSheet(current);
	for (let i = 0; i < 50 && labels().length < 2; i++) await sleep(10);
	if (labels().length !== 2)
		throw new Error("Rapid gains were combined, cancelled, or duplicated");
	const defenses = [
		...panel.querySelectorAll<HTMLButtonElement>("[role=tab]"),
	].find((tab) => tab.textContent?.includes("Defenses"));
	if (defenses === undefined) throw new Error("Missing defenses tab");
	defenses.click();
	await sleep(20);
	if (labels().length !== 0 || panel.querySelector(".progression-reward-ring"))
		throw new Error("Hidden progression retained reward effects");
	const progression = [
		...panel.querySelectorAll<HTMLButtonElement>("[role=tab]"),
	].find((tab) => tab.textContent?.includes("Progression"));
	progression?.click();
	await settle();
	if (labels().length !== 0)
		throw new Error("Reopening progression replayed rewards");
	await raise(false);
	const anchor = row(attribute).querySelector<HTMLElement>("summary");
	if (anchor === null) throw new Error("Missing movement anchor");
	anchor.style.translate = "1px 0";
	await sleep(50);
	anchor.style.removeProperty("translate");
	if (labels().length !== 0 || panel.querySelector(":popover-open"))
		throw new Error("Moving a reward anchor retained floating effects");
	return {
		topLayer: true,
		movementCleanup: true,
		reducedMotion: still,
		synergy: true,
		training: true,
		confirmedRanks: true,
		overlap: true,
		hiddenCleanup: true,
	};
}

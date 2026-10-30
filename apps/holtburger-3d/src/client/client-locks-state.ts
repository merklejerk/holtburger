import type { ClientEntitySelection } from "./client-entity-selection";
import type { ClientToastTone } from "./client-toast-center";
import type { AppraisalRequest } from "./client-appraisal-requests";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";
import type { CharacterSheet } from "./client-character-sheet-contract";
import type { ClientEntityFacts } from "./client-entity-mirror";
import type { ClientItemUseFinished } from "./client-item-use-contract";
import type {
	EscapeContextHandle,
	KeyboardInputPolicy,
} from "../lib/input/keyboard-input-policy";
import { allocateItemUseOperation } from "./client-item-use-sequence";

/** Only the observed identity and shared command boundaries are required. */
type Session = Pick<
	ClientLifecycleSession,
	"subscribe" | "appraisals" | "submitItemUse" | "queryItemUseTarget"
> & {
	/** Retained skill facts; only identity and training are needed for this UX. */
	readonly characterSheet: {
		read(): {
			readonly sheet: {
				readonly character: number;
				readonly skills: readonly {
					readonly stat: Pick<
						CharacterSheet["skills"][number]["stat"],
						"skill_type" | "training"
					>;
				}[];
			} | null;
		};
	};
	readonly entities: Pick<ClientLifecycleSession["entities"], "read">;
	readonly state: () => Pick<
		ReturnType<ClientLifecycleSession["state"]>,
		"playerGuid"
	>;
};
/** Usable exact-instance items remain stable when grouping or bonus order changes. */
export interface LockToolItem {
	/** Exact item instance used by the action. */
	readonly guid: number;
	/** Server-authored item or group label. */
	readonly name: string;
	/** Authored template bonus; unknown values use zero when ranking or estimating picks. */
	readonly bonus: number | null;
	/** Remaining uses rank key instances and break ties between equal-bonus picks. */
	readonly remainingUses: number | null;
}
/** Shared ordering for duplicate instances and their template groups. */
function compareRemainingUses(a: number | null, b: number | null): number {
	if (a === null || b === null) return Number(a === null) - Number(b === null);
	return a - b;
}

/** Current selected subject; submitted attempts retain their own captured identity. */
interface LockTarget {
	/** Selected identity matched by lock feedback or retained authoritative lock state. */
	readonly guid: number;
	/** Authored subject label retained for the title and completion feedback. */
	readonly name: string;
}

/** WCID is template equivalence, not proof of hidden key-code equality. */
interface LockKeyGroup {
	/** WCID group, or exact GUID when the template is unknown. */
	readonly id: string;
	/** Server-authored item or group label. */
	readonly name: string;
	/** Individually selectable instances; automatic mode chooses one. */
	readonly items: readonly [LockToolItem, ...LockToolItem[]];
}
/** Visible markup pulls this snapshot at the existing inventory display cadence. */
export interface LocksView {
	/** Only an explicit authoritative false Locked property establishes this state. */
	readonly unlocked: boolean;
	/** Usable inventory keys grouped for the distinct-template attempt snapshot. */
	readonly keys: readonly LockKeyGroup[];
	/** Automatic mode keeps key discovery internal and presents only lockpicks. */
	readonly showKeys: boolean;
	/** Actual distinct key attempts represented by the button. */
	readonly keyCount: number;
	/** Preferred usable pick and its current estimate; no selection step is needed. */
	readonly preferredPick: {
		readonly item: LockToolItem;
		readonly successPercent: number | null;
	} | null;
	/** Disables overlapping submissions, including while a cancelled use settles. */
	readonly pending: boolean;
}
/** One compatibility query or submitted use; cancellation retains only submitted ownership. */
interface PendingAttempt {
	/** Submitted target retained independently of later window retargeting or dismissal. */
	readonly target: LockTarget;
	/** Shared frontend identity for query, dispatch, and terminal receipt. */
	readonly sequence: number;
	/** Selected instance, retained even if consumption removes it. */
	readonly source: number;
	/** Other members of the same group, tried only when compatibility rejects this one. */
	readonly alternatives: readonly LockToolItem[];
	/** Captured automatic-key attribution survives consumption and workflow cancellation. */
	readonly automaticKeyName: string | null;
	/** Query cancellation is immediate; submitted use must await its receipt. */
	phase: "checking" | "submitted";
	/** Terminal receipt cannot schedule another key after explicit cancellation. */
	cancelled: boolean;
}
/** A key queue and its progress share one lifetime; cancellation retires them together. */
interface KeyRun {
	/** Only automatic wrong-key exhaustion may open the lockpick fallback. */
	readonly mode: "manual" | "automatic";
	/** Initial distinct-template count used by progress toasts. */
	readonly total: number;
	/** Captured group identities are resolved against fresh inventory before each attempt. */
	readonly remaining: string[];
	/** Completed or skipped groups determine the next progress ordinal. */
	completed: number;
}
/** Local UI admission and gameplay automation policy, sampled before each new action. */
interface UnlockHelperPolicy {
	/** Master UI preference controls the window and its automatic workflow. */
	readonly enabled: boolean;
	/** Automatic key preference is retained independently when the helper is disabled. */
	readonly autoUseKeys: boolean;
}
/** h3d workflow policy. Core admits and completes individual guarded uses only. */
export class ClientLocksState {
	readonly #session: Session;
	readonly #keyboard: Pick<KeyboardInputPolicy, "bindEscapeContext">;
	readonly #begin: () => void;
	readonly #notice: (message: string, tone: ClientToastTone) => void;
	/** Sample helper admission before new actions; capture automatic mode per encounter. */
	readonly #policy: () => UnlockHelperPolicy;
	/** App-owned local chat reporting, independent of toast presentation. */
	readonly #reportAutomaticUnlock: (message: string) => void;
	readonly #unsubscribe: () => void;
	/** Selection owns the interaction subject; inspection never mutates it. */
	readonly #selection: Pick<
		ClientEntitySelection,
		"selectedGuid" | "subscribe"
	>;
	readonly #unsubscribeSelection: () => void;
	readonly #listeners = new Set<() => void>();
	#target: LockTarget | null = null;
	/** Each preferred-pick refresh replaces correlation identity, rejecting stale estimates. */
	#estimate: {
		readonly sequence: number;
		readonly pick: LockToolItem;
		percent: number | null;
	} | null = null;
	/** One requested target appraisal per opening; a null handle retains completed-request knowledge. */
	#targetAppraisal: { request: AppraisalRequest | null } | null = null;
	#visible = false;
	#focusRevision = 0;
	#pending: PendingAttempt | null = null;
	/** Original use retains admission until its receipt, even after workflow cancellation. */
	#opening: {
		/** Only this direct-use receipt may start automatic keys. */
		readonly sequence: number;
		/** Cancel future work without forgetting the use still admitted by core. */
		cancelled: boolean;
	} | null = null;
	/** Repeated sound broadcasts for a cancelled opening must not rearm automation. */
	#lastOpeningSequence: number | null = null;
	#escape: EscapeContextHandle | null = null;
	/** Queue and progress are retired together; single-pick attempts have no key run. */
	#keyRun: KeyRun | null = null;
	/** Encounter policy remains stable while its key sequence and fallback settle. */
	#mode: "manual" | "automatic" = "manual";
	/** Last submitted attempt's target; retained for authoritative feedback after dismissal or UseDone. */
	#unlockWatch: {
		/** Submitted identity remains independent of a replacement chooser target. */
		readonly target: LockTarget;
		/** Null for manual tools and lockpicks; only automatic keys produce local chat. */
		readonly automaticKeyName: string | null;
	} | null = null;
	#destroyed = false;

	constructor(
		session: Session,
		keyboard: Pick<KeyboardInputPolicy, "bindEscapeContext">,
		begin: () => void,
		notice: (message: string, tone: ClientToastTone) => void,
		policy: () => UnlockHelperPolicy,
		reportAutomaticUnlock: (message: string) => void,
		selection: Pick<ClientEntitySelection, "selectedGuid" | "subscribe">,
	) {
		this.#selection = selection;
		this.#session = session;
		this.#keyboard = keyboard;
		this.#begin = begin;
		this.#notice = notice;
		this.#policy = policy;
		this.#reportAutomaticUnlock = reportAutomaticUnlock;
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
		this.#unsubscribeSelection = selection.subscribe((guid) =>
			this.#selectionChanged(guid),
		);
	}
	get visible(): boolean {
		return this.#visible;
	}
	get windowTitle(): string {
		return this.#target === null ? "Unlock" : `Unlock ${this.#target.name}`;
	}
	get focusRevision(): number {
		return this.#focusRevision;
	}
	subscribe(receive: () => void): () => void {
		this.#listeners.add(receive);
		return () => this.#listeners.delete(receive);
	}
	#entities(): ReadonlyMap<number, ClientEntityFacts> {
		const read = this.#session.entities.read();
		return read.kind === "current" ? read.level.entities : new Map();
	}
	read(): LocksView {
		const keys = new Map<
			string,
			{ id: string; name: string; items: [LockToolItem, ...LockToolItem[]] }
		>();
		const picks: LockToolItem[] = [];
		const sheet = this.#session.characterSheet.read().sheet;
		const training =
			sheet?.character === this.#session.state().playerGuid
				? sheet.skills.find((row) => row.stat.skill_type === "Lockpick")?.stat
						.training
				: undefined;
		const canLockpick = training === "Trained" || training === "Specialized";
		for (const item of this.#entities().values()) {
			if (!item.ownedByPlayer || item.lockTool === null) continue;
			const d = item.description;
			if (
				d.kind !== "known" ||
				d.structure.current === 0 ||
				d.useCapability !== "targeted"
			)
				continue;
			if (item.lockTool.kind === "lockpick" && !canLockpick) continue;
			const row: LockToolItem = {
				guid: item.guid,
				name: d.name,
				bonus: item.lockTool.kind === "lockpick" ? item.lockTool.bonus : null,
				remainingUses: d.structure.current,
			};
			if (item.lockTool.kind === "lockpick") picks.push(row);
			else {
				const key = row;
				const id = d.wcid !== null ? `wcid:${d.wcid}` : `guid:${item.guid}`;
				const group = keys.get(id);
				if (group === undefined)
					keys.set(id, { id, name: row.name, items: [key] });
				else group.items.push(key);
			}
		}
		const order = (a: LockToolItem, b: LockToolItem) =>
			a.name.localeCompare(b.name) || a.guid - b.guid;
		for (const group of keys.values())
			group.items.sort(
				(a, b) =>
					compareRemainingUses(a.remainingUses, b.remainingUses) || order(a, b),
			);
		const groups = [...keys.values()].sort(
			(a, b) =>
				compareRemainingUses(
					a.items[0].remainingUses,
					b.items[0].remainingUses,
				) ||
				a.name.localeCompare(b.name) ||
				a.id.localeCompare(b.id),
		);
		// Unknown bonuses use the agreed +0 estimate; unknown use counts follow known counts.
		picks.sort(
			(a, b) =>
				(b.bonus ?? 0) - (a.bonus ?? 0) ||
				compareRemainingUses(a.remainingUses, b.remainingUses) ||
				order(a, b),
		);
		const preferred = picks[0];
		return {
			keyCount: groups.length,
			preferredPick:
				preferred === undefined
					? null
					: {
							item: preferred,
							successPercent:
								this.#estimate?.pick.guid === preferred.guid
									? this.#estimate.percent
									: null,
						},
			keys: groups,
			showKeys: this.#mode === "manual",
			unlocked:
				this.#target !== null &&
				this.#entities().get(this.#target.guid)?.isLocked === false,
			pending: this.#pending !== null || this.#opening !== null,
		};
	}
	/** Retarget visible controls only; a selection change never starts automatic use. */
	#selectionChanged(guid: number | null): void {
		if (this.#target?.guid === guid) return;
		const wasVisible = this.#visible;
		this.close();
		const entity = guid === null ? undefined : this.#entities().get(guid);
		this.#target =
			entity?.isLocked === true && entity.description.kind === "known"
				? { guid: entity.guid, name: entity.description.name }
				: null;
		if (wasVisible && this.#target !== null) this.#showWindow();
		else this.#notify();
	}
	#open(target: LockTarget, sequence: number): void {
		if (this.#destroyed || this.#lastOpeningSequence === sequence) return;
		this.#lastOpeningSequence = sequence;
		if (!this.#policy().enabled) {
			this.#notice(`The ${target.name} is locked`, "status");
			return;
		}
		// Late feedback from an earlier selection must not restart its workflow.
		if (target.guid !== this.#selection.selectedGuid()) return;
		const mode = this.#policy().autoUseKeys ? "automatic" : "manual";
		// A newer hint cannot replace an opening or tool use that still owns its receipt.
		if (this.#opening !== null || this.#pending !== null) return;
		if (this.#target?.guid !== target.guid || this.#mode !== mode) {
			this.cancel();
			this.#estimate = null;
		}
		this.#target = target;
		this.#mode = mode;
		this.#opening = { sequence, cancelled: false };
		this.#targetAppraisal?.request?.cancel();
		this.#targetAppraisal = null;
		if (mode === "manual") {
			this.#showWindow();
			this.#notice(`The ${target.name} is locked`, "status");
			return;
		}
		this.#visible = false;
		this.#notify();
		this.#escape?.release();
		this.#escape = this.#keyboard.bindEscapeContext(() => this.cancel());
	}
	/** Resume only after the original guarded use has released core's admission owner. */
	#startAutomatic(): void {
		const target = this.#target;
		if (target === null || !this.#policy().enabled || this.#pending !== null)
			return;
		const view = this.read();
		if (view.unlocked) return;
		if (view.keys.length === 0) {
			this.#showWindow();
			this.#notice(`The ${target.name} is locked`, "status");
		} else this.#startKeys(view.keys, "automatic");
	}
	#showWindow(): void {
		const view = this.read();
		this.#visible =
			this.#policy().enabled &&
			this.#target !== null &&
			this.#target.guid === this.#selection.selectedGuid() &&
			this.#entities().has(this.#target.guid) &&
			!view.unlocked &&
			(view.preferredPick !== null || (view.showKeys && view.keyCount > 0));
		if (this.#visible) this.#focusRevision++;
		this.#requestTargetDetails();
		this.#refreshEstimate();
		this.#notify();
	}
	close(): void {
		this.cancel();
		this.#visible = false;
		this.#targetAppraisal?.request?.cancel();
		this.#targetAppraisal = null;
		this.#estimate = null;
		this.#notify();
	}
	/** One target request per opening, including when training/inventory qualifies later. */
	#requestTargetDetails(): void {
		const target = this.#target;
		if (
			this.#targetAppraisal === null &&
			this.#visible &&
			this.read().preferredPick !== null &&
			target !== null
		) {
			const request = this.#session.appraisals.request(target.guid, () => {
				if (this.#targetAppraisal?.request !== request) return;
				request.cancel();
				this.#targetAppraisal = { request: null };
			});
			this.#targetAppraisal = { request };
			void request.sent.catch((error: unknown) => {
				if (this.#targetAppraisal?.request !== request) return;
				request.cancel();
				this.#targetAppraisal = { request: null };
				this.#notice(`Could not examine the lock: ${String(error)}`, "warning");
				this.#notify();
			});
		}
	}
	#refreshEstimate(): void {
		const pick = this.read().preferredPick?.item;
		const target = this.#target;
		this.#estimate = null;
		if (this.#visible && target !== null && pick !== undefined) {
			const estimate = {
				sequence: allocateItemUseOperation(),
				pick,
				percent: null,
			};
			this.#estimate = estimate;
			void this.#session
				.queryItemUseTarget({
					sequence: estimate.sequence,
					source: pick.guid,
					target: target.guid,
				})
				.catch((error: unknown) => {
					if (this.#estimate !== estimate) return;
					this.#notice(
						`Could not estimate lockpick success: ${String(error)}`,
						"warning",
					);
					this.#notify();
				});
		}
		this.#notify();
	}
	/** Cancel future submissions, preserving any use already submitted to core. */
	cancel(): void {
		const wasOpening = this.#opening !== null && !this.#opening.cancelled;
		if (this.#opening !== null) this.#opening.cancelled = true;
		if (
			(!wasOpening && this.#pending === null && this.#keyRun === null) ||
			this.#pending?.cancelled
		)
			return;
		this.#keyRun = null;
		this.#escape?.release();
		this.#escape = null;
		if (this.#pending !== null) {
			if (this.#pending.phase === "checking") this.#pending = null;
			else this.#pending.cancelled = true;
			this.#notice(
				this.#pending === null
					? "Cancelled."
					: "Cancelled; the submitted attempt may still finish.",
				"status",
			);
		}
		this.#notify();
	}
	#canBegin(): boolean {
		return (
			!this.#destroyed &&
			this.#policy().enabled &&
			this.#visible &&
			this.#target !== null &&
			this.#target.guid === this.#selection.selectedGuid() &&
			this.#pending === null &&
			this.#opening === null &&
			!this.read().unlocked
		);
	}
	#beginAttempt(): void {
		this.#begin();
		this.#escape = this.#keyboard.bindEscapeContext(() => this.cancel());
	}
	/** One explicit click attempts the currently preferred pick, never an automatic retry. */
	lockpick(): void {
		if (!this.#canBegin()) return;
		const pick = this.read().preferredPick;
		if (pick === null) return;
		this.#beginAttempt();
		this.#keyRun = null;
		this.#checkCandidates([pick.item]);
	}
	attemptAll(): void {
		if (!this.#canBegin() || this.#mode !== "manual") return;
		const groups = this.read().keys;
		if (groups.length > 0) this.#startKeys(groups, "manual");
	}
	#startKeys(
		groups: readonly LockKeyGroup[],
		mode: "manual" | "automatic",
	): void {
		this.#beginAttempt();
		this.#keyRun = {
			mode,
			remaining: groups.map((group) => group.id),
			total: groups.length,
			completed: 0,
		};
		this.#nextGroup();
	}
	#nextGroup(): void {
		const run = this.#keyRun;
		if (run === null) return;
		while (run.remaining.length > 0) {
			const id = run.remaining.shift();
			const group = this.read().keys.find((entry) => entry.id === id);
			const candidates = group?.items ?? [];
			if (candidates.length > 0) {
				this.#checkCandidates(candidates);
				return;
			}
			if (run.mode === "automatic") {
				this.#stop("Key inventory changed; automatic attempts stopped.");
				return;
			}
			run.completed++;
			this.#notice(`${group?.name ?? id}: no available owned key.`, "status");
		}
		const automatic = run.mode === "automatic";
		this.#stop(
			automatic
				? "No inventory key fit."
				: "No more available key groups to attempt.",
		);
		if (automatic) {
			this.#showWindow();
		}
	}
	#checkCandidates(candidates: readonly LockToolItem[]): void {
		if (!this.#policy().enabled) {
			this.close();
			return;
		}
		const [candidate, ...alternatives] = candidates;
		if (candidate === undefined || this.#target === null) {
			if (this.#keyRun?.mode === "automatic") {
				this.#stop("No compatible key remains; automatic attempts stopped.");
				return;
			}
			if (this.#keyRun !== null) {
				this.#keyRun.completed++;
				this.#notice(
					"Key group skipped: no compatible instance remains.",
					"status",
				);
				this.#nextGroup();
			} else this.#stop("This tool cannot be used on that target.");
			return;
		}
		const source = candidate.guid;
		const pending: PendingAttempt = {
			target: this.#target,
			sequence: allocateItemUseOperation(),
			source,
			alternatives,
			automaticKeyName:
				this.#keyRun?.mode === "automatic" ? candidate.name : null,
			phase: "checking",
			cancelled: false,
		};
		this.#pending = pending;
		if (this.#keyRun !== null)
			this.#notice(
				`Trying keys… ${this.#keyRun.completed + 1}/${this.#keyRun.total}. Escape to cancel.`,
				"progress",
			);
		void this.#session
			.queryItemUseTarget({
				sequence: pending.sequence,
				source,
				target: this.#target.guid,
			})
			.catch((error: unknown) => {
				if (this.#pending === pending) this.#stop(String(error));
			});
		this.#notify();
	}
	#stop(message: string): void {
		this.#pending = null;
		this.#keyRun = null;
		if (!this.read().unlocked) this.#notice(message, "status");
		this.#escape?.release();
		this.#escape = null;
		this.#notify();
	}
	#observeUnlock(): void {
		const watch = this.#unlockWatch;
		if (watch === null) return;
		const watched = watch.target;
		const target = this.#entities().get(watched.guid);
		if (target === undefined) {
			this.#unlockWatch = null;
			return;
		}
		if (target.isLocked !== false) return;
		this.#unlockWatch = null;
		if (this.#target?.guid === watched.guid) {
			this.close();
		}
		this.#notice(`${watched.name} unlocked.`, "status");
		if (watch.automaticKeyName !== null)
			this.#reportAutomaticUnlock(
				`Used ${watch.automaticKeyName} to unlock ${watched.name}.`,
			);
	}
	#finish(result: ClientItemUseFinished): void {
		const opening = this.#opening;
		if (opening !== null && result.sequence === opening.sequence) {
			this.#opening = null;
			if (opening.cancelled) {
				this.#notify();
				return;
			}
			this.#escape?.release();
			this.#escape = null;
			if (
				result.outcome.kind !== "completed" ||
				result.outcome.error !== "None"
			) {
				this.close();
				return;
			}
			if (this.#mode === "automatic") this.#startAutomatic();
			this.#notify();
			return;
		}
		const pending = this.#pending;
		if (pending === null || result.sequence !== pending.sequence) return;
		if (
			result.outcome.kind === "completed" &&
			result.outcome.error !== "None" &&
			this.#unlockWatch?.target === pending.target
		)
			this.#unlockWatch = null;
		if (result.outcome.kind === "completed" && this.#keyRun !== null)
			this.#keyRun.completed++;
		if (pending.cancelled) {
			this.#stop(this.read().unlocked ? "Unlocked." : "Cancelled.");
			return;
		}
		if (result.outcome.kind === "timed-out") {
			this.#stop("Attempt timed out; its outcome is unknown.");
			return;
		}
		if (result.outcome.kind === "aborted") {
			this.#stop("Attempt ended; its outcome is unknown.");
			return;
		}
		this.#pending = null;
		if (
			result.outcome.error === "KeyDoesntFitThisLock" &&
			this.#keyRun !== null &&
			!this.read().unlocked
		)
			this.#nextGroup();
		else
			this.#stop(
				result.outcome.error === "None"
					? "Attempt completed."
					: result.outcome.error === "KeyDoesntFitThisLock"
						? "The key does not fit this lock."
						: result.outcome.message,
			);
	}
	#receive(event: ClientLifecycleSessionEvent): void {
		if (event.type === "locked-target") {
			this.#open(
				{ guid: event.target.target, name: event.target.name },
				event.target.sequence,
			);
			return;
		}
		if (event.type === "item-use-finished") {
			this.#finish(event.result);
			return;
		}
		if (
			event.type === "item-use-target-result" &&
			this.#estimate !== null &&
			event.result.sequence === this.#estimate.sequence
		) {
			this.#estimate.percent = event.result.lockpickSuccessPercent;
			this.#notify();
			return;
		}
		if (
			event.type === "object-inspection-result" &&
			this.#visible &&
			event.result.guid === this.#target?.guid
		) {
			this.#refreshEstimate();
			return;
		}
		const pending = this.#pending;
		if (
			event.type === "item-use-target-result" &&
			pending !== null &&
			event.result.sequence === pending.sequence &&
			pending.phase === "checking"
		) {
			if (!this.#policy().enabled) {
				this.close();
				return;
			}
			if (!event.result.eligible) {
				this.#checkCandidates(pending.alternatives);
				return;
			}
			const player = this.#session.state().playerGuid;
			if (player === null || this.#target === null) {
				this.#stop("The character or target is no longer available.");
				return;
			}
			pending.phase = "submitted";
			this.#unlockWatch = {
				target: pending.target,
				automaticKeyName: pending.automaticKeyName,
			};
			void this.#session
				.submitItemUse({
					sequence: pending.sequence,
					player,
					sourceOwned: true,
					intent: {
						kind: "targeted",
						source: pending.source,
						target: pending.target.guid,
					},
					expected: { kind: "ordinary" },
				})
				.catch((error: unknown) => {
					if (this.#pending === pending) {
						if (this.#unlockWatch?.target === pending.target)
							this.#unlockWatch = null;
						this.#stop(String(error));
					}
				});
			this.#notify();
			return;
		}
		if (
			event.type === "item-use-result" &&
			pending !== null &&
			event.result.sequence === pending.sequence &&
			event.result.outcome.kind !== "executed"
		) {
			if (this.#unlockWatch?.target === pending.target)
				this.#unlockWatch = null;
			this.#stop(
				event.result.outcome.kind === "rejected"
					? event.result.outcome.reason
					: "Tool consequences changed; attempt stopped.",
			);
			return;
		}
		if (
			event.type === "resyncing" ||
			event.type === "current-state" ||
			event.type === "exit-requested" ||
			(event.type === "lifecycle" && event.lifecycle.kind !== "in-world")
		) {
			this.close();
			this.#pending = null;
			this.#opening = null;
			this.#target = null;
			this.#unlockWatch = null;
			return;
		}
		if (event.type === "entities" || event.type === "character-sheet") {
			this.#observeUnlock();
			if (
				this.#keyRun?.mode === "automatic" ||
				(!this.#visible && this.#opening !== null)
			) {
				if (
					this.#target === null ||
					!this.#entities().has(this.#target.guid) ||
					this.read().unlocked
				)
					this.close();
				return;
			}
			if (!this.#visible) return;
			const view = this.read();
			if (
				this.#target === null ||
				!this.#entities().has(this.#target.guid) ||
				view.unlocked ||
				((!view.showKeys || view.keyCount === 0) && view.preferredPick === null)
			) {
				this.close();
				return;
			}
			this.#requestTargetDetails();
			const preferred = view.preferredPick?.item;
			const estimated = this.#estimate?.pick;
			if (
				event.type === "character-sheet" ||
				preferred?.guid !== estimated?.guid ||
				preferred?.bonus !== estimated?.bonus ||
				preferred?.remainingUses !== estimated?.remainingUses
			)
				this.#refreshEstimate();
		}
	}

	#notify(): void {
		for (const listener of this.#listeners) listener();
	}
	destroy(): void {
		this.close();
		this.#destroyed = true;
		this.#unlockWatch = null;
		this.#unsubscribe();
		this.#unsubscribeSelection();
		this.#listeners.clear();
	}
}

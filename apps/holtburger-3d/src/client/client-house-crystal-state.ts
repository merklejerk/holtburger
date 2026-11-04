import type { UiIconOwner, UiIconRepository } from "../app/ui-icon-repository";
import type {
	HousingCrystal,
	HousingPreviewRequest,
	HousingPreviewResult,
	HousingPaymentRequest,
	HousingSnapshot,
} from "./client-housing-contract";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";
import { CLIENT_TUNING } from "./client-tuning";
import { housingPaymentIcons } from "./client-housing-payment-icons";

type Quote = Extract<
	HousingPreviewResult["outcome"],
	{ kind: "ready" }
>["quote"];
type Purpose = HousingPreviewRequest["draft"]["purpose"];

/** Identity frozen at row drag start; no physical item is itself being dragged. */
export interface HousingRowDrag {
	readonly crystal: number;
	readonly purpose: Purpose;
	readonly revision: number;
	readonly wcid: number;
	readonly sources: readonly number[];
}

/** Facts and commands needed by the local draft, independently of mounted markup. */
export type HouseCrystalSession = Pick<
	ClientLifecycleSession,
	| "subscribe"
	| "previewHousingPayment"
	| "submitHousingPayment"
	| "housingSnapshot"
	| "entities"
	| "tradeSnapshot"
> & {
	readonly state: () => Pick<
		ReturnType<ClientLifecycleSession["state"]>,
		"playerGuid"
	>;
};

/** Actual selected inventory source with artwork, never a synthetic storage occupant. */
export interface HousingDraftCell {
	readonly item: number;
	readonly name: string;
	readonly iconKey: string;
}

/** One authoritative requirement and its draft projection, including unused selected sources. */
export interface HousingRequirementRow {
	readonly requirement: HousingCrystal["crystal"]["buy"][number];
	readonly quote: Quote["lines"][number] | null;
	readonly sources: readonly HousingDraftCell[];
	/** Only exact-WCID artwork is eligible; substitute note art cannot depict pyreals. */
	readonly iconKey: string | null;
}

/** Bounded display snapshot; core/world own all payment accounting. */
export interface HouseCrystalView {
	readonly profile: HousingCrystal;
	readonly purpose: Purpose;
	/** Tab selection is local UI state and survives progress-only publications. */
	readonly tab: "action" | "details";
	readonly items: readonly HousingDraftCell[];
	readonly rows: readonly HousingRequirementRow[];
	readonly quote: Quote | null;
	readonly pending: boolean;
	/** Submitted payment keeps admission blocked independently of this HUD's lifetime. */
	readonly paymentPending: boolean;
	/** Purchase requires full coverage; maintenance may contribute partially. */
	readonly canPay: boolean;
	readonly editable: boolean;
	readonly problem: string | null;
	readonly iconKeys: readonly string[];
	/** A new receipt promotes the existing HUD even when crystal identity is unchanged. */
	readonly focusRevision: number;
}

interface PendingPreview {
	readonly request: HousingPreviewRequest;
	readonly reportRejection: boolean;
}

/** Submitted identity survives HUD dismissal and mirrors core execution. */
type PendingPayment = NonNullable<HousingSnapshot["pendingPayment"]>;

let nextSequence = 0;
function sequence(): number {
	if (nextSequence === 0xffff_ffff)
		throw new Error("Housing request sequence exhausted");
	return ++nextSequence;
}

/** Frontend crystal interaction and draft lifetime; submitted execution will remain core-owned. */
export class ClientHouseCrystalState {
	readonly #owner: UiIconOwner;
	readonly #unsubscribe: () => void;
	#profile: HousingCrystal | null = null;
	#purpose: Purpose = "purchase";
	#tab: "action" | "details" = "action";
	#draftRevision = 0;
	#items: number[] = [];
	#quote: Quote | null = null;
	#preview: PendingPreview | null = null;
	#payment: PendingPayment | null = null;
	#problem: string | null = null;
	#visible = false;
	#hadPose = false;
	#revision = -1;
	#focusRevision = 0;
	#disposed = false;
	#containerRoot: number | null = null;
	#art = new Map<number, HousingDraftCell>();
	/** Requirement artwork is independent of the physical objects in the payment draft. */
	#requirementIcons = new Map<number, string>();

	constructor(
		readonly session: HouseCrystalSession,
		readonly icons: UiIconRepository,
		readonly reportFailure: (message: string) => void,
		/** Sample accepted poses on the consumer cadence, never through reactive state. */
		readonly distanceToCrystal: (crystal: number) => number | null,
		/** Peer policy closes vendor and external storage through their existing owners. */
		readonly onOpen: () => void,
	) {
		this.#owner = icons.createOwner("persistent");
		this.#containerRoot = this.#readContainerRoot();
		const pending = session.housingSnapshot().pendingPayment;
		if (pending !== null) this.#payment = pending;
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
		// A retained profile is knowledge, not permission to replay an opening receipt.
	}

	read(): HouseCrystalView | null {
		const profile = this.#profile;
		if (!this.#visible || profile === null) return null;
		const distance = this.distanceToCrystal(profile.crystal.crystal);
		if (distance !== null) this.#hadPose = true;
		if (
			(distance === null && this.#hadPose) ||
			(distance !== null &&
				distance > CLIENT_TUNING.housing.maximumDistanceMeters)
		) {
			this.close();
			return null;
		}
		const read = this.session.entities.read();
		if (read.kind === "current" && read.level.revision !== this.#revision) {
			this.#revision = read.level.revision;
			this.#items = this.#items.filter((id) => {
				const item = read.level.entities.get(id);
				return (
					item?.ownedByPlayer === true &&
					item.location.kind === "contained" &&
					item.description.kind === "known"
				);
			});
			this.#collectArtwork();
			if (this.#canPrepare())
				this.#request(this.#items, { kind: "quote" }, false);
			else this.#invalidate();
		}
		const editable =
			read.kind === "current" &&
			distance !== null &&
			this.#canPrepare() &&
			this.#preview === null;
		return {
			profile,
			purpose: this.#purpose,
			tab: this.#tab,
			items: this.#items.map((id) => {
				const cell = this.#art.get(id);
				if (cell === undefined)
					throw new Error(`Housing draft item ${id} has no artwork`);
				return cell;
			}),
			rows: this.#rows(),
			quote: this.#quote,
			pending: this.#preview !== null,
			paymentPending:
				this.#payment !== null ||
				this.session.housingSnapshot().pendingPayment !== null,
			canPay:
				editable &&
				this.#quote !== null &&
				(this.#purpose === "purchase"
					? this.#quote.complete
					: this.#quote.contributes),
			editable,
			problem: this.#problem,
			iconKeys: [...this.#iconKeys()],
			focusRevision: this.#focusRevision,
		};
	}

	/** Coarse drop admission; core resolves exact eligibility on release. */
	acceptsDrop(crystal: number, item: number): boolean {
		const view = this.read();
		const read = this.session.entities.read();
		const source =
			read.kind === "current" ? read.level.entities.get(item) : undefined;
		return (
			view?.editable === true &&
			view.profile.crystal.crystal === crystal &&
			source?.ownedByPlayer === true &&
			source.location.kind === "contained" &&
			source.description.kind === "known"
		);
	}

	add(crystal: number, wcid: number, item: number): void {
		if (!this.acceptsDrop(crystal, item)) return;
		this.#request(this.#items, { kind: "add", wcid, item }, true);
	}

	autoFill(wcid: number): void {
		if (this.read()?.editable === true)
			this.#request(this.#items, { kind: "fill", wcid }, true);
	}

	selectTab(tab: "action" | "details"): void {
		this.#tab = tab;
	}

	/** Capture exact draft identity; later profile edits or quotes retire this gesture. */
	captureRow(wcid: number): HousingRowDrag | null {
		const view = this.read();
		const sources = view?.quote?.lines.find(
			(line) => line.wcid === wcid,
		)?.sources;
		if (
			view?.editable !== true ||
			sources === undefined ||
			sources.length === 0
		)
			return null;
		return {
			crystal: view.profile.crystal.crystal,
			purpose: view.purpose,
			revision: this.#draftRevision,
			wcid,
			sources: [...sources],
		};
	}

	/** Remove draft identities only, never transfer the represented physical objects. */
	clearRow(drag: HousingRowDrag): void {
		const view = this.read();
		if (
			view?.editable !== true ||
			view.profile.crystal.crystal !== drag.crystal ||
			view.purpose !== drag.purpose ||
			this.#draftRevision !== drag.revision
		)
			return;
		const removed = new Set(drag.sources);
		this.#items = this.#items.filter((id) => !removed.has(id));
		this.#collectArtwork();
		this.#request(this.#items, { kind: "quote" }, false);
	}

	/** Submit the current validated draft once; core revalidates profile and consumption. */
	pay(): void {
		const view = this.read();
		const player = this.session.state().playerGuid;
		if (view?.canPay !== true || view.quote === null || player === null) return;
		const request: HousingPaymentRequest = {
			sequence: sequence(),
			player,
			draft: {
				crystal: view.profile.crystal.crystal,
				purpose: view.purpose,
				items: [...this.#items],
			},
			profile: view.profile.crystal,
			quote: view.quote,
		};
		const submitted: PendingPayment = {
			sequence: request.sequence,
			crystal: request.draft.crystal,
			purpose: request.draft.purpose,
		};
		this.#payment = submitted;
		this.#invalidate();
		void this.session.submitHousingPayment(request).catch((error: unknown) => {
			if (this.#disposed || this.#payment !== submitted) return;
			this.#payment = null;
			this.#revision = -1;
			this.reportFailure(`Housing payment dispatch failed: ${String(error)}`);
		});
	}

	close(): void {
		this.#visible = false;
		this.#items = [];
		this.#hadPose = false;
		this.#invalidate();
		this.#collectArtwork();
	}

	destroy(): void {
		this.#disposed = true;
		this.#unsubscribe();
		this.close();
		this.icons.releaseOwner(this.#owner);
	}

	#canPrepare(): boolean {
		const profile = this.#profile;
		return (
			this.#visible &&
			this.#payment === null &&
			this.session.housingSnapshot().pendingPayment === null &&
			profile !== null &&
			profile.crystal.active &&
			profile.crystal.houseType >= 1 &&
			profile.crystal.houseType <= 4 &&
			(this.#purpose === "purchase" ||
				(!profile.crystal.maintenanceFree && !profile.crystal.maintenancePaid))
		);
	}

	#invalidate(): void {
		this.#draftRevision += 1;
		this.#preview = null;
		this.#quote = null;
		this.#problem = null;
	}

	#request(
		items: readonly number[],
		operation: HousingPreviewRequest["operation"],
		reportRejection: boolean,
	): void {
		if (this.#profile === null) return;
		const pending: PendingPreview = {
			reportRejection,
			request: {
				sequence: sequence(),
				draft: {
					crystal: this.#profile.crystal.crystal,
					purpose: this.#purpose,
					items: [...items],
				},
				operation,
			},
		};
		this.#draftRevision += 1;
		this.#preview = pending;
		// Add/fill retain the accepted draft quote until the proposed edit is accepted.
		// Requotes follow actual draft/inventory changes and must discard old accounting.
		if (operation.kind === "quote") this.#quote = null;
		this.#problem = null;
		void this.session
			.previewHousingPayment(pending.request)
			.catch((error: unknown) => {
				if (this.#disposed || this.#preview !== pending) return;
				this.#preview = null;
				const message = `Housing preview failed: ${String(error)}`;
				this.#problem = pending.reportRejection ? null : message;
				this.reportFailure(message);
			});
	}

	#replaceProfile(profile: HousingCrystal): void {
		const purpose =
			profile.ownership === "available" ? "purchase" : "maintenance";
		if (
			profile.crystal.crystal !== this.#profile?.crystal.crystal ||
			purpose !== this.#purpose ||
			profile.crystal.owner !== this.#profile?.crystal.owner
		) {
			this.#items = [];
			this.#tab = "action";
			this.#hadPose = false;
			this.#revision = -1;
		}
		this.#profile = profile;
		this.#purpose = purpose;
		const read = this.session.entities.read();
		this.#revision = read.kind === "current" ? read.level.revision : -1;
		this.#invalidate();
		this.#collectArtwork();
		if (this.#canPrepare())
			this.#request(this.#items, { kind: "quote" }, false);
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		if (event.type === "housing-payment-finished") {
			const pending = this.#payment;
			if (
				pending === null ||
				pending.sequence !== event.result.sequence ||
				pending.crystal !== event.result.crystal
			)
				return;
			this.#payment = null;
			if (event.result.notify && event.result.outcome.kind !== "completed")
				this.reportFailure(event.result.outcome.reason);
			if (this.#profile?.crystal.crystal === event.result.crystal) {
				if (event.result.outcome.kind === "completed") this.#items = [];
				this.#revision = -1;
				this.#invalidate();
				this.#collectArtwork();
			}
		} else if (event.type === "housing-crystal-received") {
			if (this.session.tradeSnapshot().trade !== null) {
				this.reportFailure(
					"Finish the player trade before preparing housing payment.",
				);
				return;
			}
			this.onOpen();
			this.#visible = true;
			this.#focusRevision += 1;
			this.#tab = "action";
			this.#replaceProfile(event.crystal);
		} else if (event.type === "housing-updated") {
			if (event.housing.pendingPayment !== null)
				this.#payment = event.housing.pendingPayment;
			const profile = event.housing.crystal;
			if (
				profile === null ||
				(this.#profile !== null &&
					profile.crystal.crystal !== this.#profile.crystal.crystal)
			) {
				this.close();
				this.#profile = null;
				return;
			}
			if (
				profile !== null &&
				profile.crystal.crystal === this.#profile?.crystal.crystal &&
				JSON.stringify(profile) !== JSON.stringify(this.#profile)
			)
				this.#replaceProfile(profile);
		} else if (event.type === "housing-payment-preview") {
			const pending = this.#preview;
			if (
				!this.#visible ||
				pending === null ||
				event.result.sequence !== pending.request.sequence ||
				event.result.crystal !== this.#profile?.crystal.crystal
			)
				return;
			this.#preview = null;
			const outcome = event.result.outcome;
			if (outcome.kind === "ready") {
				this.#items = outcome.items;
				this.#quote = outcome.quote;
				this.#problem = null;
				this.#collectArtwork();
				const operation = pending.request.operation;
				if (operation.kind === "fill") {
					const line = outcome.quote.lines.find(
						(row) => row.wcid === operation.wcid,
					);
					const requirements =
						this.#purpose === "purchase"
							? this.#profile?.crystal.buy
							: this.#profile?.crystal.rent;
					const requirement = requirements?.find(
						(row) => row.wcid === operation.wcid,
					);
					if (line === undefined || requirement === undefined)
						throw new Error(
							"Housing auto-fill result lacks its requested requirement",
						);
					// Partial fills remain useful drafts; report insufficiency once for this receipt.
					if (line.shortfall > 0) {
						const reasons = [...new Set(outcome.unavailable)].join("\n");
						this.reportFailure(
							`Could not fill ${requirement.name}: ${line.shortfall.toLocaleString()} still needed.${reasons.length > 0 ? `\n${reasons}` : ""}`,
						);
					}
				}
			} else {
				this.#problem = pending.reportRejection ? null : outcome.reason;
				if (pending.reportRejection) this.reportFailure(outcome.reason);
			}
		} else if (event.type === "entities") {
			if (this.#storageOpened()) this.close();
			else {
				const read = this.session.entities.read();
				// Invalidate on receipt so a reply cannot commit against an older inventory
				// between display samples. Requoting remains consumer-paced in read().
				if (read.kind !== "current" || read.level.revision !== this.#revision)
					this.#invalidate();
			}
		} else if (
			event.type === "resyncing" ||
			event.type === "current-state" ||
			event.type === "exit-requested" ||
			(event.type === "lifecycle" && event.lifecycle.kind !== "in-world") ||
			event.type === "vendor-approached" ||
			(event.type === "trade-snapshot" && event.trade.trade !== null)
		) {
			if (event.type === "current-state") {
				const pending = this.session.housingSnapshot().pendingPayment;
				this.#payment = pending;
			}
			if (
				event.type === "exit-requested" ||
				(event.type === "lifecycle" &&
					event.lifecycle.kind !== "in-world" &&
					event.lifecycle.kind !== "portal-space")
			)
				this.#payment = null;
			this.close();
		}
	}

	#readContainerRoot(): number | null {
		const read = this.session.entities.read();
		return read.kind === "current" && read.level.worldContainer.kind === "open"
			? read.level.worldContainer.root
			: null;
	}

	#storageOpened(): boolean {
		const root = this.#readContainerRoot();
		const opened = root !== null && root !== this.#containerRoot;
		this.#containerRoot = root;
		return opened;
	}

	#rows(): HousingRequirementRow[] {
		if (this.#profile === null) return [];
		const requirements =
			this.#purpose === "purchase"
				? this.#profile.crystal.buy
				: this.#profile.crystal.rent;
		return requirements.map((requirement) => {
			const quote =
				this.#quote?.lines.find((line) => line.wcid === requirement.wcid) ??
				null;
			const sources = (quote?.sources ?? []).map((id) => {
				const source = this.#art.get(id);
				if (source === undefined)
					throw new Error(`Housing row source ${id} has no artwork`);
				return source;
			});
			return {
				requirement,
				quote,
				sources,
				iconKey: this.#requirementIcons.get(requirement.wcid) ?? null,
			};
		});
	}

	#iconKeys(): Set<string> {
		return new Set([
			...this.#requirementIcons.values(),
			...[...this.#art.values()].map((cell) => cell.iconKey),
		]);
	}

	#collectArtwork(): void {
		const read = this.session.entities.read();
		const oldKeys = this.#iconKeys();
		const selected = new Set(this.#items);
		const requirements =
			!this.#visible || this.#profile === null
				? []
				: this.#purpose === "purchase"
					? this.#profile.crystal.buy
					: this.#profile.crystal.rent;
		const required = new Set(requirements.map((row) => row.wcid));
		for (const id of this.#art.keys())
			if (!selected.has(id)) this.#art.delete(id);
		this.#requirementIcons.clear();
		// Physical draft cells and WCID hints have separate identities, but share icon leases.
		// One carried description per requirement suffices; unselected stacks need no cell records.
		if (read.kind === "current")
			for (const [id, facts] of read.level.entities) {
				const description = facts.description;
				if (description.kind !== "known") continue;
				const wcid = description.wcid;
				const requirementSource =
					wcid !== null &&
					facts.ownedByPlayer &&
					required.has(wcid) &&
					!this.#requirementIcons.has(wcid);
				if (!selected.has(id) && !requirementSource) continue;
				const iconKey = this.icons.retain(this.#owner, {
					kind: "item",
					...description.icon,
					itemType: description.itemType,
				});
				if (selected.has(id))
					this.#art.set(id, { item: id, name: description.name, iconKey });
				if (requirementSource) this.#requirementIcons.set(wcid, iconKey);
			}
		for (const requirement of requirements) {
			if (this.#requirementIcons.has(requirement.wcid)) continue;
			const reference = housingPaymentIcons.get(requirement.wcid);
			if (reference !== undefined)
				this.#requirementIcons.set(
					requirement.wcid,
					this.icons.retain(this.#owner, reference),
				);
		}
		// Owners lease keys, not objects: removing one source must not release a
		// shared icon still used by another source with the same artwork.
		const newKeys = this.#iconKeys();
		for (const key of oldKeys)
			if (!newKeys.has(key)) this.icons.release(this.#owner, key);
	}
}

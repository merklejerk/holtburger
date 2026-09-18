import type {
	ObjectInspection,
	ObjectInspectionResult,
} from "./client-object-inspection-contract";
import type { HexRgbaColor } from "../lib/frontend-color";
import type {
	ObjectPreviewResult,
	ObjectPreviewSource,
} from "./client-object-preview-contract";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";
import { CLIENT_TUNING } from "./client-tuning";
import { selectedEntityNameColor } from "./client-selected-entity-color";

type InspectionSession = Pick<
	ClientLifecycleSession,
	"examineEntity" | "subscribe" | "state"
> & {
	readonly entities: Pick<ClientLifecycleSession["entities"], "read">;
};

/** Latest-target presentation retained independently of mutable selection and entity mirrors. */
export type ClientObjectInspectionState =
	| { readonly kind: "idle" }
	| { readonly kind: "pending"; readonly guid: number }
	| {
			readonly kind: "ready";
			readonly guid: number;
			readonly inspection: ObjectInspection;
			/** Name color captured through the same policy as the selected-entity HUD. */
			readonly nameColor: HexRgbaColor | null;
			/** Null for item appraisal; creature previews retain their own cold readiness. */
			readonly preview: ClientObjectPreviewState | null;
	  };

/** Cold asset-readiness state for a ready creature examination. */
export type ClientObjectPreviewState =
	| { readonly kind: "pending" }
	| {
			readonly kind: "ready";
			readonly source: ObjectPreviewSource;
			/** Changes only when renderer-relevant source facts change. */
			readonly revision: number;
	  }
	| { readonly kind: "unavailable" };

/**
 * Owns the one-target/one-window inspection lifetime for a client session.
 *
 * The protocol echoes only a GUID, so a currently requested GUID is the complete correlation key.
 * At most one request is in flight; ready targets are refreshed on a cold, tunable cadence.
 * Selection changes and entity residency do not control this state machine; the entity mirror is
 * sampled only to capture presentation facts for the exact requested target.
 */
export class ClientObjectInspection {
	readonly #session: InspectionSession;
	readonly #reportFailure: (message: string) => void;
	readonly #listeners = new Set<(state: ClientObjectInspectionState) => void>();
	readonly #unsubscribe: () => void;
	#state: ClientObjectInspectionState = { kind: "idle" };
	#playerGuid: number | null;
	#refreshTimer: ReturnType<typeof setTimeout> | null = null;
	#refreshGuid: number | null = null;
	#refreshFailureReported = false;
	#previewFingerprint: string | null = null;
	#previewRevision = 0;
	#nameColor: HexRgbaColor | null = null;
	#destroyed = false;

	constructor(
		session: InspectionSession,
		reportFailure: (message: string) => void,
	) {
		this.#session = session;
		this.#reportFailure = reportFailure;
		this.#playerGuid = session.state().playerGuid;
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
	}

	read(): ClientObjectInspectionState {
		return this.#state;
	}

	subscribe(
		listener: (state: ClientObjectInspectionState) => void,
	): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Acquire this exact target, or immediately refresh it when its window is already ready. */
	async examine(guid: number): Promise<void> {
		if (this.#destroyed) throw new Error("Object inspection is unavailable.");
		if (this.#state.kind === "pending" && this.#state.guid === guid) return;
		if (this.#state.kind === "ready" && this.#state.guid === guid) {
			this.#cancelRefreshTimer();
			await this.#refresh();
			return;
		}
		this.#resetRefresh();
		this.#resetPreviewIdentity();
		this.#nameColor = this.#resolveNameColor(guid);
		this.#replace({ kind: "pending", guid });
		try {
			await this.#session.examineEntity(guid);
		} catch (error) {
			if (this.#state.kind !== "pending" || this.#state.guid !== guid) return;
			this.#nameColor = null;
			this.#replace({ kind: "idle" });
			this.#reportFailure(failureText(error));
		}
	}

	/** Close presentation only; no server command and no selection mutation occurs. */
	close(): void {
		this.#resetRefresh();
		this.#resetPreviewIdentity();
		this.#nameColor = null;
		this.#replace({ kind: "idle" });
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#unsubscribe();
		this.#nameColor = null;
		this.#replace({ kind: "idle" });
		this.#listeners.clear();
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		switch (event.type) {
			case "object-inspection-result":
				this.#accept(event.result);
				return;
			case "object-preview-result":
				this.#acceptPreview(event.result);
				return;
			case "resyncing":
				this.close();
				return;
			case "current-state": {
				const replacementPlayer = event.state.localPlayerGuid;
				if (
					event.state.lifecycle.kind !== "in-world" ||
					(this.#playerGuid !== null && replacementPlayer !== this.#playerGuid)
				)
					this.close();
				this.#playerGuid = replacementPlayer;
				return;
			}
			case "lifecycle":
				if (event.lifecycle.kind !== "in-world") this.close();
				return;
			case "exit-requested":
				this.close();
				return;
			default:
				return;
		}
	}

	#accept(result: ObjectInspectionResult): void {
		if (this.#state.kind === "idle" || result.guid !== this.#state.guid) return;
		if (this.#state.kind === "ready" && this.#refreshGuid !== result.guid)
			return;
		const guid = this.#state.guid;
		this.#refreshGuid = null;
		this.#refreshFailureReported = false;
		switch (result.outcome.kind) {
			case "ready":
				if (result.outcome.inspection.guid !== guid) {
					this.close();
					this.#reportFailure(
						"The examination response had mismatched identities.",
					);
					return;
				}
				if (result.outcome.inspection.details.kind === "item")
					this.#resetPreviewIdentity();
				this.#nameColor = this.#resolveNameColor(guid) ?? this.#nameColor;
				this.#replace({
					kind: "ready",
					guid,
					inspection: result.outcome.inspection,
					nameColor: this.#nameColor,
					preview:
						result.outcome.inspection.details.kind === "creature"
							? this.#state.kind === "ready" && this.#state.preview !== null
								? this.#state.preview
								: { kind: "pending" }
							: null,
				});
				this.#scheduleRefresh();
				return;
			case "rejected":
				this.close();
				this.#reportFailure("You could not examine that object.");
				return;
			case "missing":
				this.close();
				this.#reportFailure("That object is no longer available.");
		}
	}

	#acceptPreview(result: ObjectPreviewResult): void {
		if (
			this.#state.kind !== "ready" ||
			this.#state.preview === null ||
			result.guid !== this.#state.guid
		)
			return;
		switch (result.outcome.kind) {
			case "ready":
				if (result.outcome.source.guid !== this.#state.guid) {
					this.#resetPreviewIdentity();
					this.#replace({ ...this.#state, preview: { kind: "unavailable" } });
					this.#reportFailure(
						"The creature preview had mismatched identities.",
					);
					return;
				}
				{
					const fingerprint = objectPreviewFingerprint(result.outcome.source);
					if (
						this.#state.preview.kind === "ready" &&
						fingerprint === this.#previewFingerprint
					)
						return;
					this.#previewFingerprint = fingerprint;
					this.#previewRevision += 1;
				}
				this.#replace({
					...this.#state,
					preview: {
						kind: "ready",
						source: result.outcome.source,
						revision: this.#previewRevision,
					},
				});
				return;
			case "unavailable":
				this.#resetPreviewIdentity();
				this.#replace({ ...this.#state, preview: { kind: "unavailable" } });
		}
	}

	async #refresh(): Promise<void> {
		if (
			this.#destroyed ||
			this.#state.kind !== "ready" ||
			this.#refreshGuid !== null
		)
			return;
		const guid = this.#state.guid;
		this.#refreshGuid = guid;
		try {
			await this.#session.examineEntity(guid);
		} catch (error) {
			if (
				this.#state.kind !== "ready" ||
				this.#state.guid !== guid ||
				this.#refreshGuid !== guid
			)
				return;
			this.#refreshGuid = null;
			if (!this.#refreshFailureReported) {
				this.#refreshFailureReported = true;
				this.#reportFailure(failureText(error));
			}
			this.#scheduleRefresh();
		}
	}

	#scheduleRefresh(): void {
		this.#cancelRefreshTimer();
		if (
			this.#destroyed ||
			this.#state.kind !== "ready" ||
			this.#refreshGuid !== null
		)
			return;
		this.#refreshTimer = setTimeout(() => {
			this.#refreshTimer = null;
			void this.#refresh();
		}, CLIENT_TUNING.objectInspection.refreshIntervalMs);
	}

	#cancelRefreshTimer(): void {
		if (this.#refreshTimer === null) return;
		clearTimeout(this.#refreshTimer);
		this.#refreshTimer = null;
	}

	#resetRefresh(): void {
		this.#cancelRefreshTimer();
		this.#refreshGuid = null;
		this.#refreshFailureReported = false;
	}

	#resetPreviewIdentity(): void {
		this.#previewFingerprint = null;
		this.#previewRevision = 0;
	}

	#resolveNameColor(guid: number): HexRgbaColor | null {
		const read = this.#session.entities.read();
		if (read.kind === "pending") return null;
		const entity = read.level.entities.get(guid);
		if (entity === undefined || entity.description.kind === "pending")
			return null;
		return selectedEntityNameColor(
			entity.description,
			guid === read.level.playerGuid,
		);
	}

	#replace(state: ClientObjectInspectionState): void {
		if (this.#state.kind === "idle" && state.kind === "idle") return;
		this.#state = state;
		for (const listener of this.#listeners) listener(state);
	}
}

/** Canonical renderer identity for the strictly decoded, ordered preview contract. */
function objectPreviewFingerprint(source: ObjectPreviewSource): string {
	return JSON.stringify([
		source.guid,
		source.setupDid,
		source.appearance.paletteDid,
		source.appearance.subPalettes.map((entry) => [
			entry.paletteDid,
			entry.offset,
			entry.colorCount,
		]),
		source.appearance.textureChanges.map((entry) => [
			entry.partIndex,
			entry.oldTextureDid,
			entry.newTextureDid,
		]),
		source.appearance.partChanges.map((entry) => [
			entry.partIndex,
			entry.gfxObjDid,
		]),
		source.scale,
		source.translucency,
		source.pose.kind === "setup-pose"
			? [source.pose.kind]
			: [
					source.pose.kind,
					source.pose.firstCyclicClip,
					source.pose.clips.map((clip) => [
						clip.animationId,
						clip.lowFrame,
						clip.highFrame,
						clip.framerate,
					]),
				],
	]);
}

function failureText(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0)
		return error.message;
	if (typeof error === "string" && error.trim().length > 0) return error;
	return "The examination request could not be sent.";
}

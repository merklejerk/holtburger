import { multiplyMat4 } from "../math/matrices";
import { Mat4 } from "../math/types";
import type { PartRenderState } from "../systems/components";
import type {
	PreparedObjectPreviewAssets,
	PreparedObjectPreviewAttachment,
	PreparedObjectPreviewModel,
} from "./object-preview-composition";
import {
	ObjectPreviewModelPresentation,
	type ObjectPreviewFrame,
} from "./object-preview-model-presentation";
import { ObjectPreviewParticleFrame } from "./object-preview-particle-frame";
import type { ObjectPreviewSequence } from "./object-preview-sequence";

export type { ObjectPreviewFrame } from "./object-preview-model-presentation";

/** A direct attachment's source facts, runtime and mutable holding frame have one lifetime. */
interface AttachedPresentation {
	/** Resolved parent location and child model. */
	readonly source: PreparedObjectPreviewAttachment;
	/** Child animation/effects owner. */
	readonly runtime: ObjectPreviewModelPresentation;
	/** Reused rigid root produced from the subject's current part frame. */
	readonly root: Mat4;
}

/** An independent background is optional as a whole, including its runtime ownership. */
interface BackgroundPresentation {
	/** Prepared model and its draw-part offset. */
	readonly source: PreparedObjectPreviewModel;
	/** Background effects owner; never inherits subject heading. */
	readonly runtime: ObjectPreviewModelPresentation;
}

/** Initialized model owners move together; uninitialized/closed surfaces own no effects runtime. */
interface CompositionRuntime {
	/** Subject animation/effects owner. */
	readonly body: ObjectPreviewModelPresentation;
	/** Direct attachment owners with current holding frames. */
	readonly attachments: readonly AttachedPresentation[];
	/** Optional independent background owner. */
	readonly background: BackgroundPresentation | null;
}

type PresentationState =
	| { readonly kind: "uninitialized" }
	| { readonly kind: "active"; readonly runtime: CompositionRuntime }
	| { readonly kind: "disposed" };

/** Separate model runtimes publish one flat pose/material/particle frame to the merged draw path. */
export class ObjectPreviewPresentation {
	readonly #assets: PreparedObjectPreviewAssets;
	readonly #identity = Mat4.identity();
	readonly #partToPreview: Mat4[] = [];
	readonly #partRenderStates: PartRenderState[] = [];
	readonly #particles = new ObjectPreviewParticleFrame();
	/** A rebased cursor owns only the new model's dependencies, never the retired runtime. */
	readonly #initialBodySequence: ObjectPreviewSequence | null;
	#state: PresentationState = { kind: "uninitialized" };

	constructor(
		assets: PreparedObjectPreviewAssets,
		previous: ObjectPreviewPresentation | null,
	) {
		this.#assets = assets;
		this.#initialBodySequence =
			previous !== null && previous.#state.kind === "active"
				? previous.#state.runtime.body.replacementSequence(assets.body.visual)
				: null;
	}

	/** Initialize at first draw using its actual heading; hidden preparation spawns no effects. */
	advance(clockSeconds: number, subjectTransform: Mat4): ObjectPreviewFrame {
		if (this.#state.kind === "disposed")
			throw new Error("Cannot advance a disposed preview composition.");
		if (this.#state.kind === "uninitialized")
			this.#state = {
				kind: "active",
				runtime: this.#createRuntime(subjectTransform),
			};
		const runtime = this.#state.runtime;
		const body = runtime.body.advance(clockSeconds, subjectTransform);
		const frames = [body];
		this.#appendFrame(this.#assets.body, body);
		for (const attachment of runtime.attachments) {
			multiplyMat4(
				runtime.body.rigidPartFrame(attachment.source.parentPartIndex),
				attachment.source.offsetTransform,
				attachment.root,
			);
			const frame = attachment.runtime.advance(clockSeconds, attachment.root);
			this.#appendFrame(attachment.source.model, frame);
			frames.push(frame);
		}
		if (runtime.background !== null) {
			const frame = runtime.background.runtime.advance(
				clockSeconds,
				this.#identity,
			);
			this.#appendFrame(runtime.background.source, frame);
			frames.push(frame);
		}
		return {
			clockSeconds,
			partToPreview: this.#partToPreview,
			partRenderStates: this.#partRenderStates,
			...this.#particles.merge(frames),
		};
	}

	dispose(): void {
		if (this.#state.kind === "disposed") return;
		const state = this.#state;
		this.#state = { kind: "disposed" };
		this.#partToPreview.length = 0;
		this.#partRenderStates.length = 0;
		if (state.kind === "active") retireRuntime(state.runtime);
	}

	#createRuntime(subjectTransform: Mat4): CompositionRuntime {
		const body = new ObjectPreviewModelPresentation(
			this.#assets.body.visual,
			subjectTransform,
			this.#initialBodySequence,
		);
		const attachments: AttachedPresentation[] = [];
		let background: BackgroundPresentation | null = null;
		try {
			for (const source of this.#assets.attachments) {
				const root = multiplyMat4(
					body.rigidPartFrame(source.parentPartIndex),
					source.offsetTransform,
				);
				attachments.push({
					source,
					root,
					runtime: new ObjectPreviewModelPresentation(
						source.model.visual,
						root,
						null,
					),
				});
			}
			if (this.#assets.background !== null)
				background = {
					source: this.#assets.background,
					runtime: new ObjectPreviewModelPresentation(
						this.#assets.background.visual,
						this.#identity,
						null,
					),
				};
			return { body, attachments, background };
		} catch (cause) {
			try {
				retireRuntime({ body, attachments, background });
			} catch (cleanupCause) {
				throw new AggregateError(
					[cause, cleanupCause],
					"Preview model construction and rollback failed.",
					{ cause: cleanupCause },
				);
			}
			throw cause;
		}
	}

	#appendFrame(
		model: PreparedObjectPreviewModel,
		frame: ObjectPreviewFrame,
	): void {
		for (const [part, transform] of frame.partToPreview.entries()) {
			const state = frame.partRenderStates[part];
			if (state === undefined)
				throw new Error("Preview model frame omits its part material state.");
			this.#partToPreview[model.partOffset + part] = transform;
			this.#partRenderStates[model.partOffset + part] = state;
		}
	}
}

function retireRuntime(runtime: CompositionRuntime): void {
	const failures: unknown[] = [];
	const owners = [
		runtime.body,
		...runtime.attachments.map((attachment) => attachment.runtime),
	];
	if (runtime.background !== null) owners.push(runtime.background.runtime);
	for (const owner of owners) {
		try {
			owner.dispose();
		} catch (cause) {
			failures.push(cause);
		}
	}
	if (failures.length > 0)
		throw new AggregateError(
			failures,
			"Preview composition runtime retirement failed.",
		);
}

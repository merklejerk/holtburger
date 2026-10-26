import type { LocalSceneModelSource } from "../lib/game/runtime/local-scene-model";
import { completePresentationOperations } from "../lib/game/runtime/presentation-teardown";
import type { ObjectPreviewFraming } from "../lib/game/preview/object-preview-viewport";
import type { PregameCharacterRectangle } from "./client-pregame-camera";

/** Subject identity separates roster switches from edits to the same character. */
export interface PregameCharacterSource {
	readonly subjectId: string;
	readonly visual: LocalSceneModelSource;
}

/** Imperative surface input; dragging never publishes through the UI's reactive state. */
export interface PregameCharacterView {
	readonly rectangle: PregameCharacterRectangle;
	/** Turn from the neutral camera-facing heading. */
	readonly headingRadians: number;
	readonly framing: ObjectPreviewFraming;
}

/** Cold UI status is independent of world readiness and contains no rendering resources. */
export type PregameCharacterStatus =
	| { readonly kind: "empty" | "loading" | "suspended" }
	| {
			readonly kind: "ready";
			readonly replacement:
				| { readonly kind: "settled" | "loading" }
				| { readonly kind: "failed"; readonly message: string };
	  }
	| { readonly kind: "failed" | "limited"; readonly message: string };

/** A mounted page's authority expires when a newer page opens a surface. */
export interface PregameCharacterSurface {
	setSource(source: PregameCharacterSource | null): void;
	setView(view: PregameCharacterView | null): void;
	destroy(): void;
}

/** Scene drivers attach only while pregame owns the shared world. */
export interface PregameCharacterSink {
	setSource(source: PregameCharacterSource | null): void;
	setView(view: PregameCharacterView | null): void;
	subscribe(listener: (status: PregameCharacterStatus) => void): () => void;
}

/** One token keeps its source, layout and status recipient together across asynchronous scene binding. */
interface ActivePregameSurface {
	source: PregameCharacterSource | null;
	view: PregameCharacterView | null;
	readonly publish: (status: PregameCharacterStatus) => void;
	/** Release pointer capture and layout observers immediately when this page loses authority. */
	readonly revoke: () => void;
}

/** Retain the current page's intent across world construction/retry, with one active surface token. */
export class ClientPregameCharacterService {
	#surface: ActivePregameSurface | null = null;
	#sink: PregameCharacterSink | null = null;
	#closed = false;

	open(
		publish: (status: PregameCharacterStatus) => void,
		revoke: () => void,
	): PregameCharacterSurface {
		if (this.#closed)
			throw new Error("Cannot open a retired pregame character service.");
		this.#retireSurface();
		const surface: ActivePregameSurface = {
			source: null,
			view: null,
			publish,
			revoke,
		};
		this.#surface = surface;
		publish({ kind: "empty" });
		return {
			setSource: (source) => {
				if (this.#surface !== surface) return;
				surface.source = source;
				if (this.#sink !== null) this.#sink.setSource(source);
				else publish({ kind: source === null ? "empty" : "loading" });
			},
			setView: (view) => {
				if (this.#surface !== surface) return;
				surface.view = view;
				this.#sink?.setView(view);
			},
			destroy: () => {
				if (this.#surface !== surface) return;
				this.#retireSurface();
			},
		};
	}

	#retireSurface(): void {
		const previous = this.#surface;
		this.#surface = null;
		completePresentationOperations([
			() => this.#sink?.setSource(null),
			() => this.#sink?.setView(null),
			() => previous?.revoke(),
		]);
	}

	/** Binding does not own scene resources; the scene driver still joins its own retirement. */
	connect(sink: PregameCharacterSink): () => void {
		if (this.#closed || this.#sink !== null)
			throw new Error("Pregame character scene binding is unavailable.");
		this.#sink = sink;
		const unsubscribe = sink.subscribe((status) => {
			if (this.#sink !== sink) return;
			this.#surface?.publish(status);
		});
		sink.setView(this.#surface?.view ?? null);
		sink.setSource(this.#surface?.source ?? null);
		return () => {
			unsubscribe();
			if (this.#sink !== sink) return;
			this.#sink = null;
			this.#surface?.publish({
				kind: this.#surface.source === null ? "empty" : "loading",
			});
		};
	}

	destroy(): void {
		this.#closed = true;
		this.#retireSurface();
	}
}

/** Page capability binds the persistent world canvas to its pregame source/input owner. */
export interface PregameCharacterPresentation {
	readonly canvas: HTMLCanvasElement;
	readonly characters: Pick<ClientPregameCharacterService, "open">;
}

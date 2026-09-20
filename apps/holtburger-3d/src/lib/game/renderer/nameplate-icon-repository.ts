import type { NameplateIconId } from "../systems/dynamic-presentation-source";
import type {
	NameplateIconCatalog,
	NameplateIconSource,
} from "./nameplate-icon-source";

/** Prepared browser image with intrinsic dimensions and an explicit release action. */
export interface PreparedNameplateIcon {
	readonly height: number;
	readonly image: CanvasImageSource;
	readonly release: () => void;
	readonly width: number;
}

export type NameplateIconRead =
	| { readonly kind: "loading" }
	| { readonly kind: "ready"; readonly icon: PreparedNameplateIcon }
	| { readonly kind: "failed" };

export interface NameplateIconServices {
	readonly prepare: (
		source: NameplateIconSource,
	) => Promise<PreparedNameplateIcon>;
	readonly report: (source: NameplateIconSource, detail: string) => void;
}

interface Entry {
	readonly source: NameplateIconSource;
	state: NameplateIconRead;
}

export interface NameplateIconRepositoryDiagnostics {
	readonly failedCount: number;
	readonly loadingCount: number;
	readonly preparationCount: number;
	readonly readyCount: number;
	readonly releaseCount: number;
	readonly revision: number;
}

const loading: NameplateIconRead = Object.freeze({ kind: "loading" });

/** Renderer-lifetime SVG preparation with exact retained-population ownership. */
export class NameplateIconRepository {
	readonly #catalog: NameplateIconCatalog;
	readonly #services: NameplateIconServices;
	readonly #entries = new Map<NameplateIconId, Entry>();
	readonly #changed = new Set<NameplateIconId>();
	#revision = 0;
	#preparationCount = 0;
	#releaseCount = 0;
	#destroyed = false;

	constructor(catalog: NameplateIconCatalog, services: NameplateIconServices) {
		this.#catalog = catalog;
		this.#services = services;
	}

	/** Retain exactly the icon sources referenced by the installed nameplate population. */
	reconcile(ids: Iterable<NameplateIconId>): void {
		this.#requireAlive();
		const retained = new Set(ids);
		const sources = new Map(
			[...retained].map((id) => [id, this.#catalog.get(id)] as const),
		);
		for (const [id, entry] of this.#entries) {
			if (retained.has(id)) continue;
			if (entry.state.kind === "ready") this.#release(entry.state.icon);
			this.#entries.delete(id);
			this.#changed.delete(id);
		}
		for (const [id, source] of sources) {
			if (this.#entries.has(id)) continue;
			const entry: Entry = { source, state: loading };
			this.#entries.set(id, entry);
			this.#preparationCount += 1;
			void this.#prepare(id, entry);
		}
	}

	read(id: NameplateIconId): NameplateIconRead {
		this.#requireAlive();
		const entry = this.#entries.get(id);
		if (entry === undefined)
			throw new Error(`Nameplate icon is not retained: ${id}`);
		return entry.state;
	}

	/** Return and clear settled identities since the preceding frame boundary. */
	takeChanged(): readonly NameplateIconId[] {
		this.#requireAlive();
		const changed = [...this.#changed];
		this.#changed.clear();
		return changed;
	}

	diagnostics(): NameplateIconRepositoryDiagnostics {
		let failedCount = 0;
		let loadingCount = 0;
		let readyCount = 0;
		for (const entry of this.#entries.values()) {
			if (entry.state.kind === "failed") failedCount += 1;
			else if (entry.state.kind === "loading") loadingCount += 1;
			else readyCount += 1;
		}
		return {
			failedCount,
			loadingCount,
			preparationCount: this.#preparationCount,
			readyCount,
			releaseCount: this.#releaseCount,
			revision: this.#revision,
		};
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		for (const entry of this.#entries.values())
			if (entry.state.kind === "ready") this.#release(entry.state.icon);
		this.#entries.clear();
		this.#changed.clear();
	}

	async #prepare(id: NameplateIconId, entry: Entry): Promise<void> {
		try {
			const icon = await this.#services.prepare(entry.source);
			if (!this.#accepts(id, entry)) {
				this.#release(icon);
				return;
			}
			if (
				!Number.isFinite(icon.width) ||
				!Number.isFinite(icon.height) ||
				icon.width <= 0 ||
				icon.height <= 0
			) {
				this.#release(icon);
				throw new Error("decoded image has invalid intrinsic dimensions");
			}
			entry.state = Object.freeze({ kind: "ready", icon });
		} catch (error) {
			if (!this.#accepts(id, entry)) return;
			const detail = error instanceof Error ? error.message : String(error);
			entry.state = Object.freeze({ kind: "failed" });
			this.#services.report(entry.source, detail);
		}
		if (!this.#accepts(id, entry)) return;
		this.#revision += 1;
		this.#changed.add(id);
	}

	#accepts(id: NameplateIconId, entry: Entry): boolean {
		return !this.#destroyed && this.#entries.get(id) === entry;
	}

	#release(icon: PreparedNameplateIcon): void {
		icon.release();
		this.#releaseCount += 1;
	}

	#requireAlive(): void {
		if (this.#destroyed)
			throw new Error("Nameplate icon repository is destroyed.");
	}
}

/** Production SVG image preparation; the object URL lives exactly as long as the image. */
export function browserNameplateIconServices(): NameplateIconServices {
	return {
		async prepare(source) {
			const url = URL.createObjectURL(
				new Blob([source.svg], { type: "image/svg+xml" }),
			);
			const image = new Image();
			try {
				image.src = url;
				await image.decode();
				return {
					height: image.naturalHeight,
					image,
					release: () => {
						URL.revokeObjectURL(url);
						image.src = "";
					},
					width: image.naturalWidth,
				};
			} catch (error) {
				URL.revokeObjectURL(url);
				image.src = "";
				throw error;
			}
		},
		report: (source, detail) =>
			console.warn(`Nameplate icon preparation failed: ${source.label}`, {
				detail,
				iconId: source.id,
			}),
	};
}

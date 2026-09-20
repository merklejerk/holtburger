import openedContainerSvg from "./nameplate-icons/opened-container.svg?raw";
import {
	nameplateIconId,
	type NameplateIconId,
} from "../systems/dynamic-presentation-source";

/** Complete self-contained SVG registered under one stable presentation identity. */
export interface NameplateIconSource {
	readonly id: NameplateIconId;
	readonly label: string;
	readonly svg: string;
}

/** Immutable source lookup; browser resources belong to a separate renderer-owned repository. */
export class NameplateIconCatalog {
	readonly #sources = new Map<NameplateIconId, NameplateIconSource>();

	constructor(sources: Iterable<NameplateIconSource>) {
		for (const source of sources) {
			if (source.label.trim().length === 0)
				throw new Error(`Nameplate icon ${source.id} must have a label.`);
			if (source.svg.trim().length === 0)
				throw new Error(`Nameplate icon ${source.id} must have SVG content.`);
			if (this.#sources.has(source.id))
				throw new Error(`Duplicate nameplate icon ID: ${source.id}`);
			this.#sources.set(source.id, Object.freeze({ ...source }));
		}
	}

	get(id: NameplateIconId): NameplateIconSource {
		const source = this.#sources.get(id);
		if (source === undefined) throw new Error(`Unknown nameplate icon: ${id}`);
		return source;
	}
}

export const OPENED_CONTAINER_NAMEPLATE_ICON_ID =
	nameplateIconId("opened-container");

/** Built-in nameplate artwork available to both client and Explorer presentation. */
export const NAMEPLATE_ICON_CATALOG = new NameplateIconCatalog([
	{
		id: OPENED_CONTAINER_NAMEPLATE_ICON_ID,
		label: "Previously opened container",
		svg: openedContainerSvg,
	},
]);

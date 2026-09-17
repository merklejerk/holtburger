import { tick } from "svelte";
import type { UiIconDisplay, UiIconRepository } from "./ui-icon-repository";

/** Bounded display sampling with icon URLs retained until the replacement DOM has committed. */
export function startUiIconDisplay<T>(options: {
	readonly repository: UiIconRepository;
	readonly intervalMs: number;
	readonly read: () => T;
	readonly keys: (view: T) => Iterable<string>;
	readonly publish: (
		view: T,
		displays: ReadonlyMap<string, UiIconDisplay>,
	) => void;
}): { refresh(): void; destroy(): void } {
	const { repository } = options;
	const owner = repository.createOwner("display");
	let lastView: T | undefined;
	let lastRevision = -1;
	let displayedKeys = new Set<string>();
	let disposed = false;
	let sampling = false;
	let resample = false;
	const sample = async () => {
		if (disposed) return;
		if (sampling) {
			resample = true;
			return;
		}
		sampling = true;
		try {
			do {
				resample = false;
				const next = options.read();
				const revision = repository.revision;
				if (next === lastView && revision === lastRevision) break;
				const keys = new Set(options.keys(next));
				for (const key of keys) repository.retainKey(owner, key);
				const images = new Map(
					[...keys].map((key) => [key, repository.read(key)]),
				);
				lastView = next;
				lastRevision = revision;
				options.publish(next, images);
				await tick();
				for (const key of displayedKeys)
					if (!keys.has(key)) repository.release(owner, key);
				displayedKeys = keys;
			} while (resample && !disposed);
		} finally {
			sampling = false;
		}
	};
	const refresh = () => {
		void sample();
	};
	refresh();
	const timer = window.setInterval(refresh, options.intervalMs);
	return {
		refresh,
		destroy: () => {
			disposed = true;
			window.clearInterval(timer);
			void tick().then(() => repository.releaseOwner(owner));
		},
	};
}

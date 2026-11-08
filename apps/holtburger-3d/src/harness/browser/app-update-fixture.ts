import type { UpdateSnapshot } from "../../app/app-update-contract";

/** Cold native boundary fixture; production UI still decodes every publication. */
export function installAppUpdateFixture() {
	const previous = window.holtburgerUpdates;
	const listeners = new Set<(value: unknown) => void>();
	const footers = new Map<string, boolean>();
	let snapshot: UpdateSnapshot = {
		revision: 0,
		availability: { kind: "unknown" },
		check: { kind: "idle" },
	};
	let opened = 0;
	window.holtburgerUpdates = {
		snapshot: async () => snapshot,
		listen: (handler) => {
			listeners.add(handler);
			return () => {
				listeners.delete(handler);
			};
		},
		registerPregame: async (visible) => {
			const token = crypto.randomUUID();
			footers.set(token, visible);
			return token;
		},
		setPregameVisible: async (token, visible) => {
			if (!footers.has(token))
				throw new Error("Fixture footer registration is missing");
			footers.set(token, visible);
			return "active";
		},
		releasePregame: async (token) => {
			if (!footers.delete(token))
				throw new Error("Fixture footer registration is missing");
			return "retired";
		},
		refresh: async () => {},
		openHistory: async () => {
			opened++;
		},
		openDownloads: async () => {
			if (snapshot.availability.kind === "unknown")
				throw new Error("Fixture has no available update");
			opened++;
		},
	};
	const capability = {
		publish(
			availability: UpdateSnapshot["availability"],
			check: UpdateSnapshot["check"],
		) {
			snapshot = {
				revision: snapshot.revision + 1,
				availability,
				check,
			};
			for (const listener of listeners) listener(snapshot);
		},
		read: () => ({
			registrations: footers.size,
			visible: [...footers.values()].some(Boolean),
			listeners: listeners.size,
			opened,
		}),
	};
	window.__HOLTBURGER_UPDATE_FIXTURE__ = capability;
	return () => {
		window.holtburgerUpdates = previous;
		delete window.__HOLTBURGER_UPDATE_FIXTURE__;
	};
}

declare global {
	interface Window {
		/** Present only in the controlled browser update probe. */
		__HOLTBURGER_UPDATE_FIXTURE__?: {
			/** Publish a native-owned decision to the actual footer. */
			publish(
				availability: UpdateSnapshot["availability"],
				check: UpdateSnapshot["check"],
			): void;
			/** Verify registrations follow actual pregame/gameplay mounts. */
			read(): {
				registrations: number;
				visible: boolean;
				listeners: number;
				opened: number;
			};
		};
	}
}

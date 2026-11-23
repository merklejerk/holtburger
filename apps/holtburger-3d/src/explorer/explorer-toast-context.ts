import { getContext, setContext } from "svelte";
import type { HudToastTone } from "../app/hud/toast-center";

/** Publishes an ephemeral Explorer HUD toast notification. */
export type ExplorerToastPublisher = (input: {
	readonly message: string;
	readonly tone: HudToastTone;
}) => void;

const EXPLORER_TOAST_PUBLISHER = Symbol("explorer-toast-publisher");

/** Provide the Explorer toast publisher to descendant panels without prop-drilling. */
export function provideExplorerToastPublisher(
	publish: ExplorerToastPublisher,
): ExplorerToastPublisher {
	return setContext(EXPLORER_TOAST_PUBLISHER, publish);
}

/** Resolve the Explorer toast publisher provided by the app shell. */
export function useExplorerToastPublisher(): ExplorerToastPublisher {
	const publish = getContext<ExplorerToastPublisher | undefined>(
		EXPLORER_TOAST_PUBLISHER,
	);
	if (publish === undefined) {
		throw new Error("Explorer toast publisher was not provided.");
	}
	return publish;
}

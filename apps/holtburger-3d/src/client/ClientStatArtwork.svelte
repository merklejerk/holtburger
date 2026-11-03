<script lang="ts">
	import { onMount, untrack, type Snippet } from "svelte";
	import {
		browserUiIconRepository,
		type UiIconRepository,
		type UiIconDisplay,
	} from "../app/ui-icon-repository";
	import { startUiIconDisplay } from "../app/ui-icon-display";
	import {
		creationIconKey,
		failedStatIcon,
		provideStatIcons,
		statIconKind,
		type StatArtworkServices,
	} from "./client-stat-artwork";
	import { CLIENT_TUNING } from "./client-tuning";
	const {
		services,
		repository,
		visible,
		children,
	}: {
		/** Static references and image preparation from the current content source. */
		readonly services: StatArtworkServices;
		/** Gameplay shares its session repository; creation explicitly owns a standalone one. */
		readonly repository: UiIconRepository | null;
		/** Retained progression windows stop artwork display sampling while hidden. */
		readonly visible: boolean;
		/** Labels and controls remain available throughout image preparation and failure. */
		readonly children: Snippet;
	} = $props();
	const ownsIcons = untrack(() => repository === null);
	const icons = untrack(
		() => repository ?? browserUiIconRepository(services.prepare),
	);
	const owner = icons.createOwner("persistent");
	/** Both indexes belong to one accepted static response. */
	interface ArtworkIndex {
		/** Canonical and creator identities point to repository-owned image keys. */
		readonly pictures: ReadonlyMap<string, string>;
		/** Failed references retain the same identities without leasing nonexistent images. */
		readonly failures: ReadonlyMap<string, UiIconDisplay>;
	}
	let references: ArtworkIndex = { pictures: new Map(), failures: new Map() };
	let displays = $state<ReadonlyMap<string, UiIconDisplay>>(new Map());
	/** One discriminant owns completion and the optional query error. */
	let status = $state<
		| { readonly kind: "pending" | "ready" }
		| { readonly kind: "failed"; readonly detail: string }
	>({ kind: "pending" });
	const missing = failedStatIcon(
		"Static content contains no artwork reference for this stat",
	);
	function read(key: string): UiIconDisplay | undefined {
		return (
			displays.get(key) ?? (status.kind === "pending" ? undefined : missing)
		);
	}
	provideStatIcons({
		read: (target) => read(JSON.stringify(target)),
		creation: (kind, id) => read(creationIconKey(kind, id)),
	});
	let refresh: (() => void) | null = null;
	onMount(() => {
		let disposed = false;
		void services
			.load()
			.then((loadedReferences) => {
				if (disposed) return;
				const nextKeys = new Map<string, string>();
				const nextFailures = new Map<string, UiIconDisplay>();
				for (const reference of loadedReferences) {
					const keys = [
						JSON.stringify(reference.target),
						creationIconKey(
							statIconKind(reference.target),
							reference.creationId,
						),
					];
					if (reference.artwork.kind === "ready") {
						const key = icons.retain(owner, reference.artwork.spec);
						for (const identity of keys) nextKeys.set(identity, key);
					} else {
						console.error(
							`Stat artwork ${JSON.stringify(reference.target)}: ${reference.artwork.detail}`,
						);
						for (const identity of keys)
							nextFailures.set(
								identity,
								failedStatIcon(reference.artwork.detail),
							);
					}
				}
				references = { pictures: nextKeys, failures: nextFailures };
				status = { kind: "ready" };
				refresh?.();
			})
			.catch((error: unknown) => {
				if (disposed) return;
				status = {
					kind: "failed",
					detail: error instanceof Error ? error.message : String(error),
				};
				console.error("Stat artwork references failed", error);
				refresh?.();
			});
		return () => {
			disposed = true;
			icons.releaseOwner(owner);
			if (ownsIcons) icons.dispose();
		};
	});
	$effect(() => {
		if (!visible) return;
		const display = startUiIconDisplay({
			repository: icons,
			intervalMs: CLIENT_TUNING.statIcons.displayIntervalMs,
			read: () => references,
			keys: (next) => next.pictures.values(),
			publish: (next, images) => {
				const sampled = new Map(next.failures);
				for (const [identity, key] of next.pictures) {
					const image = images.get(key);
					if (image === undefined)
						throw new Error("Stat artwork display omitted a retained icon");
					sampled.set(identity, image);
				}
				displays = sampled;
			},
		});
		refresh = display.refresh;
		return () => {
			refresh = null;
			display.destroy();
		};
	});
</script>

{#if status.kind === "failed"}<p class="ui-error" role="status">
		Stat icons unavailable: {status.detail}
	</p>{/if}
{@render children()}

import { CLIENT_PREGAME_CAMERA_TUNING } from "../../client/client-pregame-tuning";
import { modelHeadingDegrees } from "../../client/client-model-rotation";
import { mount, tick, unmount } from "svelte";
import ClientPregameCharacter from "../../client/ClientPregameCharacter.svelte";
import type { ClientPresentationRoot } from "../../client/client-presentation-root";
import type {
	PregameCharacterPresentation,
	PregameCharacterStatus,
} from "../../client/client-pregame-character";
import type { GamePresentationOwner } from "../../lib/game/runtime/game-presentation-owner";
import type { LocalSceneModelSource } from "../../lib/game/runtime/local-scene-model";

/** Mount the production surface against the actual scene, including overlapping outgoing-page cleanup. */
export async function probePregameSurface(
	root: ClientPresentationRoot<GamePresentationOwner>,
	owner: GamePresentationOwner,
	canvas: HTMLCanvasElement,
	source: LocalSceneModelSource,
	frame: () => Promise<void>,
) {
	const nativeObserver = globalThis.ResizeObserver;
	const observers = new Set<ResizeObserver>();
	const observerCount = () => observers.size;
	globalThis.ResizeObserver = class extends nativeObserver {
		constructor(callback: ResizeObserverCallback) {
			super(callback);
			observers.add(this);
		}
		disconnect() {
			super.disconnect();
			observers.delete(this);
		}
	};
	const baseline =
		owner.runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.entityCount;
	const containers: HTMLElement[] = [];
	const components: ReturnType<typeof mount>[] = [];
	const statuses = new Map<number, PregameCharacterStatus>();
	const open = async (id: number) => {
		const container = document.createElement("div");
		container.style.cssText =
			"position: fixed; top: 0; left: 0; width: 512px; height: 512px;";
		document.body.append(container);
		containers.push(container);
		const scene: PregameCharacterPresentation = {
			canvas,
			characters: {
				open: (publish, revoke) =>
					root.pregameCharacters.open((status) => {
						statuses.set(id, status);
						publish(status);
					}, revoke),
			},
		};
		const component = mount(ClientPregameCharacter, {
			target: container,
			props: {
				scene,
				source: { subjectId: `surface:${id}`, visual: source },
				framing: { kind: "body" },
			},
		});
		components.push(component);
		await tick();
		return { container, component };
	};
	const settle = async (id: number, kind: PregameCharacterStatus["kind"]) => {
		const deadline = performance.now() + 20_000;
		for (;;) {
			await frame();
			const status = statuses.get(id);
			if (status?.kind === kind) return;
			if (status?.kind === "failed") throw new Error(status.message);
			if (performance.now() > deadline)
				throw new Error(
					`Mounted pregame surface ${id} did not reach ${kind}: ${JSON.stringify(status)}`,
				);
		}
	};
	try {
		const first = await open(1);
		await settle(1, "ready");
		const initialYaw = first.container
			.querySelector('[role="slider"]')
			?.getAttribute("aria-valuenow");
		if (
			initialYaw !==
			String(
				modelHeadingDegrees(CLIENT_PREGAME_CAMERA_TUNING.initialYawRadians),
			)
		)
			throw new Error("Pregame surface did not apply its initial yaw tuning.");

		first.container.style.width = "2px";
		await settle(1, "limited");
		first.container.style.width = "512px";
		await settle(1, "ready");
		const second = await open(2);
		await settle(2, "ready");
		if (observerCount() !== 1)
			throw new Error(
				"Outgoing surface retained its layout observer after revocation.",
			);
		first.container.style.width = "2px";
		await unmount(first.component);
		components.splice(components.indexOf(first.component), 1);
		await frame();
		if (statuses.get(2)?.kind !== "ready" || observerCount() !== 1)
			throw new Error(
				"Outgoing page cleanup withdrew the current scene surface.",
			);
		await unmount(second.component);
		components.splice(components.indexOf(second.component), 1);
		await frame();
		if (
			observerCount() !== 0 ||
			owner.runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics
				.entityCount !== baseline
		)
			throw new Error(
				"Mounted surface retirement retained observers or local scene models.",
			);
		return {
			mountedProductionSurfaceDrew: true,
			measuredResizeRecovered: true,
			revokedObserverRetired: true,
			outgoingCleanupPreservedCurrentSubject: true,
			remainingLayoutObservers: observerCount(),
		};
	} finally {
		for (const component of components) await unmount(component);
		for (const container of containers) container.remove();
		globalThis.ResizeObserver = nativeObserver;
	}
}

import type { DatAssetId } from "../game-types";
import type { RenderVector3 } from "../../assets/ac-frame";
import type { Vec3 } from "../math/types";

/**
 * One authored behavior command, independent of which producer scheduled it.
 *
 * Animations and physics scripts are two clocks dispatching the same hook vocabulary, so they
 * compile into this single semantic union and carry their own provenance alongside it rather than
 * wrapping it in producer-specific shapes. Arms hold target-relative authored values; nothing here
 * knows about frames, script times, entities, or scene nodes.
 */
export type PreparedBehaviorCommand =
	| {
			readonly kind: "set-omega";
			/** Angular velocity already converted into the app's render coordinate system. */
			readonly omega: Vec3;
	  }
	| (TransparentPartValues & { readonly kind: "transparent-part" })
	| {
			readonly kind: "scale";
			/** Uniform scale reached when the ramp completes. */
			readonly end: number;
			readonly durationSeconds: number;
	  }
	| {
			readonly kind: "texture-velocity";
			readonly uSpeed: number;
			readonly vSpeed: number;
	  }
	| {
			readonly kind: "texture-velocity-part";
			readonly partIndex: number;
			readonly uSpeed: number;
			readonly vSpeed: number;
	  }
	| {
			readonly kind: "sound-table";
			/** Retail `SoundType` key resolved against the owning object's sound table. */
			readonly soundType: number;
	  }
	| {
			readonly kind: "sound-tweaked";
			readonly soundId: DatAssetId;
			/** Play chance rolled at trigger time; retail reads this float, not the next one. */
			readonly probability: number;
			readonly volume: number;
	  }
	| {
			readonly kind: "create-particle";
			readonly emitterInfoId: DatAssetId;
			/** `-1` addresses the whole object; any other value addresses a part. */
			readonly partIndex: number;
			/** Spawn offset added to the parent frame's origin; retail ignores the authored rotation. */
			readonly offsetOrigin: RenderVector3;
			/** `0` requests an auto-assigned id; nonzero replaces any same-id emitter. */
			readonly emitterId: number;
	  }
	| {
			readonly kind: "call-pes";
			readonly scriptId: DatAssetId;
			/** Upper bound of a uniform random activation delay, not a fixed delay. */
			readonly pauseSeconds: number;
	  }
	| {
			readonly kind: "replace-object";
			readonly rawPayload: Uint8Array;
	  }
	| {
			readonly kind: "semantic";
			readonly command: "no-op" | "animation-done";
	  }
	| {
			readonly kind: "unimplemented";
			readonly command: string;
			readonly sourceType: number;
			readonly payload: UnimplementedCommandPayload;
			/**
			 * Whether an owner carrying this command must retain its static presentation.
			 *
			 * Decided once here, at the layer that knows what each hook family would have changed:
			 * a missing ambient effect is a gap the viewer cannot detect as *wrong*, but a missing
			 * structural or visibility change would render the object incorrectly.
			 */
			readonly blocksActivation: boolean;
	  };

/** Typed semantic values carried by retail `TransparentPartHook`. */
interface TransparentPartValues {
	/** Authored ramp duration in seconds. */
	readonly durationSeconds: number;
	/** Translucency at the end of the effect. */
	readonly end: number;
	/** Zero-based setup part-array index. */
	readonly partIndex: number;
	/** Translucency at the start of the effect. */
	readonly start: number;
}

/** Payload retained for commands that decode but have no execution owner. */
type UnimplementedCommandPayload =
	| { readonly kind: "no-payload" }
	| { readonly kind: "raw"; readonly bytes: Uint8Array };

/** Stable diagnostic label for one command, used by observation and provenance records. */
export function behaviorCommandLabel(command: PreparedBehaviorCommand): string {
	switch (command.kind) {
		case "semantic":
		case "unimplemented":
			return command.command;
		default:
			return command.kind;
	}
}

/**
 * Whether an owner carrying this command must keep its static presentation.
 *
 * `replace-object` deliberately does **not** block. Retail defines no `Execute` for hook type 5 —
 * the shipped client parses it, preloads the replacement GfxObj through `GetSubDataIDs`, and then
 * does nothing — so an owner carrying one renders identically whether we run it or not. Reporting
 * it inert is the faithful behavior, and blocking activation over it would withhold correct
 * animation for a hook that changes nothing (ratified 2026-08-06).
 */
export function behaviorCommandBlocksActivation(
	command: PreparedBehaviorCommand,
): boolean {
	return command.kind === "unimplemented" && command.blocksActivation;
}

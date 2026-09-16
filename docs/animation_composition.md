# Humanoid gesture composition

The 3D frontend combines player locomotion with an independently advancing gesture. The
world runtime remains authoritative for movement, collision, commands, and action timing.
Composition changes only the rendered pose.

## Ownership and activation

- `holtburger-world` publishes `locomotion_command_active` from the independent locomotion
  owner. A retained idle or stop clip is not active movement intent.
- `holtburger-core` projects that fact without reinterpreting it.
- The app host includes raw SetupModel parent indices in its static visual description.
- On visual installation/replacement, the frontend recognizes a supported humanoid layout
  from the complete part count and parent topology. It does not select layouts by race IDs.
- The presentation runtime chooses ordinary playback or humanoid composition. Composition
  requires a player, a compatible layout, enabled frontend tuning, and either active movement
  intent or unsupported physical contact (airborne/sliding).
- `AnimationSystem` advances both tracks and keeps existing hook ownership. It composes only
  a displayed gesture (including a locally finishing gesture) with an available locomotion track.
- The pure compositor receives complete sampled poses, the verified layout, and chest weight.
  It reads no input state, global tuning, assets, or effect state.

Unsupported topology retains ordinary presentation. Compatible topology with an incomplete
sample is a contract error. A clip authoring fewer setup parts is supported by the existing
sampler, which retains the unauthored parts before composition.

## Layout evidence

ACE `ClothingTable.GetVisualPriority` identifies the basic body parts at indices 0–16.
The local `assets.hba` CharGen/SetupModel census on 2026-09-16 found 26 heritage/gender
entries: 22 humanoid entries with 34 parts, and four Olthoi entries with 25 or 31 parts.
Tumerok changes two parents within the upper-body group but preserves the group assignments.
The layout recognizer accepts both observed humanoid topologies and rejects other layouts.

| Parts | Source/group | Authored relationship |
| --- | --- | --- |
| 0–8 | Locomotion | Abdomen/pelvis, legs, feet, toes |
| 9–16 | Gesture | Chest, arms, hands, head |
| 17–20 | Locomotion | Auxiliary chain rooted at pelvis 0 |
| 21–24 | Gesture | Auxiliary slots rooted at head 16 or chest 9 |
| 25–26 | Locomotion | Auxiliary slots parented to lower legs 2 and 6 |
| 27–33 | Gesture | Auxiliary slots/chains rooted at upper arms or chest |

These parent indices recognize anatomy; they do not turn the object-relative animation
frames into a parent-relative skeleton. Reproduce the inventory with:

```sh
cargo run -p holtburger-debug-harness --bin player_layout_census
```

This diagnostic requires local content. Automated tests use synthetic layouts and poses.

## Pose composition and effects

The pelvis correction is `locomotionPelvis × inverse(gesturePelvis)`. Apply it to the
casting chest, keep the aligned chest position, and interpolate its rotation toward the
locomotion chest using `chestLocomotionWeight`. Apply
`blendedChest × inverse(gestureChest)` to every gesture-group part. Locomotion-group parts
come directly from the locomotion sample. This preserves the gesture group's internal
arrangement while moving it with the pelvis and adjusted chest.

The final complete pose feeds rendering, attachment frames, and current presentation bounds.
If it exceeds the prepared animation sweep, the entity's broadphase bounds expand to include
it. This conservative envelope does not shrink on each animation frame; a new visual or
root-scale preparation rebuilds it.

Hook dispatch follows the semantic selected track, not per-part blend weights. Composed legs
therefore do not independently enable footstep hooks. Releasing movement immediately restores
the full gesture on the ground; airborne/sliding contact keeps the support pose in the lower
body even without directional input. There is no additional crossfade or foot-placement solver.

Recognized casting gestures keep their authored clocks through local and remote jump/fall transitions.
The independent locomotion track selects the support pose, while the gesture retains action
completion and body-hook ownership. Other actions keep existing contact interruption priority.
Both the per-tick driver and committed contact edges preserve these gestures. Packet admission
also retains eligible accepted casting commands and windup batches for remote characters, so
casts arriving midair remain gestures instead of being reclassified as falling. A fresh airborne
cast discards an obsolete takeoff transition before selecting its own entry. Existing gesture
entries and queues retain their clocks. Server-directed movement keeps its existing priority.
Landing without movement restores the full gesture. This extends gesture/locomotion coexistence to
unsupported travel; it does not authorize new spell casts. Gesture hooks and collision poses
remain gesture-owned rather than being retired at takeoff. The jump solver still owns trajectory:
unsupported character translation uses ballistic motion, while authored rotation can still affect
heading. Landing restores ordinary supported movement.
Skipped locomotion transition clips no longer contribute their authored offsets. The remote
locomotion presentation track never changes the physical source sample or dispatches body hooks.

While airborne, a locomotion stance change discards its grounded transition route and selects
the destination Falling cycle directly. The player motion table `0x09000001` routes style changes
through a Falling-to-Stand landing clip (`0x030004a6`) and magic stance clips (`0x03000598`);
playing those links in flight hid the intended lower-body pose. Same-style takeoff retains its
authored transition. Ordinary casting transitions continue independently.

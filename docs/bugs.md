# Server Bugs

This file documents bugs discovered in the ACE Server during development of Holtburger.

## NullReferenceException in DoSpellEffects

- **Date Discovered:** 2026-02-13
- **Location:** `ACE.Server.WorldObjects.WorldObject.DoSpellEffects` in [ACE/Source/ACE.Server/WorldObjects/WorldObject_Magic.cs](ACE/Source/ACE.Server/WorldObjects/WorldObject_Magic.cs)
- **Description:** 
  The server crashes when an untargeted spell is cast that triggers a target effect (visual script). This happens because `HandleCastSpell` passes the original `target` (which is `null` for untargeted packets) to `DoSpellEffects`, which then attempts to access `target.Wielder`.
- **Symptoms:** 
  ```
  Unhandled exception. System.NullReferenceException: Object reference not set to an instance of an object.
     at ACE.Server.WorldObjects.WorldObject.DoSpellEffects(Spell spell, WorldObject caster, WorldObject target, Boolean projectileHit)
  ```
- **Workaround:** 
  Ensure the client sends a `CastTargetedSpell` packet with the player's own GUID for self-targeted spells rather than relying on the untargeted cast packet.
- **Fix (Proposed):** 
  In `HandleCastSpell`, if `target` is null but `targetCreature` is not, use `targetCreature` for the `DoSpellEffects` call.

### Fix PR
[https://github.com/ACEmulator/ACE/pull/4411/changes](https://github.com/ACEmulator/ACE/pull/4411/changes)

## Misc
- You can cast *Other, vuln, and war spells on yourself (but war spells do no damage).
- You don't have to face the target of your spells.
- You can cast Infuse Mana Other on yourself. Breaks even at Level 3.
- You can cast Drain Health on yourself. The DMG:HEAL ratio starts at 0.25:2 and goes up to 0.6:0.35  so lvl 1 is the most efficient?


## Cast with weapons.
- So long as a you send a `SetCombatMode = Magic` action right before casting, you can cast a spell (no wand modifiers obv).
- Also can do a melee attack with a wand a similar fashion (punch).

# Investigate

## Door Noclip
- MITM override door entities as open/nocollide.

## Equip outside inventory
- ...

## Out of bounds
- Looks like you disappear off the map/radar when you go out of bounds (in a wall)? Untargetable?

## Spells are only 2D checks.
- Z distance doesn't matter.

## Vendor distance
- Vendoring is stateless and you can buy/sell so long as you are in an adjacent landblock to the vendor.
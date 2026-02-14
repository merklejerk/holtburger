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


## Notes
- You can cast *Other, vuln, and war spells on yourself (but war spells do no damage).

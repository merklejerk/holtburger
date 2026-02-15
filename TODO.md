### Low
- [x] Left align `account:name` in status panel.
- [x] Add heading (e.g., `120° E-SE`) to status panel.
- [x] Network traffic visualizer in dynamic panel when otherwise empty.
- [x] Compass radar in dynamic panel.
- [x] Dereth chronometer in dynamic panel.
- [ ] Chat tabs (Chat vs combat vs all).
- [x] Just interleave bars in netpulse widget.
- [x] Move vitae penalty to under "vitals" group. (Done)
- [x] Reverse direction of netpulse animation.
- [ ] [Entity](crates/holtburger-core/src/world/entity.rs) struct should consolidate `armor_profile`, `creature_profile`, `weapon_profile` under a single enum. Profiles are exclusive of each other.
- [ ] Jump doesn't work.
- [ ] Add and resolve `SpellCategory` enum.
- [x] When navigating the spells list in dashboard a random non-selected spell will be rendered with a blue/cyan font color for some reason. Selection style also doesn't match other tabs. (Done)
- [ ] Shift+backspace to clear chat input buffer.

### Medium
- [x] Noclip mode to disable collision during movement.
- [x] Make net stats widget fixed width. Currently Seems to scale with terminal width.
- [x] Tab cycle order is wrong in landscape mode.
- [x] Char tab "resistances" section needs to be prettified. Armor buffs not correctly compounding.
- [x] Validate enchantment combining logic and order: floats are multiplicative and ints are additive?
- [x] [U]se and [H]eal action for healing kits.
- [x] Spell IDs need to be converted to names in enchants lists. (Plan: [docs/plans/spell_name_resolution_plan.md](docs/plans/spell_name_resolution_plan.md))
- [x] Force Verb shortcuts to be unique at compile time.
- [x] Chronometer tells the wrong time.
- [ ] DC detection.
- [ ] Approach verb is janky.
- [ ] Augment entities spawned by `ObjectCreate` with weenie template properties.  
- [x] Login character list is not alphabetically sorted so `-c NUM` arg is unreliable. (Done)
- [ ] All verbs should have synonymous slash chat commands.
- [ ] Missing many unit tests for protocol types (lost in the refactor?).
- [ ] [C]ombine verb (crafting).
- [x] [T]arget verb (combat).
- [ ] [U]se for Mana charges.
- [x] Enter key for interaction target confirmation.
- [ ] Manage in-world containers.
- [ ] Search/filter on list tabs.
- [ ] PlayerState and entities mirroring in `WorldState` is annoying.
- [ ] TUI gets really slow when chat buffer gets full.
- [ ] TUI client needs major refactors.
- [x] Combat mode toggle.
- [ ] Implement actual collisions.
- [ ] Use sibling files for tests.

### High
- [x] Fail when spell/attack distance is too far.
- [x] Just learned spells show up as "unknown spell" in spellbok. Requires restart.
- [x] Items "wielded" by the player not showing up in their inventory.
- [x] Refactor client movement system (move to, nav).
- [x] Distance calculation is wrong when in different landblocks.
- [x] Add "active entity" system:
    - [x] In entity lists, add [H]eal, [G]ive, [T]arget, [M]ove verbs.
    - [x] Add a contextual "active entity" panel below dashboard and context panel.
        - [x] Title and content changes depending on entity and verb.
            - [x] E.g., creatures display health (and enchantments, attack controls?).
    - [x] ESC key clears active entity.
- [x] Add "Spells" tab.
    - [x] Add [C]ast verb on current active entity (if chosen) or self.
- [ ] Combat.
- [ ] Equipment management.
    - [ ] Populate all entities with weenie data.
    - [ ] Use armor weenie equipment slots to determine equip mask.
    - [ ] Make equipped items more obvious.
- [ ] Vitae debuff requires restart to show up? Or if you have one then you die, it seems to get hidden?

### Critical

### Stretch
- [ ] Integrate `deno-core` for scripting.

### Investigate
- [ ] Max vitals caculation is wrong (63/127/132 vs 60/125/121)... sometimes?


### Low
- [x] Left align `account:name` in status panel.
- [x] Add heading (e.g., `120° E-SE`) to status panel.
- [ ] Add jump for fun.
- [x] Network traffic visualizer in dynamic panel when otherwise empty.
- [x] Compass radar in dynamic panel.
- [x] Dereth chronometer in dynamic panel.
- [ ] Chat tabs (Chat vs combat vs all).
- [x] Just interleave bars in netpulse widget.
- [x] Move vitae penalty to under "vitals" group. (Done)
- [x] Reverse direction of netpulse animation.
- [ ] [Entity](crates/holtburger-core/src/world/entity.rs) struct should consolidate `armor_profile`, `creature_profile`, `weapon_profile` under a single enum. Profiles are exclusive of each other.

### Medium
- [ ] Chronometer tells the wrong time.
- [ ] Noclip mode to disable collision during movement.
- [x] Make net stats widget fixed width. Currently Seems to scale with terminal width.
- [x] Tab cycle order is wrong in landscape mode.
- [ ] DC detection.
- [ ] Approach verb is janky.
- [ ] Augment entities spawned by `ObjectCreate` with weenie template properties.  
- [ ] Login character list is not alphabetically sorted so `-c NUM` arg is unreliable.
- [x] Char tab "resistances" section needs to be prettified. Armor buffs not correctly compounding.
- [x] Validate enchantment combining logic and order: floats are multiplicative and ints are additive?
- [x] [U]se and [H]eal action for healing kits.
- [ ] All verbs should have synonymous slash chat commands.
- [x] Spell IDs need to be converted to names in enchants lists. (Plan: [docs/plans/spell_name_resolution_plan.md](docs/plans/spell_name_resolution_plan.md))
- [x] Force Verb shortcuts to be unique at compile time.
- [ ] [E]quip verb.
- [ ] Missing many unit tests for protocol types (lost in the refactor?).
- [ ] [C]ombine verb (crafting).
- [ ] [T]arget verb (combat).
- [ ] [U]se for Mana charges.
- [x] Enter key for interaction target confirmation.
- [ ] In-world containers.
- [ ] Search/filter on list tabs.

### High
- [ ] Items "wielded" by the player not showing up in their inventory.
- [x] Refactor client movement system (move to, nav).
- [x] Distance calculation is wrong when in different landblocks.
- [x] Add "active entity" system:
    - [x] In entity lists, add [H]eal, [G]ive, [T]arget, [M]ove verbs.
    - [x] Add a contextual "active entity" panel below dashboard and context panel.
        - [x] Title and content changes depending on entity and verb.
            - [x] E.g., creatures display health (and enchantments, attack controls?).
    - [x] ESC key clears active entity.
- [ ] Add "Spells" tab.
    - [ ] Add [C]ast verb on current active entity (if chosen) or self.

### Critical

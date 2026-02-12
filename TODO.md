### Low
[ ] Left align `account:name` in status panel.
[ ] Add heading (e.g., `120° E-SE`) to status panel.
[ ] Add jump for fun.
[ ] Network traffic visualizer in dynamic panel when otherwise empty.

### Medium
[x] Tab cycle order is wrong in landscape mode.
[ ] DC detection.
[ ] Approach verb is janky.
[ ] Augment entities spawned by `ObjectCreate` with weenie template properties.  
[ ] Login character list is not alphabetically sorted so `-c NUM` arg is unreliable.
[ ] Char tab "resistances" section needs to be prettified. Armor buffs not correctly compounding.
[ ] Validate enchantment combining logic and order: floats are multiplicative and ints are additive?
[x] [U]se and [H]eal action for healing kits.
[ ] All verbs should have synonymous slash chat commands.
[ ] Spell IDs need to be converted to names in enchants lists.
[x] Force Verb shortcuts to be unique at compile time.
[ ] Equip verb.
[ ] Missing many unit tests for protocol types (lost in the refactor?).
[ ] [C]ombine verb (crafting).
[ ] [U]se for Mana charges.
[ ] For two-step interactions that can target self, press the shortcut key again to quick apply to self?

### High
[ ] Distance calculation is wrong when in different landblocks.
[~] Add "active entity" system:
    [~] In entity lists, add [H]eal, [G]ive, [T]arget, [M]ove verbs.
    [x] Add a contextual "active entity" panel below dashboard and context panel.
        [x] Title and content changes depending on entity and verb.
            [x] E.g., creatures display health (and enchantments, attack controls?).
    [x] ESC key clears active entity.
[ ] Add "Spells" tab.
    [ ] Allow search/filter.
    [ ] Add [C]ast verb on current active entity (if chosen) or self.

### Critical
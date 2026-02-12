### Low
- Approach verb is janky.

### Medium
- Augment entities spawned by `ObjectCreate` with weenie template properties.  
- Distance calculation is wrong when in different landblocks.
- Login character list is not alphabetically sorted so `-c NUM` arg is unreliable.
- Char tab "resistances" section needs to be prettified. Armor buffs not correctly compounding.
- Validate enchantment combining logic and order: floats are multiplicative and ints are additive?
- [U]se and [C]ombine action for healing kits.
- All verbs should have synonymous slash chat commands.
- Spell IDs need to be converted to names in enchants lists.

### High
- Add "active entity" system:
    - In entity lists, add [T]arget, [C]ombine, [M]ove verbs.
    - Add a contextual "active entity" panel below dashboard and context panel.
        - Title and content changes depending on entity and verb.
            - E.g., creatures display health (and enchantments, attack controls?).
        - When no active entity, instead of blank display some silly easter eggs?
    - ESC key clears active entity.
- Add "Spells" tab.
    - Allow search/filter.
    - Add [C]ast verb on current active entity (if chosen) or self.

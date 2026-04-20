## Main Flow

Same follow and target selection logic as in `fighter.js` but using spells for attack (and optionally healing). It should never melee/missle attack or approach monsters deliberately.

- When it detects an attack target:
    - Add it to the attack candidate set.
- When an attack target has been chosen (use the same rules as in `fighter.js`):
    - If the player has war magic trained:
        - Rank war attack spells from the resist table loaded from `mage.data.bin` using the target's `weenieId`.
        - If we can find an appropriate war magic attack spell:
            - If the user has life magic trained and the chosen war spell has a damage type:
                - If we can find the appropriate Life magic vulnerability spell that matches the attack spell's damage type:
                    - Cast it on the target.
            - Cast the war magic attack spell on the target.
    - If the player does not have war magic but has void magic trained:
        - If we can find an appropriate void magic attack spell:
            - Cast it on the target.
- When it detects an injured party member:
    - If the player has healing trained:
        - If we have a healing kit in our inventory:
            - Use the healing kit on the party member.
    - If the player does not have healing trained but the player has Life magic trained:
        - If we can find an appropriate heal spell:
            - Cast it on the party member.
- If at any point the player's mana falls below 40%:
    - If the player has life magic trained:
        - If we can find the appropriate life magic stamina-to-mana spell:
            - Cast it on ourselves.
        - If we can find the appropriate life magic revitalize self spell:
            - Cast it on ourselves.
- If at any point the player's health falls below 60%:
    - If the player has healing trained:
            - If we have a healing kit in our inventory:
                - Use the healing kit on ourselves.
    - If the player does not have healing trained but the player has Life magic trained:
        - If we can find the appropriate life magic stamina-to-health spell:
            - Cast it on ourselves.
        - If we can find the appropriate life magic revitalize self spell:
            - Cast it on ourselves.

## Spell Selection Rules
- Only look at spells that are in our spellbook.
- If the spell has a range and we have a target (not ourselves), disqualify it if the target is currently outside of that range.
- When multiple appropriate spells are found, always pick the highest power spell for which our skill level is at least 10 points above the minimum requirement for that spell.
- When looking for a war attack spell:
    - Rank war spells with the the target's damage type vulnerabilty first and filter from there.
- When looking for a life vuln spell:
    - It MUST match the damage type of the attack spell.

## Identifying Monsters
- Monster identity should come from the entity's `weenieId`.
- The host exposes `weenieId` directly on `ScriptEntityView`.
- Mage should not use `assess()` or creature-type discovery.

## Data tables
We will ship a static script data JSON file `mage.data.json` plus a binary resist table `mage.data.bin`. The script loads them with `HB.loadData()` and `HB.loadDataBin()`.

- Map of all usable spells indexed by debug string id (e.g., `stamina-to-mana-self`) containing:
    - Their spell id (`number`)
    - Their school (`war`, `life`, `void`)
    - Their type (`heal`, `revitalize`, `attack`, `vuln`, `stamina-to-mana`, `stamina-to-health`)
    - Their difficulty (min school skill level)
    - Their damage type (`acid`, `cold`, `lightning`, `fire`, `bludgeon`, `pierce`, `slash`, `void`)
    - Their attack range, in meters, or null.
- Map of all skills indexed by debug string id (e.g., `life`, `healing`, `war`, `void`) to their skill id.

## Bootstrapping
We can bootstrap the JSON spell table by looking at the spell and skill data tables that we normally extract as part of our micro HBA profile. `dats/assets.hba` already has those tables inside of it and the `holtburger-dat` and `holtburger-tools` crates can provide reference and tooling for parsing them. The resist binary comes from `weenie-resists`, which already exports a sorted compact `.bin` format keyed by weenie id.
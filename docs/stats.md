# Character Stats (Attributes, Vitals, and Skills)

Character statistics in Asheron's Call are identified by unique `uint32` IDs in network messages and property tables.

## 1. Primary Attributes
Attributes are the foundational stats of a character. In `0x0013 PlayerDescription` and `0x02E3 PrivateUpdateAttribute`, they are identified by IDs 1 through 6.

| ID  | Name         |
| --- | ------------ |
| 1   | Strength     |
| 2   | Endurance    |
| 3   | Quickness    |
| 4   | Coordination |
| 5   | Focus        |
| 6   | Self         |

---

## 2. Vitals
Vitals are secondary attributes that have "current" and "maximum" values. In `0x02E7 PrivateUpdateVital`, they use IDs 1-3. However, in the composite `PlayerDescription` attribute vector, they are often mapped to IDs 7-9.

| ID (Standard) | ID (Mapped) | Name    |
| ------------- | ----------- | ------- |
| 1             | 7           | Health  |
| 2             | 8           | Stamina |
| 3             | 9           | Mana    |

---

## 3. Skills
Skills are refined abilities identified by IDs 1 through 54. Note that many IDs are considered **Retired** or **Unimplemented** in the End of Retail (EOR) version of the game.

| ID  | Name                    | Status        | ID  | Name                    | Status        |
| --- | ----------------------- | ------------- | --- | ----------------------- | ------------- |
| 1   | Axe                     | Retired       | 28  | Weapon Tinkering        | Active        |
| 2   | Bow                     | Retired       | 29  | Armor Tinkering         | Active        |
| 3   | Crossbow                | Retired       | 30  | Magic Item Tinkering    | Active        |
| 4   | Dagger                  | Retired       | 31  | Creature Enchantment    | Active        |
| 5   | Mace                    | Retired       | 32  | Item Enchantment        | Active        |
| 6   | Melee Defense           | Active        | 33  | Life Magic              | Active        |
| 7   | Missile Defense         | Active        | 34  | War Magic               | Active        |
| 8   | Sling                   | Retired       | 35  | Leadership              | Active        |
| 9   | Spear                   | Retired       | 36  | Loyalty                 | Active        |
| 10  | Staff                   | Retired       | 37  | Fletching               | Active        |
| 11  | Sword                   | Retired       | 38  | Alchemy                 | Active        |
| 12  | Thrown Weapon           | Retired       | 39  | Cooking                 | Active        |
| 13  | Unarmed Combat          | Retired       | 40  | Salvaging               | Active        |
| 14  | Arcane Lore             | Active        | 41  | Two Handed Combat       | Active        |
| 15  | Magic Defense           | Active        | 42  | Gearcraft               | Retired       |
| 16  | Mana Conversion         | Active        | 43  | Void Magic              | Active        |
| 17  | Spellcraft              | Unimplemented | 44  | Heavy Weapons           | Active        |
| 18  | Item Tinkering          | Active        | 45  | Light Weapons           | Active        |
| 19  | Assess Person           | Active        | 46  | Finesse Weapons         | Active        |
| 20  | Deception               | Active        | 47  | Missile Weapons         | Active        |
| 21  | Healing                 | Active        | 48  | Shield                  | Active        |
| 22  | Jump                    | Active        | 49  | Dual Wield              | Active        |
| 23  | Lockpick                | Active        | 50  | Recklessness            | Active        |
| 24  | Run                     | Active        | 51  | Sneak Attack            | Active        |
| 25  | Awareness               | Unimplemented | 52  | Dirty Fighting          | Active        |
| 26  | Arms & Armor Repair     | Unimplemented | 53  | Challenge               | Unimplemented |
| 27  | Assess Creature         | Active        | 54  | Summoning               | Active        |

### Training Levels
The `Status` field in skill updates defines the character's training state:
- `0`: Unusable
- `1`: Untrained
- `2`: Trained
- `3`: Specialized

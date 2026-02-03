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
Vitals are secondary attributes that have "current" and "maximum" values. 

### Internal Mapping (PlayerDescription)
In the initial `0x0013 PlayerDescription` message, vitals are sent in a specific order and are often mapped internally (e.g., adding +100 to the index) to distinguish them from primary attributes during processing.

| Index | Name    | Internal ID | World ID | Base Attribute | Formula |
| ----- | ------- | ----------- | -------- | -------------- | ------- |
| 0     | Health  | 101         | 2        | Endurance      | `Endurance / 2` |
| 1     | Stamina | 102         | 4        | Endurance      | `Endurance` |
| 2     | Mana    | 103         | 6        | Self           | `Self` |

### Real-time Updates
In `0x02E7 PrivateUpdateVital` and `0x02E9 PrivateUpdateVitalCurrent`, vitals are identified by their **World ID** (2, 4, 6).

| ID  | Name    | Description |
| --- | ------- | ----------- |
| 2   | Health  | Current and maximum health. |
| 4   | Stamina | Current and maximum stamina. |
| 6   | Mana    | Current and maximum mana. |

*Note: IDs 1, 3, and 5 correspond to `MaxHealth`, `MaxStamina`, and `MaxMana` base values, but the "Current" updates use the even-numbered IDs.*

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

## Stat Update Mechanics

### The "Stingy Server" Behavior
The server (notably ACE/Retail) is efficient with bandwidth. When a character receives an enchantment (buff/debuff), the server sends a `MagicUpdateEnchantment` or `MagicUpdateMultipleEnchantments` message, but it **does not** send updated `PrivateUpdateAttribute` or `PrivateUpdateSkill` messages for the affected stats. 

The client is responsible for tracking all active enchantments and recalculating the "Buffed" values locally.

### Vital Update Exceptions
Vitals (Health, Stamina, Mana) have a unique behavior:
- After applying a spell that affects a Max Vital (e.g. "Major Health VI"), ACE sends a `PrivateUpdateAttribute2ndLevel` (Max Vital) update, but it is **delayed by 1.0 seconds**.
- This delay ensures the client has received and processed the enchantment before the "computed" total arrives.
- If the client does not implement local recalculation, the UI will lag by 1s before showing the new Max Vital.

## Effective Stat Calculation

The client performs local recalculation of effective stats to ensure the UI remains responsive and accurate even between server updates. 

### Stacking Rules
- **Spell Categories**: Enchantments in the same `SpellCategory` do not stack. 
- **Priority (The Winner)**: In modern AC protocol (ACE/Retail), the "winning" enchantment in a category is determined by:
  1. **PowerLevel**: Highest power wins.
  2. **StartTime**: If PowerLevels are equal, the most recently cast spell wins.
- **The LayerId Trap**: While the protocol includes a `LayerId` field, it often acts as a sequence number for spells in a category (preserving the "stack"). Do **not** assume `LayerId == 1` is always the active spell.
- **Multipliers vs Additives**:
  - All Multiplicative mods are multiplied together.
  - All Additive mods are summed.
  - `Final = (Base * ProductOfMultipliers) + SumOfAdditives`

### Formulas

- **Primary Attributes**:
  - `EffectiveAttr = (BaseAttr * ProductOfMultipliers) + SumOfAdditives`

- **Derived Vitals (Max)**:
  - `EffectiveMaxVital = (BaseMaxVital + VitalBonusFromAttributes) * Multipliers + Additives`
  - `VitalBonusFromAttributes` uses the *Buffed* values of the contributing attributes.

- **Derived Skills**:
  - `EffectiveSkill = (InvestedRanks + InitBonus + (BuffedAttr1 + BuffedAttr2) / Divisor) * Multipliers + Additives`
- Missile Defense: `(Quickness + Coordination) / 5`
- Magic Defense: `(Focus + Self) / 7`
- Arcane Lore/Mana Conversion: `(Focus + Self) / 6 or 3`
- Weapons: `(Strength + Coordination) / 3` or `(Quickness + Coordination) / 3`

### Stacking Rules

- Only the highest power level enchantment from each `spell_category` is applied to a specific stat mod key.
- Multipliers are applied first, then additives.
- Negative values are generally clamped to 0.

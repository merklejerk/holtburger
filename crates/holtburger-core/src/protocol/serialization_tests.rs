#[cfg(test)]
mod tests {
    use crate::protocol::messages::{CreatureSkill, Enchantment};

    fn hex_decode(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    fn hex_encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02X}", b)).collect()
    }

    #[test]
    fn test_creature_skill_serialization() {
        // From ACE SyntheticProtocolTests.DumpCreatureSkill
        // Melee Defense (6), Ranks (10), Status (1), SAC (3), XP (500000), Init (10), Resist (0), LastUsed (0.0)
        let hex = "060000000A0001000300000020A107000A000000000000000000000000000000";

        let skill = CreatureSkill {
            sk_type: 6,
            ranks: 10,
            status: 1,
            sac: 3,
            xp: 500000,
            init: 10,
            resistance: 0,
            last_used: 0.0,
        };

        let mut packed = Vec::new();
        skill.write(&mut packed);
        assert_eq!(hex_encode(&packed), hex);
    }

    #[test]
    fn test_enchantment_serialization() {
        // From ACE SyntheticProtocolTests.DumpEnchantment
        let hex = "7B000100050001000A000000ADFA5C6D454A9340000000000020AC40785634120000803F00000000000000000000000001000000EFCDAB0000002841E7030000";

        let enchantment = Enchantment {
            spell_id: 123,
            layer: 1,
            spell_category: 5,
            has_spell_set_id: 1,
            power_level: 10,
            start_time: 1234.5678,
            duration: 3600.0,
            caster_guid: 0x12345678,
            degrade_modifier: 1.0,
            degrade_limit: 0.0,
            last_time_degraded: 0.0,
            stat_mod_type: 1,
            stat_mod_key: 0xABCDEF,
            stat_mod_value: 10.5,
            spell_set_id: Some(999),
        };

        let mut packed = Vec::new();
        enchantment.write(&mut packed);
        assert_eq!(hex_encode(&packed), hex);
    }
}

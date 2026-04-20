use holtburger_dat::file_type::{SpellTable, spell_table::SpellBase};
use serde::Serialize;
use serde_json::{Map, Number, Value};
use std::collections::BTreeMap;

#[derive(clap::ValueEnum, Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SpellExportSchool {
    War,
    Life,
    Item,
    Creature,
    Void,
}

#[derive(clap::ValueEnum, Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SpellExportField {
    Name,
    Description,
    School,
    Category,
    Bitfield,
    BaseMana,
    BaseRangeConstant,
    BaseRangeMod,
    Power,
    RawComponents,
    ManaMod,
    FormulaVersion,
}

#[derive(clap::ValueEnum, Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SpellExportPreset {
    Base,
    Minimal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpellExportRequest {
    pub fields: Vec<SpellExportField>,
    pub preset: SpellExportPreset,
    pub schools: Vec<SpellExportSchool>,
    pub categories: Vec<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellExportFile {
    pub file_id: u32,
    pub fields: Vec<SpellExportField>,
    pub spells: BTreeMap<u32, Map<String, Value>>,
}

impl SpellExportRequest {
    pub fn resolved_fields(&self) -> Vec<SpellExportField> {
        let source = if self.fields.is_empty() {
            self.preset.fields()
        } else {
            &self.fields
        };

        let mut fields = Vec::with_capacity(source.len());
        for field in source {
            if !fields.contains(field) {
                fields.push(*field);
            }
        }

        fields
    }
}

impl SpellExportPreset {
    pub fn fields(self) -> &'static [SpellExportField] {
        match self {
            Self::Base => &[
                SpellExportField::Name,
                SpellExportField::Description,
                SpellExportField::School,
                SpellExportField::Category,
                SpellExportField::Bitfield,
                SpellExportField::BaseMana,
                SpellExportField::BaseRangeConstant,
                SpellExportField::BaseRangeMod,
                SpellExportField::Power,
                SpellExportField::RawComponents,
                SpellExportField::ManaMod,
                SpellExportField::FormulaVersion,
            ],
            Self::Minimal => &[
                SpellExportField::Name,
                SpellExportField::Description,
                SpellExportField::School,
                SpellExportField::Category,
                SpellExportField::Bitfield,
                SpellExportField::BaseRangeConstant,
                SpellExportField::BaseRangeMod,
                SpellExportField::Power,
            ],
        }
    }
}

pub fn export_spell_table(table: &SpellTable, request: &SpellExportRequest) -> SpellExportFile {
    let fields = request.resolved_fields();
    let mut spells = BTreeMap::new();

    for (spell_id, spell) in &table.spells {
        if !request.matches_spell(spell) {
            continue;
        }

        let mut record = Map::new();

        for field in &fields {
            record.insert(field.json_key().to_string(), field.value(spell));
        }

        spells.insert(*spell_id, record);
    }

    SpellExportFile {
        file_id: table.id,
        fields,
        spells,
    }
}

impl SpellExportField {
    fn json_key(self) -> &'static str {
        match self {
            Self::Name => "name",
            Self::Description => "description",
            Self::School => "school",
            Self::Category => "category",
            Self::Bitfield => "bitfield",
            Self::BaseMana => "base_mana",
            Self::BaseRangeConstant => "base_range_constant",
            Self::BaseRangeMod => "base_range_mod",
            Self::Power => "power",
            Self::RawComponents => "raw_components",
            Self::ManaMod => "mana_mod",
            Self::FormulaVersion => "formula_version",
        }
    }

    fn value(self, spell: &SpellBase) -> Value {
        match self {
            Self::Name => Value::from(spell.name.clone()),
            Self::Description => Value::from(spell.description.clone()),
            Self::School => Value::from(spell.school),
            Self::Category => Value::from(spell.category),
            Self::Bitfield => Value::from(spell.bitfield),
            Self::BaseMana => Value::from(spell.base_mana),
            Self::BaseRangeConstant => number(spell.base_range_constant as f64),
            Self::BaseRangeMod => number(spell.base_range_mod as f64),
            Self::Power => Value::from(spell.power),
            Self::RawComponents => Value::Array(
                spell
                    .raw_components
                    .iter()
                    .copied()
                    .map(Value::from)
                    .collect(),
            ),
            Self::ManaMod => Value::from(spell.mana_mod),
            Self::FormulaVersion => Value::from(spell.formula_version),
        }
    }
}

impl SpellExportRequest {
    fn matches_spell(&self, spell: &SpellBase) -> bool {
        if !self.schools.is_empty()
            && !self
                .schools
                .iter()
                .any(|school| school.matches(spell.school))
        {
            return false;
        }

        if !self.categories.is_empty() && !self.categories.contains(&spell.category) {
            return false;
        }

        true
    }
}

impl SpellExportSchool {
    fn matches(self, school: u32) -> bool {
        match self {
            Self::War => school == 1,
            Self::Life => school == 2,
            Self::Item => school == 3,
            Self::Creature => school == 4,
            Self::Void => school == 5,
        }
    }
}

fn number(value: f64) -> Value {
    Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_preset_resolves_to_full_field_set() {
        let request = SpellExportRequest {
            fields: Vec::new(),
            preset: SpellExportPreset::Base,
            schools: Vec::new(),
            categories: Vec::new(),
        };

        assert_eq!(
            request.resolved_fields(),
            vec![
                SpellExportField::Name,
                SpellExportField::Description,
                SpellExportField::School,
                SpellExportField::Category,
                SpellExportField::Bitfield,
                SpellExportField::BaseMana,
                SpellExportField::BaseRangeConstant,
                SpellExportField::BaseRangeMod,
                SpellExportField::Power,
                SpellExportField::RawComponents,
                SpellExportField::ManaMod,
                SpellExportField::FormulaVersion,
            ]
        );
    }

    #[test]
    fn minimal_preset_resolves_to_short_field_set() {
        let request = SpellExportRequest {
            fields: Vec::new(),
            preset: SpellExportPreset::Minimal,
            schools: Vec::new(),
            categories: Vec::new(),
        };

        assert_eq!(
            request.resolved_fields(),
            vec![
                SpellExportField::Name,
                SpellExportField::Description,
                SpellExportField::School,
                SpellExportField::Category,
                SpellExportField::Bitfield,
                SpellExportField::BaseRangeConstant,
                SpellExportField::BaseRangeMod,
                SpellExportField::Power,
            ]
        );
    }

    #[test]
    fn filters_spells_by_school_and_category() {
        let mut table = SpellTable {
            id: SpellTable::FILE_ID,
            spells: std::collections::HashMap::new(),
            spell_sets: std::collections::HashMap::new(),
        };

        let fireball = SpellBase {
            school: 1,
            category: 207,
            ..SpellBase::default()
        };
        let heal = SpellBase {
            school: 2,
            category: 47,
            ..SpellBase::default()
        };
        table.spells.insert(1, fireball);
        table.spells.insert(2, heal);

        let request = SpellExportRequest {
            fields: vec![SpellExportField::Name],
            preset: SpellExportPreset::Base,
            schools: vec![SpellExportSchool::War],
            categories: vec![207],
        };

        let export = export_spell_table(&table, &request);

        assert_eq!(export.spells.len(), 1);
        assert!(export.spells.contains_key(&1));
        assert!(!export.spells.contains_key(&2));
    }
}

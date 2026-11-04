use super::GameData;
use holtburger_common::Guid;
use holtburger_common::properties::{PropertyInt, WorldObjectPropertyAccessors};
use holtburger_world::crafting::salvage::{
    SalvageCandidate, SalvagePreview, SalvageSkillProfile, find_salvage_tool,
    predict_salvage_preview,
};

impl GameData {
    pub fn find_salvage_tool_guid(&self) -> Option<Guid> {
        find_salvage_tool(self, None).map(|tool| tool.guid)
    }

    pub fn is_salvage_candidate(&self, guid: Guid) -> bool {
        self.entity_facts
            .get(&guid)
            .is_some_and(|facts| facts.salvage.material().is_some())
    }

    /// Read world-produced candidates without filtering missing sources out of a batch.
    pub fn salvage_preview(&self, item_guids: &[Guid]) -> Result<SalvagePreview, String> {
        let mut inputs = Vec::with_capacity(item_guids.len());
        for guid in item_guids {
            match self.entity_facts.get(guid).map(|facts| &facts.salvage) {
                Some(SalvageCandidate::Ready { source }) => inputs.push(source.input.clone()),
                Some(SalvageCandidate::Ineligible { reason }) => return Err(reason.clone()),
                Some(SalvageCandidate::PendingDetails { .. }) => {
                    return Err("Examine the queued items to load salvage details.".into());
                }
                None => return Err("Queued item details are unavailable.".into()),
            }
        }
        let augmentation = self
            .player_guid
            .and_then(|guid| self.entities.get(&guid))
            .and_then(|entity| entity.get_int_prop(PropertyInt::AugmentationBonusSalvage))
            .unwrap_or(0)
            .max(0) as u32;
        Ok(predict_salvage_preview(
            &inputs,
            SalvageSkillProfile::from_skills(self.skills.values(), augmentation),
        ))
    }
}

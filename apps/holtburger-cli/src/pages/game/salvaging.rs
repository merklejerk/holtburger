use super::GameData;
use holtburger_common::Guid;
use holtburger_world::crafting::salvage::find_salvage_tool;

impl GameData {
    pub fn find_salvage_tool_guid(&self) -> Option<Guid> {
        find_salvage_tool(self, None).map(|tool| tool.guid)
    }

    pub fn is_salvage_candidate(&self, guid: Guid) -> bool {
        self.entity_facts
            .get(&guid)
            .is_some_and(|facts| facts.salvage.material().is_some())
    }
}

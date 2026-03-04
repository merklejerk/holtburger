import sys

def process(content):
    content = content.replace("use ratatui::text::Line;", "use crate::pages::game::GameData;\nuse crate::pages::game::ViewState;\nuse ratatui::text::Line;")
    content = content.replace("pub fn get_debug_info(\n    target: &CommandTarget,", "pub fn get_debug_info(\n    data: &GameData,\n    view: Option<&ViewState>,\n    target: &CommandTarget,")
    
    # replace Entity(e, _) matching
    old_entity = "CommandTarget::Entity(e, _) => {"
    new_entity = "CommandTarget::Entity(guid, _) => {\n            let Some(e) = data.entities.get(guid) else { return lines; };"
    content = content.replace(old_entity, new_entity)
    
    # replace VendorItem matching
    old_vendor = "CommandTarget::VendorItem(v) => {"
    new_vendor = """CommandTarget::VendorItem(guid) => {
            let Some(v) = view.and_then(|v| v.vendor.as_ref()).and_then(|vendor| vendor.items.iter().find(|i| i.guid == *guid)) else { return lines; };"""
    content = content.replace(old_vendor, new_vendor)
    
    return content

with open("apps/holtburger-cli/src/pages/game/panels/dashboard/debug.rs", "r") as f:
    text = f.read()

with open("apps/holtburger-cli/src/pages/game/panels/dashboard/debug.rs", "w") as f:
    f.write(process(text))


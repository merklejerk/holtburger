import sys

with open("apps/holtburger-cli/src/types.rs", "r") as f:
    text = f.read()

text = text.replace("""pub enum CommandTarget<'a> {
    Entity(&'a Entity, Option<TargetSlot>),
    VendorItem(&'a holtburger_world::vendor::CoreVendorItem),""", """pub enum CommandTarget {
    Entity(Guid, Option<TargetSlot>),
    VendorItem(Guid),""")

text = text.replace("let target = CommandTarget::Entity(e, None);", "let target = CommandTarget::Entity(guid, None);")

text = text.replace("debug::get_debug_info(\n                        &target,", "debug::get_debug_info(\n                        data,\n                        Some(view),\n                        &target,")

text = text.replace("debug::get_debug_info(&target, |_| None, Some(&data.spell_info), None)", "debug::get_debug_info(data, Some(view), &target, |_| None, Some(&data.spell_info), None)")

with open("apps/holtburger-cli/src/types.rs", "w") as f:
    f.write(text)


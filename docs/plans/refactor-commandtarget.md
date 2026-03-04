1. Modify `apps/holtburger-cli/src/types.rs` to change `CommandTarget<'a>` to `CommandTarget` and replace `&'a Entity` and `&'a CoreVendorItem` with `Guid`.
2. Fix all lifetime references `CommandTarget<'a>` -> `CommandTarget` in all `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/*/tab.rs` files.
3. Update `apps/holtburger-cli/src/pages/game/panels/dashboard/debug.rs` functions (`get_debug_info`) to pass in the context needed to retrieve entities and vendor items by GUI.
4. Pass `&GameData` to necessary places in UI layer.

pub const BUILD_VERSION: &str = env!("HOLTBURGER_BUILD_VERSION");

pub fn display_version() -> String {
    format!("HoltBurger {}", BUILD_VERSION)
}

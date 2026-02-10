use std::path::PathBuf;

pub fn get_portal_dat_path() -> Option<PathBuf> {
    // Priority 1: Environment Variable (Recommended for Dev/CI)
    if let Ok(path_str) = std::env::var("HOLTBURGER_PORTAL_DAT") {
        let path = PathBuf::from(path_str);
        if path.exists() {
            return Some(path);
        }
    }

    // Priority 2: Workspace-relative fallback (e.g. dats/portal.dat from repo root)
    let fallback = PathBuf::from("dats/portal.dat");
    if fallback.exists() {
        return Some(fallback);
    }

    None
}

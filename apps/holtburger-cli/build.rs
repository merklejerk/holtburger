use std::process::Command;

fn main() {
    let version = std::env::var("HOLTBURGER_BUILD_VERSION")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| short_hash_from_env("GITHUB_SHA"))
        .or_else(|| short_hash_from_env("CI_COMMIT_SHA"))
        .or_else(short_hash_from_git)
        .unwrap_or_else(|| "unknown".to_string());

    println!("cargo:rustc-env=HOLTBURGER_BUILD_VERSION={version}");
    println!("cargo:rerun-if-env-changed=HOLTBURGER_BUILD_VERSION");
    println!("cargo:rerun-if-env-changed=GITHUB_SHA");
    println!("cargo:rerun-if-env-changed=CI_COMMIT_SHA");
}

fn short_hash_from_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .and_then(|value| shorten_hash(&value))
}

fn short_hash_from_git() -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "--short=7", "HEAD"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let hash = String::from_utf8(output.stdout).ok()?;
    let hash = hash.trim();

    (!hash.is_empty()).then(|| hash.to_string())
}

fn shorten_hash(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let short = trimmed.get(..7).unwrap_or(trimmed);
    Some(short.to_string())
}

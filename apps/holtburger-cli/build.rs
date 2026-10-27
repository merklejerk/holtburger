use std::process::Command;

fn main() {
    // The Windows executable owns its shell icon; terminal rendering is unaffected.
    let icon = "../../assets/branding/icon.ico";
    println!("cargo:rerun-if-changed={icon}");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        winresource::WindowsResource::new()
            .set_icon(icon)
            .set("ProductName", "Holtburger")
            .set("FileDescription", "Holtburger CLI")
            .compile()
            .expect("failed to embed the Holtburger Windows icon");
    }

    let version = std::env::var("HOLTBURGER_BUILD_VERSION")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            let revision = short_hash_from_env("HOLTBURGER_SOURCE_REVISION")
                .or_else(short_hash_from_git)
                .unwrap_or_else(|| "unknown".to_string());
            format!(
                "{} ({revision})",
                std::env::var("CARGO_PKG_VERSION").expect("Cargo package version")
            )
        });

    println!("cargo:rustc-env=HOLTBURGER_BUILD_VERSION={version}");
    println!("cargo:rerun-if-env-changed=HOLTBURGER_BUILD_VERSION");
    println!("cargo:rerun-if-env-changed=HOLTBURGER_SOURCE_REVISION");
    // HEAD may be a symbolic ref; watch both its target and packed refs for local commit changes.
    for reference in ["HEAD", "packed-refs"] {
        watch_git_path(reference);
    }
    if let Ok(output) = Command::new("git")
        .args(["symbolic-ref", "-q", "HEAD"])
        .output()
        && output.status.success()
    {
        watch_git_path(
            String::from_utf8(output.stdout)
                .expect("Git ref encoding")
                .trim(),
        );
    }
}

fn watch_git_path(reference: &str) {
    if let Ok(output) = Command::new("git")
        .args(["rev-parse", "--git-path", reference])
        .output()
        && output.status.success()
    {
        println!(
            "cargo:rerun-if-changed={}",
            String::from_utf8(output.stdout)
                .expect("Git path encoding")
                .trim()
        );
    }
}

fn short_hash_from_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .and_then(|value| shorten_hash(&value))
}

fn short_hash_from_git() -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "--short=8", "HEAD"])
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

    let short = trimmed.get(..8).unwrap_or(trimmed);
    Some(short.to_string())
}

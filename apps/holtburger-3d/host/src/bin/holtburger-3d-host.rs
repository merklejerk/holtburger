//! Framed stdio entry point for the Electron sidecar.

#[tokio::main]
async fn main() {
    // The framed sidecar protocol owns stdout; runtime diagnostics belong on stderr.
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn"))
        .target(env_logger::Target::Stderr)
        .init();
    let launch = match holtburger_3d_host::host_mode::HostLaunch::parse(std::env::args().skip(1)) {
        Ok(mode) => mode,
        Err(error) => {
            eprintln!("holtburger-3d-host argument error: {error:#}");
            std::process::exit(2);
        }
    };
    if let Err(error) = holtburger_3d_host::protocol::run_stdio(launch).await {
        eprintln!("holtburger-3d-host failed: {error:#}");
        std::process::exit(1);
    }
}

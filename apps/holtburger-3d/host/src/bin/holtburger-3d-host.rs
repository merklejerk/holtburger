//! Framed stdio entry point for the Electron sidecar.

#[tokio::main]
async fn main() {
    if let Err(error) = holtburger_3d_host::protocol::run_stdio().await {
        eprintln!("holtburger-3d-host failed: {error:#}");
        std::process::exit(1);
    }
}

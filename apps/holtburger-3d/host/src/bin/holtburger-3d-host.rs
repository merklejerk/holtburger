//! Framed stdio entry point for the Electron sidecar.

#[tokio::main]
async fn main() {
    let mode = match holtburger_3d_host::runtime::HostMode::parse_args(std::env::args().skip(1)) {
        Ok(mode) => mode,
        Err(error) => {
            eprintln!("holtburger-3d-host argument error: {error:#}");
            std::process::exit(2);
        }
    };
    if let Err(error) = holtburger_3d_host::protocol::run_stdio(mode).await {
        eprintln!("holtburger-3d-host failed: {error:#}");
        std::process::exit(1);
    }
}

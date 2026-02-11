# Release Bundle Test Environment 🍔📦

This environment is for manually testing Holtburger release bundles (tarballs and Flatpaks).

## Setup

1.  **Environment Variables**:
    ```bash
    cp docker.env.example docker.env
    ```

2.  **Stage Artifacts**:
    Place your tarballs or `.flatpak` bundles in `staging/`.

3.  **Run the Test Session**:
    Just run the start script to get a fresh, pristine environment:
    ```bash
    ./start.sh
    ```
    This will nukes any old container, build/start a new one, and drop you straight into a `bash` terminal.

### Manual Commands
If you prefer the manual way:
1.  **Build and Start**:
    ```bash
    docker-compose up -d
    ```

## Testing Bundles

Inside the container:

### Tarballs
```bash
cd /app/staging
tar -xvf holtburger-nightly-x86_64-unknown-linux-gnu.tar.gz
./holtburger-cli --host host.docker.internal --port 9000
```

### Flatpaks
```bash
flatpak install --user --noninteractive /app/staging/holtburger-cli.flatpak
flatpak run io.github.merklejerk.holtburger-cli --host host.docker.internal --port 9000
```

## Connectivity
- The container is configured with `host.docker.internal` pointing to your host machine's gateway.
- If you are running ACE on your host, use `host.docker.internal` as the server IP.
- The root `dats/` folder is mounted at `/app/dats`.

## Tools Included
- **Rust Runtime**: `cargo`, `rustc`, etc. are available if you need to build quick tools.
- **Flatpak**: Pre-configured with Flathub.
- **Libs**: `libssl`, `libc`, etc. for running the binaries.

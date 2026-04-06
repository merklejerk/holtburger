## Setup
- By default, builds and runs a dockerized ACE from the submodule in `../ACE`.
- Copy/link ACE dat files into `./dats`.
- Create `./docker.env` or copy from [`docker.example.env`](./docker.example.env).
- Create a `docker-compose.override.yml` to override docker compose settings.
    - If you're using podman, you'll probably need to override networking to use "host" mode.
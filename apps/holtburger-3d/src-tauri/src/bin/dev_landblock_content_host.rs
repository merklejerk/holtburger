use anyhow::Context;
use holtburger_3d::{
    LandblockSourceLayer, LoadTexturePixelsRequest, SphereSweepRequest,
    dynamic_entity_visual_source::load_dynamic_entity_visual_source_bytes,
    explorer_entity_delivery::ExplorerEntityDelivery,
    explorer_entity_driver::{
        DatExplorerEntityContentPreparer, ExplorerEntityDriver, ExplorerEntityLaunchRequest,
        ExplorerEntityRelocationRequest, ExplorerEntitySpawnRequest, SystemExplorerEntityClock,
    },
    explorer_entity_runtime::ExplorerEntityRuntime,
    explorer_weenie_catalog::ExplorerWeenieCatalog,
    host_simulation_runtime::{CollisionSource, HostSimulationRuntime, SimulationInterestRequest},
    load_active_region_data_bytes, load_animation_bytes, load_landblock_source_batch_bytes,
    load_motion_table_closure_ids, load_particle_emitter_bytes, load_particle_meshes_bytes,
    load_physics_script_bytes, load_sky_source_bytes, load_sound_table_bytes,
    load_texture_pixels_bytes, resolve_sphere_sweep,
};
use holtburger_content::{ContentDecodeCache, ContentRepository};
use holtburger_core::{ContentAssetRuntime, ContentAssetService};
use holtburger_world::EntityAppearance;
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Arc, time::Duration, time::Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const DEFAULT_HOST: &str = "127.0.0.1";
const MAX_HEADER_BYTES: usize = 32 * 1024;

#[derive(Debug)]
struct Args {
    host: String,
    port: u16,
}

#[derive(Serialize)]
struct ReadyMessage {
    kind: &'static str,
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LandblockSourceBatchRequest {
    landblock_id: String,
    layers: Vec<LandblockSourceLayer>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnimationRequest {
    animation_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PhysicsScriptRequest {
    script_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MotionTableClosureRequest {
    motion_table_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParticleEmitterRequest {
    emitter_info_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParticleMeshesRequest {
    hw_gfx_obj_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SoundTableRequest {
    sound_table_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DynamicEntityVisualRequest {
    setup_did: u32,
    appearance: EntityAppearance,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExplorerEntityDespawnRequest {
    guid: holtburger_common::Guid,
    generation: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExplorerEntityTickRequest {
    duration_milliseconds: f64,
}

struct DevHostState {
    content: ContentAssetRuntime,
    /// Held so the harness can stage a motion closure, which entity activation requires.
    motion: Arc<holtburger_content::MotionSequenceCatalog>,
    entities: Arc<ExplorerEntityDriver>,
    delivery: Arc<ExplorerEntityDelivery>,
    runtime: Arc<ExplorerEntityRuntime>,
    simulation: Arc<HostSimulationRuntime>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = parse_args()?;
    let state = Arc::new(discover_host_state()?);
    let listener = TcpListener::bind((args.host.as_str(), args.port)).await?;
    let address = listener.local_addr()?;
    println!(
        "{}",
        serde_json::to_string(&ReadyMessage {
            kind: "holtburger-3d-dev-landblock-content-host-ready",
            url: format!("http://{address}"),
        })?
    );

    loop {
        let (stream, _) = listener.accept().await?;
        let state = Arc::clone(&state);
        tokio::spawn(async move {
            if let Err(error) = handle_connection(stream, &state).await {
                eprintln!("[holtburger-3d-dev-landblock-content-host] request failed: {error:#}");
            }
        });
    }
}

async fn handle_connection(mut stream: TcpStream, state: &DevHostState) -> anyhow::Result<()> {
    let runtime = &state.content;
    let request = read_request(&mut stream).await?;
    match (request.method.as_str(), request.path.as_str()) {
        ("OPTIONS", _) => write_response(&mut stream, 204, "text/plain", &[]).await,
        ("GET", "/health") => {
            write_response(&mut stream, 200, "application/json", br#"{"ok":true}"#).await
        }
        ("POST", "/active-region-data") => match load_active_region_data_bytes(runtime).await {
            Ok(bytes) => write_response(&mut stream, 200, "application/octet-stream", &bytes).await,
            Err(error) => write_error(&mut stream, error).await,
        },
        ("POST", "/sky-source") => match load_sky_source_bytes(runtime).await {
            Ok(bytes) => write_response(&mut stream, 200, "application/octet-stream", &bytes).await,
            Err(error) => write_error(&mut stream, error).await,
        },
        ("POST", "/landblock-source-batch") => {
            let request = serde_json::from_slice::<LandblockSourceBatchRequest>(&request.body)?;
            let started_at = Instant::now();
            match load_landblock_source_batch_bytes(runtime, &request.landblock_id, request.layers)
                .await
            {
                Ok(bytes) => {
                    write_response_with_headers(
                        &mut stream,
                        200,
                        "application/octet-stream",
                        &bytes,
                        &[(
                            "x-holtburger-landblock-source-batch-duration-ms",
                            (started_at.elapsed().as_secs_f64() * 1_000.0).to_string(),
                        )],
                    )
                    .await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/texture-pixels") => {
            let request = serde_json::from_slice::<LoadTexturePixelsRequest>(&request.body)?;
            match load_texture_pixels_bytes(runtime, request).await {
                Ok(bytes) => {
                    write_response(&mut stream, 200, "application/octet-stream", &bytes).await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/animation") => {
            let request = serde_json::from_slice::<AnimationRequest>(&request.body)?;
            match load_animation_bytes(runtime, &request.animation_id).await {
                Ok(bytes) => {
                    write_response(&mut stream, 200, "application/octet-stream", &bytes).await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/sphere-sweep") => {
            let request = serde_json::from_slice::<SphereSweepRequest>(&request.body)?;
            match resolve_sphere_sweep(&state.simulation, request) {
                Ok(distance) => {
                    write_response(
                        &mut stream,
                        200,
                        "application/json",
                        &serde_json::to_vec(&distance)?,
                    )
                    .await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/motion-table-closure") => {
            let request = serde_json::from_slice::<MotionTableClosureRequest>(&request.body)?;
            match load_motion_table_closure_ids(&state.motion, &request.motion_table_id) {
                Ok(ids) => {
                    write_response(
                        &mut stream,
                        200,
                        "application/json",
                        &serde_json::to_vec(&ids)?,
                    )
                    .await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/physics-script") => {
            let request = serde_json::from_slice::<PhysicsScriptRequest>(&request.body)?;
            match load_physics_script_bytes(runtime, &request.script_id).await {
                Ok(bytes) => {
                    write_response(&mut stream, 200, "application/octet-stream", &bytes).await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/particle-emitter") => {
            let request = serde_json::from_slice::<ParticleEmitterRequest>(&request.body)?;
            match load_particle_emitter_bytes(runtime, &request.emitter_info_id).await {
                Ok(bytes) => {
                    write_response(&mut stream, 200, "application/octet-stream", &bytes).await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/particle-meshes") => {
            let request = serde_json::from_slice::<ParticleMeshesRequest>(&request.body)?;
            match load_particle_meshes_bytes(runtime, &request.hw_gfx_obj_ids).await {
                Ok(bytes) => {
                    write_response(&mut stream, 200, "application/octet-stream", &bytes).await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/sound-table") => {
            let request = serde_json::from_slice::<SoundTableRequest>(&request.body)?;
            match load_sound_table_bytes(runtime, &request.sound_table_id).await {
                Ok(bytes) => {
                    write_response(&mut stream, 200, "application/octet-stream", &bytes).await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/dynamic-entity-visual") => {
            let request = serde_json::from_slice::<DynamicEntityVisualRequest>(&request.body)?;
            match load_dynamic_entity_visual_source_bytes(
                runtime,
                request.setup_did,
                request.appearance,
            )
            .await
            {
                Ok(bytes) => {
                    write_response(&mut stream, 200, "application/octet-stream", &bytes).await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/explorer-entity-spawn") => {
            let request = serde_json::from_slice::<ExplorerEntitySpawnRequest>(&request.body)?;
            let result = state.delivery.with_ordered_publication(|| {
                state.entities.spawn_by_wcid(request)?;
                state.delivery.snapshot_event().map_err(Into::into)
            });
            match result {
                Ok(event) => {
                    write_response(
                        &mut stream,
                        200,
                        "application/json",
                        &serde_json::to_vec(&event)?,
                    )
                    .await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/explorer-entity-despawn") => {
            let request = serde_json::from_slice::<ExplorerEntityDespawnRequest>(&request.body)?;
            let result = state.delivery.with_ordered_publication(|| {
                state.entities.despawn(request.guid, request.generation)?;
                state.delivery.snapshot_event().map_err(Into::into)
            });
            match result {
                Ok(event) => {
                    write_response(
                        &mut stream,
                        200,
                        "application/json",
                        &serde_json::to_vec(&event)?,
                    )
                    .await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/explorer-entity-launch") => {
            let request = serde_json::from_slice::<ExplorerEntityLaunchRequest>(&request.body)?;
            let result = state.delivery.with_ordered_publication(|| {
                let outcome = state.entities.launch(request)?;
                state
                    .delivery
                    .entity(outcome.instance.definition.identity.guid)
                    .map_err(Into::into)
            });
            match result {
                Ok(entity) => {
                    write_response(
                        &mut stream,
                        200,
                        "application/json",
                        &serde_json::to_vec(&entity)?,
                    )
                    .await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/explorer-entity-tick") => {
            let request = serde_json::from_slice::<ExplorerEntityTickRequest>(&request.body)?;
            let result = state.delivery.with_ordered_publication(|| {
                anyhow::ensure!(
                    request.duration_milliseconds.is_finite()
                        && request.duration_milliseconds > 0.0,
                    "Explorer entity tick duration must be positive and finite"
                );
                let duration = Duration::from_secs_f64(request.duration_milliseconds / 1_000.0);
                let ticks = state
                    .runtime
                    .tick_physical_collection(duration.as_secs_f32(), Instant::now())?;
                state.delivery.advanced(ticks, duration)
            });
            match result {
                Ok(event) => {
                    write_response(
                        &mut stream,
                        200,
                        "application/json",
                        &serde_json::to_vec(&event)?,
                    )
                    .await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/explorer-entity-relocate") => {
            let request = serde_json::from_slice::<ExplorerEntityRelocationRequest>(&request.body)?;
            let result = state.delivery.with_ordered_publication(|| {
                let kind = request.kind.advance_kind();
                let outcome = state.entities.relocate(request)?;
                state
                    .delivery
                    .corrected(outcome.instance.definition.identity.guid, kind)
                    .map_err(Into::into)
            });
            match result {
                Ok(event) => {
                    write_response(
                        &mut stream,
                        200,
                        "application/json",
                        &serde_json::to_vec(&event)?,
                    )
                    .await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/simulation-interest-session") => {
            let session = state.simulation.reserve_interest_session();
            write_response(
                &mut stream,
                200,
                "application/json",
                &serde_json::to_vec(&session)?,
            )
            .await
        }
        ("POST", "/simulation-interest") => {
            let request = serde_json::from_slice::<SimulationInterestRequest>(&request.body)?;
            let simulation = Arc::clone(&state.simulation);
            match tokio::task::spawn_blocking(move || simulation.replace_interest(request)).await? {
                Ok(receipt) => {
                    write_response(
                        &mut stream,
                        200,
                        "application/json",
                        &serde_json::to_vec(&receipt)?,
                    )
                    .await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        _ => write_response(&mut stream, 404, "text/plain; charset=utf-8", b"not found").await,
    }
}

fn discover_host_state() -> anyhow::Result<DevHostState> {
    let repository = Arc::new(ContentRepository::discover(None)?);
    let service =
        ContentAssetService::new(Arc::clone(&repository), Arc::new(ContentDecodeCache::new()));
    let content = ContentAssetRuntime::new(service.clone());
    let collision_source: Arc<dyn CollisionSource> = Arc::new(service);
    let simulation = Arc::new(HostSimulationRuntime::new(collision_source));
    let motion_catalog = Arc::new(repository.read_motion_sequence_catalog()?);
    let runtime = Arc::new(ExplorerEntityRuntime::new(
        Arc::clone(&simulation),
        Arc::clone(&motion_catalog),
    ));
    let catalog = Arc::new(ExplorerWeenieCatalog::discover_from_environment(
        repository.source_description().map(Path::new),
    ));
    let entities = Arc::new(ExplorerEntityDriver::new(
        catalog,
        Arc::new(DatExplorerEntityContentPreparer::new(repository)),
        Arc::new(SystemExplorerEntityClock),
        Arc::clone(&runtime),
        Arc::clone(&simulation),
    ));
    Ok(DevHostState {
        content,
        motion: motion_catalog,
        delivery: Arc::new(ExplorerEntityDelivery::new(Arc::clone(&runtime))),
        entities,
        runtime,
        simulation,
    })
}

async fn write_error(stream: &mut TcpStream, error: anyhow::Error) -> anyhow::Result<()> {
    write_response(
        stream,
        500,
        "text/plain; charset=utf-8",
        format!("{error:#}").as_bytes(),
    )
    .await
}

struct HttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

async fn read_request(stream: &mut TcpStream) -> anyhow::Result<HttpRequest> {
    let mut bytes = Vec::new();
    let header_end = loop {
        let mut chunk = [0_u8; 4096];
        let count = stream.read(&mut chunk).await?;
        if count == 0 {
            anyhow::bail!("connection closed before request headers completed");
        }
        bytes.extend_from_slice(&chunk[..count]);
        if bytes.len() > MAX_HEADER_BYTES {
            anyhow::bail!("request headers exceeded {MAX_HEADER_BYTES} bytes");
        }
        if let Some(index) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            break index;
        }
    };

    let headers = std::str::from_utf8(&bytes[..header_end])?;
    let request_line = headers
        .lines()
        .next()
        .context("HTTP request line is missing")?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .context("HTTP method is missing")?
        .to_owned();
    let path = request_parts
        .next()
        .context("HTTP request path is missing")?
        .split('?')
        .next()
        .unwrap_or_default()
        .to_owned();
    let content_length = parse_content_length(headers)?;
    let body_start = header_end + 4;
    while bytes.len() < body_start + content_length {
        let mut chunk = [0_u8; 4096];
        let count = stream.read(&mut chunk).await?;
        if count == 0 {
            anyhow::bail!("connection closed before request body completed");
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    Ok(HttpRequest {
        method,
        path,
        body: bytes[body_start..body_start + content_length].to_vec(),
    })
}

fn parse_content_length(headers: &str) -> anyhow::Result<usize> {
    for line in headers.lines().skip(1) {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("content-length") {
            return Ok(value.trim().parse()?);
        }
    }
    Ok(0)
}

async fn write_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
) -> anyhow::Result<()> {
    write_response_with_headers(stream, status, content_type, body, &[]).await
}

async fn write_response_with_headers(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
    extra_headers: &[(&str, String)],
) -> anyhow::Result<()> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let mut headers = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         access-control-allow-origin: *\r\n\
         access-control-allow-methods: GET, POST, OPTIONS\r\n\
         access-control-allow-headers: content-type\r\n\
         access-control-expose-headers: x-holtburger-landblock-source-batch-duration-ms\r\n\
         content-type: {content_type}\r\n\
         content-length: {}\r\n\
         connection: close\r\n",
        body.len(),
    );
    for (name, value) in extra_headers {
        headers.push_str(&format!("{name}: {value}\r\n"));
    }
    headers.push_str("\r\n");
    stream.write_all(headers.as_bytes()).await?;
    stream.write_all(body).await?;
    stream.shutdown().await?;
    Ok(())
}

fn parse_args() -> anyhow::Result<Args> {
    let mut args = Args {
        host: DEFAULT_HOST.to_owned(),
        port: 0,
    };
    let mut values = std::env::args().skip(1);
    while let Some(value) = values.next() {
        match value.as_str() {
            "--host" => args.host = values.next().context("--host requires a value")?,
            "--port" => args.port = values.next().context("--port requires a value")?.parse()?,
            "--help" | "-h" => {
                println!("Usage: dev_landblock_content_host [--host <host>] [--port <port>]");
                return Ok(args);
            }
            _ => anyhow::bail!("unsupported argument {value}"),
        }
    }
    Ok(args)
}

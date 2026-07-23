use anyhow::Context;
use holtburger_3d::{
    discover_content_runtime, load_terrain_source_bytes, load_texture_pixels_bytes,
};
use serde::{Deserialize, Serialize};
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
struct TerrainSourceRequest {
    landblock_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TexturePixelsRequest {
    kind: String,
    purpose: String,
    source_asset_id: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = parse_args()?;
    let runtime = discover_content_runtime()?;
    let listener = TcpListener::bind((args.host.as_str(), args.port)).await?;
    let address = listener.local_addr()?;
    println!(
        "{}",
        serde_json::to_string(&ReadyMessage {
            kind: "holtburger-3d-dev-terrain-content-host-ready",
            url: format!("http://{address}"),
        })?
    );

    loop {
        let (stream, _) = listener.accept().await?;
        let runtime = runtime.clone();
        tokio::spawn(async move {
            if let Err(error) = handle_connection(stream, &runtime).await {
                eprintln!("[holtburger-3d-dev-terrain-content-host] request failed: {error:#}");
            }
        });
    }
}

async fn handle_connection(
    mut stream: TcpStream,
    runtime: &holtburger_core::ContentAssetRuntime,
) -> anyhow::Result<()> {
    let request = read_request(&mut stream).await?;
    match (request.method.as_str(), request.path.as_str()) {
        ("OPTIONS", _) => write_response(&mut stream, 204, "text/plain", &[]).await,
        ("GET", "/health") => {
            write_response(&mut stream, 200, "application/json", br#"{"ok":true}"#).await
        }
        ("POST", "/terrain-source") => {
            let request = serde_json::from_slice::<TerrainSourceRequest>(&request.body)?;
            match load_terrain_source_bytes(runtime, &request.landblock_id).await {
                Ok(bytes) => {
                    write_response(&mut stream, 200, "application/octet-stream", &bytes).await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        ("POST", "/texture-pixels") => {
            let request = serde_json::from_slice::<TexturePixelsRequest>(&request.body)?;
            match load_texture_pixels_bytes(
                runtime,
                &request.kind,
                &request.purpose,
                &request.source_asset_id,
            )
            .await
            {
                Ok(bytes) => {
                    write_response(&mut stream, 200, "application/octet-stream", &bytes).await
                }
                Err(error) => write_error(&mut stream, error).await,
            }
        }
        _ => write_response(&mut stream, 404, "text/plain; charset=utf-8", b"not found").await,
    }
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
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let headers = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         access-control-allow-origin: *\r\n\
         access-control-allow-methods: GET, POST, OPTIONS\r\n\
         access-control-allow-headers: content-type\r\n\
         content-type: {content_type}\r\n\
         content-length: {}\r\n\
         connection: close\r\n\
         \r\n",
        body.len(),
    );
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
                println!("Usage: dev_terrain_content_host [--host <host>] [--port <port>]");
                return Ok(args);
            }
            _ => anyhow::bail!("unsupported argument {value}"),
        }
    }
    Ok(args)
}

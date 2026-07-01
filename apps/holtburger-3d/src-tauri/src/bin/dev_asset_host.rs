use holtburger_3d::adapter::HostRuntimeService;
use holtburger_3d::contracts::{AssetLookupBatchRequestDto, AssetLookupRequestDto};
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 18230;
const MAX_HEADER_BYTES: usize = 32 * 1024;

#[derive(Debug)]
struct DevAssetHostArgs {
    host: String,
    port: u16,
    verbose: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadyMessage {
    kind: &'static str,
    url: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = parse_args()?;
    let runtime = HostRuntimeService::new(args.verbose);
    let listener = TcpListener::bind((args.host.as_str(), args.port)).await?;
    let local_addr = listener.local_addr()?;
    println!(
        "{}",
        serde_json::to_string(&ReadyMessage {
            kind: "holtburger-3d-dev-asset-host-ready",
            url: format!("http://{}", local_addr),
        })?
    );

    loop {
        let (stream, _) = listener.accept().await?;
        let runtime = runtime.clone();
        tokio::spawn(async move {
            if let Err(error) = handle_connection(stream, runtime).await {
                eprintln!("[holtburger-3d-dev-asset-host] request failed: {error:#}");
            }
        });
    }
}

async fn handle_connection(
    mut stream: TcpStream,
    runtime: HostRuntimeService,
) -> anyhow::Result<()> {
    let request = read_http_request(&mut stream).await?;
    match (request.method.as_str(), request.path.as_str()) {
        ("OPTIONS", _) => write_empty_response(&mut stream, 204).await?,
        ("GET", "/health") => write_json_response(&mut stream, 200, b"{\"ok\":true}").await?,
        ("POST", "/lookup-asset") => {
            let request = serde_json::from_slice::<AssetLookupRequestDto>(&request.body)?;
            match runtime.asset_lookup(request).await {
                Ok(response) => {
                    write_json_response(&mut stream, 200, &serde_json::to_vec(&response)?).await?
                }
                Err(error) => write_text_response(&mut stream, 500, &error.to_string()).await?,
            }
        }
        ("POST", "/lookup-assets-binary") => {
            let request = serde_json::from_slice::<AssetLookupBatchRequestDto>(&request.body)?;
            match runtime.asset_lookup_binary_batch(request.requests).await {
                Ok(bytes) => write_binary_response(&mut stream, 200, &bytes).await?,
                Err(error) => write_text_response(&mut stream, 500, &error.to_string()).await?,
            }
        }
        _ => write_text_response(&mut stream, 404, "not found").await?,
    }
    Ok(())
}

struct HttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

async fn read_http_request(stream: &mut TcpStream) -> anyhow::Result<HttpRequest> {
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
        if let Some(index) = find_header_end(&bytes) {
            break index;
        }
    };

    let headers = std::str::from_utf8(&bytes[..header_end])?;
    let mut lines = headers.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| anyhow::anyhow!("HTTP request line is missing"))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| anyhow::anyhow!("HTTP method is missing"))?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| anyhow::anyhow!("HTTP path is missing"))?
        .split('?')
        .next()
        .unwrap_or("")
        .to_string();

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
        body: bytes[body_start..body_start + content_length].to_vec(),
        method,
        path,
    })
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
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

async fn write_empty_response(stream: &mut TcpStream, status: u16) -> anyhow::Result<()> {
    write_response(stream, status, "text/plain; charset=utf-8", &[]).await
}

async fn write_json_response(
    stream: &mut TcpStream,
    status: u16,
    body: &[u8],
) -> anyhow::Result<()> {
    write_response(stream, status, "application/json", body).await
}

async fn write_binary_response(
    stream: &mut TcpStream,
    status: u16,
    body: &[u8],
) -> anyhow::Result<()> {
    write_response(stream, status, "application/octet-stream", body).await
}

async fn write_text_response(
    stream: &mut TcpStream,
    status: u16,
    body: &str,
) -> anyhow::Result<()> {
    write_response(stream, status, "text/plain; charset=utf-8", body.as_bytes()).await
}

async fn write_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
) -> anyhow::Result<()> {
    let reason = reason_phrase(status);
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

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    }
}

fn parse_args() -> anyhow::Result<DevAssetHostArgs> {
    let mut args = DevAssetHostArgs {
        host: DEFAULT_HOST.to_string(),
        port: DEFAULT_PORT,
        verbose: false,
    };
    let mut raw_args = std::env::args().skip(1);
    while let Some(arg) = raw_args.next() {
        match arg.as_str() {
            "--host" => {
                args.host = raw_args
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("--host requires a value"))?;
            }
            "--port" => {
                args.port = raw_args
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("--port requires a value"))?
                    .parse()?;
            }
            "--verbose" | "-v" => {
                args.verbose = true;
            }
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            _ => anyhow::bail!("unsupported argument {arg}"),
        }
    }
    Ok(args)
}

fn print_help() {
    println!(
        "Usage: dev_asset_host [--host <host>] [--port <port>] [--verbose]\n\
         Serves Holtburger 3D frontend asset lookups over localhost HTTP for browser harnesses."
    );
}

//! Thin WebSocket adapter sharing the exact `ApiCommand`, `ApiQuery`, and `ApiEvent` enums as REST.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinSet;

use crate::engine::LiveApiEngine;
use crate::hooks::ApiError;
use crate::types::{ApiEventTopic, WsClientFrame, WsServerFrame};

const MAX_INFLIGHT_WS_REQUESTS: usize = 32;

pub async fn handle_socket(socket: WebSocket, engine: LiveApiEngine) {
    let (mut sender, mut receiver) = socket.split();
    let mut live_rx = engine.event_log().subscribe_live();
    let mut motion_rx = engine.event_log().subscribe_motion();
    let (reply_tx, mut reply_rx) = mpsc::channel::<WsServerFrame>(MAX_INFLIGHT_WS_REQUESTS * 2);
    let mut inflight: JoinSet<()> = JoinSet::new();

    let mut subscribed = false;
    let mut last_sent_seq: u64 = 0;
    let mut topic_filter: HashSet<ApiEventTopic> = HashSet::new();
    let mut motion_min_interval: Option<Duration> = None;
    let mut last_motion_sent = Instant::now() - Duration::from_secs(1);

    loop {
        tokio::select! {
            _ = inflight.join_next(), if !inflight.is_empty() => {}
            Some(reply) = reply_rx.recv() => {
                if send_frame(&mut sender, &reply).await.is_err() {
                    break;
                }
            }
            incoming = receiver.next() => {
                let Some(Ok(message)) = incoming else {
                    break;
                };
                match message {
                    Message::Text(text) => {
                        let frame: WsClientFrame = match serde_json::from_str(&text) {
                            Ok(frame) => frame,
                            Err(error) => {
                                let err = WsServerFrame::Error {
                                    id: 0,
                                    error: ApiError::invalid(format!("invalid WebSocket frame: {error}")),
                                };
                                if send_frame(&mut sender, &err).await.is_err() {
                                    break;
                                }
                                continue;
                            }
                        };
                        match frame {
                            WsClientFrame::Query { id, query } => {
                                if inflight.len() >= MAX_INFLIGHT_WS_REQUESTS {
                                    let err = WsServerFrame::Error {
                                        id,
                                        error: ApiError::invalid("too many concurrent in-flight WebSocket requests"),
                                    };
                                    if send_frame(&mut sender, &err).await.is_err() {
                                        break;
                                    }
                                    continue;
                                }
                                let engine = engine.clone();
                                let reply_tx = reply_tx.clone();
                                inflight.spawn(async move {
                                    let reply = match engine.query(query).await {
                                        Ok(result) => WsServerFrame::Response { id, result },
                                        Err(error) => WsServerFrame::Error { id, error },
                                    };
                                    let _ = reply_tx.send(reply).await;
                                });
                            }
                            WsClientFrame::Preview { id, preview } => {
                                if inflight.len() >= MAX_INFLIGHT_WS_REQUESTS {
                                    let err = WsServerFrame::Error {
                                        id,
                                        error: ApiError::invalid("too many concurrent in-flight WebSocket requests"),
                                    };
                                    if send_frame(&mut sender, &err).await.is_err() {
                                        break;
                                    }
                                    continue;
                                }
                                let engine = engine.clone();
                                let reply_tx = reply_tx.clone();
                                inflight.spawn(async move {
                                    let reply = match engine.preview(preview).await {
                                        Ok(result) => WsServerFrame::Response { id, result },
                                        Err(error) => WsServerFrame::Error { id, error },
                                    };
                                    let _ = reply_tx.send(reply).await;
                                });
                            }
                            WsClientFrame::Command { id, command, wait } => {
                                if inflight.len() >= MAX_INFLIGHT_WS_REQUESTS {
                                    let err = WsServerFrame::Error {
                                        id,
                                        error: ApiError::invalid("too many concurrent in-flight WebSocket requests"),
                                    };
                                    if send_frame(&mut sender, &err).await.is_err() {
                                        break;
                                    }
                                    continue;
                                }
                                let engine = engine.clone();
                                let reply_tx = reply_tx.clone();
                                inflight.spawn(async move {
                                    let reply = match engine.execute(command, wait).await {
                                        Ok(res) => match serde_json::to_value(res) {
                                            Ok(result) => WsServerFrame::Response { id, result },
                                            Err(error) => WsServerFrame::Error {
                                                id,
                                                error: ApiError::runtime(error.to_string()),
                                            },
                                        },
                                        Err(error) => WsServerFrame::Error { id, error },
                                    };
                                    let _ = reply_tx.send(reply).await;
                                });
                            }
                            WsClientFrame::Subscribe {
                                id,
                                topics,
                                since,
                                include_motion_hz,
                            } => {
                                // Resubscribe live broadcast BEFORE reading catch-up so no events
                                // are missed and stale pre-subscribe frames are dropped cleanly.
                                live_rx = engine.event_log().subscribe_live();
                                subscribed = true;
                                topic_filter = topics.iter().copied().collect();
                                motion_min_interval = include_motion_hz
                                    .map(|hz| Duration::from_millis(1_000 / u64::from(hz.clamp(1, 15))));

                                let mut replayed = 0usize;
                                let mut dropped_before = None;
                                last_sent_seq = since.unwrap_or_else(|| engine.event_log().latest_seq());
                                if let Some(since_seq) = since {
                                    let page = engine.event_log().read_since(
                                        since_seq,
                                        (!topic_filter.is_empty()).then_some(&topic_filter),
                                        500,
                                    );
                                    dropped_before = page.dropped_before;
                                    last_sent_seq = page.next_seq;
                                    for envelope in page.events {
                                        replayed += 1;
                                        if send_frame(&mut sender, &WsServerFrame::Event { envelope })
                                            .await
                                            .is_err()
                                        {
                                            inflight.abort_all();
                                            return;
                                        }
                                    }
                                }

                                let reply = WsServerFrame::Response {
                                    id,
                                    result: json!({
                                        "subscribed": topics,
                                        "latestEventSeq": engine.event_log().latest_seq(),
                                        "nextSeq": last_sent_seq,
                                        "replayed": replayed,
                                        "droppedBefore": dropped_before,
                                    }),
                                };
                                if send_frame(&mut sender, &reply).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                    Message::Ping(payload) => {
                        if sender.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Message::Close(_) => break,
                    Message::Binary(_) | Message::Pong(_) => {}
                }
            }
            live = live_rx.recv(), if subscribed => {
                match live {
                    Ok(envelope) => {
                        if envelope.seq <= last_sent_seq {
                            continue;
                        }
                        last_sent_seq = envelope.seq;
                        if (topic_filter.is_empty() || topic_filter.contains(&envelope.topic))
                            && send_frame(&mut sender, &WsServerFrame::Event { envelope })
                                .await
                                .is_err()
                        {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            motion = motion_rx.recv(), if motion_min_interval.is_some() => {
                match motion {
                    Ok(motion) => {
                        if let Some(min_interval) = motion_min_interval
                            && last_motion_sent.elapsed() >= min_interval
                        {
                            last_motion_sent = Instant::now();
                            if send_frame(&mut sender, &WsServerFrame::Motion { motion }).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
    inflight.abort_all();
}

async fn send_frame(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    frame: &WsServerFrame,
) -> Result<(), axum::Error> {
    let text = match serde_json::to_string(frame) {
        Ok(text) => text,
        Err(error) => {
            log::error!("failed to serialize WebSocket frame: {error}");
            return Ok(());
        }
    };
    sender.send(Message::Text(text.into())).await
}

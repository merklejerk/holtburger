---
title: 'HTTP integrations'
description: 'Send JSON to a service through the TUI’s explicit host allowlist.'
section: 'Scripting'
---

<script>
import status from '../../../examples/status.js?raw';
</script>

## Allow the destination at launch

`HB.postJson()` sends a JSON POST request and returns a Promise. The default allowed destination is **localhost:9999**.

Use `--script-fetch-allow-host HOST:PORT` to choose an allowed host and port, repeating the option for more destinations. Supplying these options replaces the default list. HTTP(S) URLs can also specify the host; paths and credentials are not part of an allowlist entry.

Add the options to your usual TUI connection command. Request limits default to **5,000 ms** and **262,144 response bytes**; change them with `--script-fetch-timeout-ms` and `--script-fetch-max-response-bytes`.

## Send one status update

Start your own JSON service at `http://localhost:9999/status`, then save this as `status.js` and run `/run status`. The service must accept a JSON POST and return JSON. This example sends a status update; it does not supply the service itself.

<pre><code>{status}</code></pre>

[Download the example](/holtburger/assets/scripting/status.js).

## Read the outcome

A completed HTTP response has `ok`, `status`, and `bodyJson`. Check `ok` before using the response as a successful result.

Denied destinations, timeouts, transport failures, oversized responses and invalid JSON reject the Promise. Errors carry a `code` such as `policy_denied`, `timeout` or `response_too_large`. Handle rejections in the script so failures stay visible.

Requests are JSON-only, with no custom headers. The host sends Holtburger-identifying Origin and User-Agent headers. Use a separate service when an integration needs another protocol or credentials handling.

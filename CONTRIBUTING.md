# Contributing

Holtburger is under active development. External pull requests are not being
accepted while the project's architecture, internal APIs, and code quality are
being stabilized. This includes documentation changes and typo fixes. The policy
will be revisited as the codebase matures.

**Issues are welcome:** bug reports, usability feedback, feature suggestions, and
findings about Asheron's Call behavior or compatibility. Please open an issue
instead of submitting a pull request. Issues help guide development but do not
guarantee implementation or a response timeline.

## Before opening an issue

Search [existing issues](https://github.com/merklejerk/holtburger/issues) for a
matching report. Identify the affected client or tool: h3d (the 3D client), the
terminal client (TUI), or a named command-line tool.

## Reporting bugs

Include:

- Steps to reproduce, what you expected, and what happened instead.
- Whether the problem happens consistently or intermittently.
- Your operating system, client or tool version, and release channel or source
  commit when known.
- Relevant error messages, screenshots, or recordings when helpful.
- For connection or gameplay problems, the server implementation and version
  when known, and whether the problem occurs on other servers you have tried.

Additional diagnostics below are useful when relevant, but are not prerequisites
for opening an issue. Review commands, logs, scripts, and attachments for
credentials, private messages, personal paths, and other private information
before posting.

### h3d

Say whether the problem occurs during gameplay or in the offline Explorer.
During gameplay, these chat commands provide useful context:

- `/version` prints the client version and build revision.
- `/loc` prints and copies player and camera locations and orientations. Run it
  where a terrain, collision, or location-dependent rendering problem occurs.
- `/assets` prints the active asset location. Include it for content-loading
  problems, redacting personal paths.

For graphics or performance problems, attach the report copied from the
launcher's **App settings → Current graphics → Copy hardware info**. It includes
build, operating system, hardware, and graphics details and is useful even when
you cannot enter the game.

### Terminal client (TUI)

Include `/version` output from the client, or `tui --version` output, along with
your terminal emulator, shell, and relevant launch options with credentials
removed.

For display or input problems, include terminal dimensions and a screenshot when
possible. For scripting problems, identify the script and include a minimal
reproduction if you can.

If debug logs would help, add these options to your usual launch command and
reproduce the problem:

```text
--debug-log debug.log -VVV
```

This writes debug-level Rust logs to `debug.log`. Separately, `--log chat.log`
writes chat and in-game system messages to `chat.log`. Share only the relevant
parts after reviewing them for private information.

### Command-line tools

Include the tool name, release or source commit, exact command with sensitive
values removed, and full error output. Describe the input format and relevant
options, including archive profiles or namespaces when applicable.

For asset-related problems, include affected record IDs and the source or version
of the input data when known. A small synthetic reproduction is helpful when
possible; an initial report does not need to include game archives or a database
dump.

## Feature requests and compatibility findings

Describe the outcome you want and a concrete example of how it would help. For
compatibility findings, describe the observed behavior, expected behavior, and
evidence supporting that expectation. Distinguish observations from theories.

Holtburger intentionally differs from retail in its physics, rendering, and user
experience; see [Design and compatibility](README.md#design-and-compatibility).
Explain the practical consequence of a difference so it can be evaluated in
context.

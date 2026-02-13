The ultimate goal of this project is to develop a third-party client for Asheron's Call.
- Reverse engineer the Asheron's Call protocol and file formats, recording established behavior in source types, codec comments, and focused tests. Treat the ACE Server code as the ultimate source of truth.
- Included in this repository are submodules for the [ACE Server](ACE/) and the [AC DAT viewer](ACViewer/), which we should use as ground truth references. Never guess. Guessing is dangerous! If you find yourself guessing, STOP and search for a basis in the references. Most likely everything you need to know can be proven by the server or dat viewer code. You are allowed to modify the code in there (like add tracing/logs) and create tests to validate your understanding.
- DO NOT RUN THE TUI CLIENT for diagnostics/testing. It is interactive so will just hang. That's for me to use. You can just write your own bespoke client in the [harness](crates/holtburger-debug-harness/) if you need live data.
- Temporary planning docs can go into the [local plan folder](local/plans/).

## Machine-local guidance

Before working, read the repository-root @local/AGENTS.md if it exists. It contains additional
machine-local guidance. If it is absent, follow the checked-in instructions and
establish behavior from the available references before making uncertain changes.

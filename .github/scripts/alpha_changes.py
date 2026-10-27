#!/usr/bin/env python3
"""Skip compilation for prose-only changes while still reporting a final CI status."""

import json
import os
from pathlib import Path
import subprocess


def documentation_only(path: str) -> bool:
    """Only prose outside build inputs is exempt; shipped quickstart changes need checks."""
    return (
        path.startswith("docs/") and path.endswith(".md")
        and path not in ("docs/ALPHA_QUICKSTART.md", "docs/ALPHA_RELEASING.md")
    ) or ("/" not in path and path.endswith(".md") and path != "LICENSE.md")


def main() -> None:
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    # Tags explicitly request candidates and must validate even a prose-only source change.
    if os.environ.get("GITHUB_REF_TYPE") == "tag":
        relevant = True
    else:
        base = event["pull_request"]["base"]["sha"] if "pull_request" in event else event["before"]
        if set(base) == {"0"}:
            arguments = ["git", "ls-files", "-z"]
        else:
            arguments = ["git", "diff", "--name-only", "-z", base, "HEAD"]
        paths = subprocess.check_output(arguments).decode().split("\0")
        relevant = any(not documentation_only(path) for path in paths if path)
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        output.write(f"relevant={str(relevant).lower()}\n")
    print(f"Build-input changes: {relevant}")


if __name__ == "__main__":
    main()

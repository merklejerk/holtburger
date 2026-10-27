"""Explicit candidates always receive full validation, without push-only event fields."""

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from alpha_changes import main


class CandidateChangeTests(unittest.TestCase):
    """Both candidate entry points bypass the ordinary changed-file classifier."""

    def test_explicit_candidates_validate_even_without_a_push_base(self):
        for event_name, ref_type in (("workflow_dispatch", "branch"), ("push", "tag")):
            with self.subTest(event=event_name), tempfile.TemporaryDirectory() as temporary:
                event = Path(temporary) / "event.json"
                event.write_text("{}")
                output = Path(temporary) / "outputs"
                with (
                    patch.dict(os.environ, {
                        "GITHUB_EVENT_NAME": event_name,
                        "GITHUB_REF_TYPE": ref_type,
                        "GITHUB_EVENT_PATH": str(event),
                        "GITHUB_OUTPUT": str(output),
                    }, clear=True),
                    patch("alpha_changes.subprocess.check_output") as changes,
                ):
                    main()
                changes.assert_not_called()
                self.assertEqual(output.read_text(), "relevant=true\n")

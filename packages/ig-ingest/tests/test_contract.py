from __future__ import annotations

import json
import subprocess
import sys
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

from decent_ig_ingest import cli


class FakePost:
    typename = "GraphImage"
    is_video = False
    video_url = None

    def __init__(self, shortcode, date_utc, caption, url):
        self.shortcode = shortcode
        self.date_utc = date_utc
        self.caption = caption
        self.url = url


class FakeProfile:
    full_name = "Jane Doe"
    biography = "chef. food pics."
    profile_pic_url = "https://cdn.example/avatar.jpg"
    mediacount = 412

    def __init__(self, username="chef_jane"):
        self.username = username

    def get_posts(self):
        return iter(
            [
                FakePost(
                    "CNEW123",
                    datetime.fromisoformat("2026-05-29T14:02:00"),
                    "today's special",
                    "https://cdn.example/full.jpg",
                ),
                FakePost(
                    "COLD123",
                    datetime.fromisoformat("2026-05-01T14:02:00"),
                    "older special",
                    "https://cdn.example/old.jpg",
                ),
            ]
        )


def run_cli(*args, get_profile=None):
    get_profile = get_profile or Mock(return_value=FakeProfile())
    get_loader = Mock(return_value=object())
    with patch("decent_ig_ingest.cli.get_loader", get_loader), patch(
        "decent_ig_ingest.cli.get_profile", get_profile
    ):
        with patch("sys.stdout") as stdout:
            code = cli.main(list(args))
        output = "".join(call.args[0] for call in stdout.write.call_args_list)
    return code, json.loads(output), get_loader, get_profile


class ContractTest(unittest.TestCase):
    def test_fetch_shape(self):
        code, data, get_loader, _ = run_cli("fetch", "chef_jane", "--limit", "1")

        self.assertEqual(code, 0)
        self.assertEqual(data["platform"], "instagram")
        self.assertRegex(data["fetchedAt"], r"^\d{4}-\d{2}-\d{2}T")
        self.assertEqual(len(data["results"]), 1)
        self.assertEqual(get_loader.call_count, 1)

        result = data["results"][0]
        self.assertEqual(result["handle"], "chef_jane")
        self.assertEqual(result["profile"]["fullName"], "Jane Doe")
        self.assertEqual(result["profile"]["bio"], "chef. food pics.")
        self.assertEqual(result["profile"]["avatarUrl"], "https://cdn.example/avatar.jpg")
        self.assertEqual(result["profile"]["postCount"], 412)

        self.assertEqual(len(result["posts"]), 1)
        post = result["posts"][0]
        self.assertEqual(post["sourceId"], "CNEW123")
        self.assertEqual(post["url"], "https://www.instagram.com/p/CNEW123/")
        self.assertEqual(post["postedAt"], "2026-05-29T14:02:00Z")
        self.assertEqual(post["caption"], "today's special")
        self.assertEqual(post["media"], [{"type": "image", "thumbUrl": "https://cdn.example/full.jpg", "fullUrl": "https://cdn.example/full.jpg"}])

    def test_fetch_since_filters_old_posts(self):
        code, data, _, _ = run_cli("fetch", "chef_jane", "--since", "2026-05-10T00:00:00Z")

        self.assertEqual(code, 0)
        self.assertEqual([post["sourceId"] for post in data["results"][0]["posts"]], ["CNEW123"])

    def test_freshness_shape(self):
        code, data, get_loader, _ = run_cli("freshness", "chef_jane")

        self.assertEqual(code, 0)
        self.assertEqual(data["platform"], "instagram")
        self.assertRegex(data["checkedAt"], r"^\d{4}-\d{2}-\d{2}T")
        self.assertEqual(len(data["results"]), 1)
        self.assertEqual(get_loader.call_count, 1)

        result = data["results"][0]
        self.assertEqual(result["handle"], "chef_jane")
        self.assertEqual(result["latest"], {"sourceId": "CNEW123", "postedAt": "2026-05-29T14:02:00Z"})
        self.assertEqual(result["postCount"], 412)

    def test_fetch_batches_handles_with_one_loader(self):
        def get_profile(loader, handle):
            return FakeProfile(username=handle)

        code, data, get_loader, get_profile_mock = run_cli(
            "fetch", "chef_jane", "baker_bob", "--limit", "1", get_profile=Mock(side_effect=get_profile)
        )

        self.assertEqual(code, 0)
        self.assertEqual(get_loader.call_count, 1)
        self.assertEqual(get_profile_mock.call_count, 2)
        self.assertEqual([result["handle"] for result in data["results"]], ["chef_jane", "baker_bob"])

    def test_freshness_batches_handles_with_one_loader_and_per_handle_errors(self):
        def get_profile(loader, handle):
            if handle == "missing":
                raise cli.IngestError("profile not found", "notfound")
            return FakeProfile(username=handle)

        code, data, get_loader, _ = run_cli(
            "freshness", "chef_jane", "missing", get_profile=Mock(side_effect=get_profile)
        )

        self.assertEqual(code, 0)
        self.assertEqual(get_loader.call_count, 1)
        self.assertEqual(data["results"][0]["handle"], "chef_jane")
        self.assertEqual(data["results"][1], {"handle": "missing", "error": "profile not found", "kind": "notfound"})

    def test_console_entry_imports(self):
        result = subprocess.run(
            [sys.executable, "-m", "decent_ig_ingest.cli", "--help"],
            cwd=ROOT,
            env={"PYTHONPATH": str(SRC)},
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("fetch", result.stdout)
        self.assertIn("freshness", result.stdout)


if __name__ == "__main__":
    unittest.main()

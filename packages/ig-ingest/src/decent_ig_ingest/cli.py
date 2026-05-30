from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

try:
    import instaloader
    from instaloader import Profile
    from instaloader.exceptions import (
        BadCredentialsException,
        ConnectionException,
        LoginRequiredException,
        PrivateProfileNotFollowedException,
        ProfileNotExistsException,
        QueryReturnedNotFoundException,
        TwoFactorAuthRequiredException,
    )
except ModuleNotFoundError:
    instaloader = None
    Profile = None

    class BadCredentialsException(Exception):
        pass

    class ConnectionException(Exception):
        pass

    class LoginRequiredException(Exception):
        pass

    class PrivateProfileNotFollowedException(Exception):
        pass

    class ProfileNotExistsException(Exception):
        pass

    class QueryReturnedNotFoundException(Exception):
        pass

    class TwoFactorAuthRequiredException(Exception):
        pass

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    load_dotenv = None


PLATFORM = "instagram"
DEFAULT_LIMIT = 12


class IngestError(Exception):
    def __init__(self, message: str, kind: str = "other"):
        super().__init__(message)
        self.kind = kind


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="decent-ig-ingest")
    sub = parser.add_subparsers(dest="command", required=True)

    fetch_parser = sub.add_parser("fetch", help="Fetch a profile and recent posts")
    fetch_parser.add_argument("handles", nargs="+")
    fetch_parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    fetch_parser.add_argument("--since")

    freshness_parser = sub.add_parser("freshness", help="Fetch newest-post freshness")
    freshness_parser.add_argument("handles", nargs="+")

    args = parser.parse_args(argv)

    try:
        if args.command == "fetch":
            result = fetch(args.handles, limit=args.limit, since=args.since)
        elif args.command == "freshness":
            result = freshness(args.handles)
        else:
            raise IngestError(f"unknown command: {args.command}")
        write_json(result)
        return 0
    except Exception as exc:
        err = classify_error(exc)
        write_json({"error": str(err), "kind": err.kind})
        return 1


def fetch(handles: list[str], limit: int = DEFAULT_LIMIT, since: str | None = None) -> dict[str, Any]:
    if limit < 1:
        raise IngestError("--limit must be >= 1", "other")

    loader = get_loader()
    since_dt = parse_since(since)

    return {
        "platform": PLATFORM,
        "fetchedAt": iso_now(),
        "results": [fetch_one(loader, handle, limit, since_dt) for handle in handles],
    }


def fetch_one(loader: Any, handle: str, limit: int, since_dt: datetime | None) -> dict[str, Any]:
    try:
        profile = get_profile(loader, handle)
        posts = []
        for post in profile.get_posts():
            posted_at = to_utc(post.date_utc)
            if since_dt and posted_at <= since_dt:
                break
            posts.append(post_to_contract(post))
            if len(posts) >= limit:
                break

        return {
            "handle": profile.username,
            "profile": profile_to_contract(profile),
            "posts": posts,
        }
    except Exception as exc:
        err = classify_error(exc)
        return {"handle": normalize_handle_safely(handle), "error": str(err), "kind": err.kind}


def freshness(handles: list[str]) -> dict[str, Any]:
    loader = get_loader()

    return {
        "platform": PLATFORM,
        "checkedAt": iso_now(),
        "results": [freshness_one(loader, handle) for handle in handles],
    }


def freshness_one(loader: Any, handle: str) -> dict[str, Any]:
    try:
        profile = get_profile(loader, handle)
        latest = None
        for post in profile.get_posts():
            latest = {
                "sourceId": post.shortcode,
                "postedAt": isoformat(to_utc(post.date_utc)),
            }
            break

        return {
            "handle": profile.username,
            "latest": latest,
            "postCount": profile.mediacount,
        }
    except Exception as exc:
        err = classify_error(exc)
        return {"handle": normalize_handle_safely(handle), "error": str(err), "kind": err.kind}


def get_loader(username: str | None = None, password: str | None = None) -> Any:
    if instaloader is None:
        raise IngestError("instaloader is not installed; run pip install -r requirements.txt", "auth")

    env_path = Path(__file__).resolve().parents[3] / ".env"
    if load_dotenv:
        load_dotenv(env_path)

    loader = instaloader.Instaloader(
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        post_metadata_txt_pattern="",
        quiet=True,
    )

    username = username or os.environ.get("IG_USERNAME")
    password = password or os.environ.get("IG_PASSWORD")
    session_file = os.environ.get("IG_SESSION_FILE")

    if not username:
        raise IngestError("missing Instagram username; set IG_USERNAME", "auth")

    try:
        loader.load_session_from_file(username, filename=session_file)
    except FileNotFoundError:
        if not password:
            raise IngestError("no saved session and IG_PASSWORD is not set", "auth")
        try:
            loader.login(username, password)
        except TwoFactorAuthRequiredException as exc:
            raise IngestError("two-factor login is required; create an Instaloader session first", "auth") from exc
        loader.save_session_to_file(filename=session_file)

    return loader


def get_profile(loader: Any, handle: str) -> Any:
    try:
        return Profile.from_username(loader.context, normalize_handle(handle))
    except Exception as exc:
        raise classify_error(exc) from exc


def profile_to_contract(profile: Any) -> dict[str, Any]:
    return {
        "fullName": profile.full_name or "",
        "bio": profile.biography or "",
        "avatarUrl": str(profile.profile_pic_url or ""),
        "postCount": profile.mediacount,
    }


def post_to_contract(post: Any) -> dict[str, Any]:
    return {
        "sourceId": post.shortcode,
        "url": f"https://www.instagram.com/p/{post.shortcode}/",
        "postedAt": isoformat(to_utc(post.date_utc)),
        "caption": post.caption or "",
        "media": media_to_contract(post),
    }


def media_to_contract(post: Any) -> list[dict[str, str]]:
    if post.typename == "GraphSidecar":
        media = []
        for node in safe_iter_sidecar(post):
            media.append(
                {
                    "type": "video" if getattr(node, "is_video", False) else "image",
                    "thumbUrl": str(getattr(node, "display_url", "") or ""),
                    "fullUrl": str((getattr(node, "video_url", None) if getattr(node, "is_video", False) else getattr(node, "display_url", "")) or ""),
                }
            )
        return media

    thumb_url = str(getattr(post, "url", "") or "")
    full_url = str((getattr(post, "video_url", None) if getattr(post, "is_video", False) else getattr(post, "url", "")) or "")
    return [
        {
            "type": "video" if getattr(post, "is_video", False) else "image",
            "thumbUrl": thumb_url,
            "fullUrl": full_url,
        }
    ]


def safe_iter_sidecar(post: Any) -> Iterable[Any]:
    try:
        return post.get_sidecar_nodes()
    except Exception:
        return []


def parse_since(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise IngestError(f"invalid --since timestamp: {value}", "other") from exc
    return to_utc(parsed)


def normalize_handle(handle: str) -> str:
    normalized = handle.strip().lstrip("@")
    if not normalized:
        raise IngestError("handle is required", "other")
    return normalized


def normalize_handle_safely(handle: str) -> str:
    try:
        return normalize_handle(handle)
    except IngestError:
        return handle


def to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def iso_now() -> str:
    return isoformat(datetime.now(UTC))


def isoformat(value: datetime) -> str:
    return value.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def classify_error(exc: Exception) -> IngestError:
    if isinstance(exc, IngestError):
        return exc

    message = str(exc) or exc.__class__.__name__
    lower = message.lower()

    if isinstance(exc, (BadCredentialsException, LoginRequiredException)):
        return IngestError(message, "auth")
    if isinstance(exc, (ProfileNotExistsException, QueryReturnedNotFoundException)):
        return IngestError(message, "notfound")
    if isinstance(exc, PrivateProfileNotFollowedException) or "private" in lower:
        return IngestError(message, "private")
    if isinstance(exc, ConnectionException) and ("429" in message or "rate" in lower or "wait" in lower):
        return IngestError(message, "ratelimit")
    return IngestError(message, "other")


def write_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    raise SystemExit(main())

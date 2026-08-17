#!/usr/bin/env python3
"""Small, dependency-free API for Quizzine's administrator upload page."""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import UTC, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(os.environ.get("QUIZZINE_ROOT", Path(__file__).resolve().parent)).resolve()
DATA_FILE = ROOT / "data" / "quizzes.json"
UPLOAD_DIR = ROOT / "public" / "uploads"
MAX_FILE_SIZE = 50 * 1024 * 1024
TOKEN = os.environ.get("QUIZZINE_UPLOAD_TOKEN", "")
ALLOWED_ORIGINS = {"https://quizzine.org", "https://www.quizzine.org", "https://origin.quizzine.org"}


def read_quizzes() -> list[dict]:
    try:
        return json.loads(DATA_FILE.read_text())
    except FileNotFoundError:
        return []


def save_quizzes(quizzes: list[dict]) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = DATA_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(quizzes, indent=2) + "\n")
    temporary.replace(DATA_FILE)


def safe_filename(filename: str) -> str:
    stem = re.sub(r"[^a-z0-9]+", "-", Path(filename).stem.lower()).strip("-")
    return f"{stem or 'quiz'}-{uuid.uuid4().hex[:8]}{Path(filename).suffix.lower()}"


def parse_multipart(headers, body: bytes) -> dict[str, tuple[str | None, bytes]]:
    content_type = headers.get("Content-Type", "")
    match = re.search(r"boundary=([^;]+)", content_type)
    if not match:
        raise ValueError("Expected multipart form data.")
    boundary = match.group(1).strip().strip('"').encode()
    fields = {}
    for part in body.split(b"--" + boundary)[1:]:
        if part in (b"--\r\n", b"--"):
            break
        part = part.lstrip(b"\r\n")
        try:
            raw_headers, value = part.split(b"\r\n\r\n", 1)
            disposition = next(line for line in raw_headers.decode("utf-8", "replace").split("\r\n") if line.lower().startswith("content-disposition:"))
            name = re.search(r'name="([^"]+)"', disposition).group(1)
            filename_match = re.search(r'filename="([^"]*)"', disposition)
        except (StopIteration, AttributeError, ValueError):
            continue
        fields[name] = (filename_match.group(1) if filename_match else None, value.rstrip(b"\r\n"))
    return fields


class API(BaseHTTPRequestHandler):
    server_version = "QuizzineUpload/1.0"

    def end_headers(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        super().end_headers()

    def send_json(self, status: int, payload: object):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Upload-Token")
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path == "/api/quizzes":
            self.send_json(HTTPStatus.OK, {"quizzes": read_quizzes()})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def do_POST(self):
        if urlparse(self.path).path != "/api/quizzes":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return
        if not TOKEN or self.headers.get("X-Upload-Token") != TOKEN:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "A valid administrator upload token is required."})
            return
        if int(self.headers.get("Content-Length", "0")) > MAX_FILE_SIZE + 16_384:
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "Files must be 50 MB or smaller."})
            return
        try:
            form = parse_multipart(self.headers, self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            filename, deck = form["deck"]
            title = form.get("title", (None, b""))[1].decode().strip()
            quizmaster = form.get("quizmaster", (None, b""))[1].decode().strip()
            year = form.get("year", (None, b""))[1].decode().strip()
            handle = form.get("handle", (None, b""))[1].decode().strip()
            topic = form.get("topic", (None, b"Mixed bag"))[1].decode().strip() or "Mixed bag"
        except (KeyError, ValueError, UnicodeDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Send a presentation and its required details."})
            return
        filename = filename or ""
        extension = Path(filename).suffix.lower()
        if extension not in {".ppt", ".pptx"} or not all((title, quizmaster, year)):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Title, quizmaster, year, and a .ppt or .pptx file are required."})
            return
        valid_signature = deck.startswith(b"PK\x03\x04") if extension == ".pptx" else deck.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
        if not valid_signature:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "The uploaded file is not a valid PowerPoint document."})
            return
        if not re.fullmatch(r"\d{4}", year):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Year must be four digits."})
            return
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        stored_name = safe_filename(filename)
        destination = UPLOAD_DIR / stored_name
        destination.write_bytes(deck)
        if destination.stat().st_size > MAX_FILE_SIZE:
            destination.unlink(missing_ok=True)
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "Files must be 50 MB or smaller."})
            return
        quiz = {"id": uuid.uuid4().hex, "title": title, "topic": topic, "file": stored_name, "fileUrl": f"/uploads/{stored_name}", "quizmaster": quizmaster, "year": year, "handle": handle, "uploadedAt": datetime.now(UTC).isoformat()}
        quizzes = read_quizzes()
        quizzes.insert(0, quiz)
        save_quizzes(quizzes)
        self.send_json(HTTPStatus.CREATED, {"quiz": quiz})

    def log_message(self, format, *args):
        print(f"{self.address_string()} - {format % args}")


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("PORT", "8081"))), API).serve_forever()

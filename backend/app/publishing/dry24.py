"""Publish berita ke dry24 lewat CLI lokal, bukan HTTP.

AgentVille dan dry24 berada di server yang sama, jadi AgentVille memanggil
`php artisan berita:publish --payload=-` dengan JSON di STDIN. Tidak ada port, tidak ada
token, dan AgentVille tidak pernah membaca `.env` milik dry24. Command itu memakai
`App\\Services\\BeritaPublisher` yang sama dengan implementasi Laravel lain.

`preview()` hanya menghitung payload; `publish()` hanya boleh dipanggil dari job yang sudah
disetujui (lihat service.py).
"""

import json
import os
import shutil
import subprocess
from pathlib import Path

from app.agent_actions import redact

TIMEOUT_S = 90
MAX_PAYLOAD = 512_000
MAX_OUTPUT = 20_000

DEFAULT_FIELDS = {
    "title": "judul",
    "content": "isi",
    "tanggal": "tanggal",
    "media_url": "gambar_url",
}

DRY24_PRESET = {
    "name": "dry24.id (CLI lokal)",
    "cli_project": os.getenv("AGENTVILLE_DRY24_PROJECT", ""),
    "cli_php": os.getenv("AGENTVILLE_DRY24_PHP", "php"),
    "field_map": dict(DEFAULT_FIELDS),
    "command": "php artisan berita:publish --payload=-",
    "note": "JSON dikirim lewat STDIN. Tanpa HTTP, port, atau token Sanctum.",
}


class PublishError(RuntimeError):
    pass


def _json_object(value: str, what: str) -> dict:
    if not value:
        return {}
    try:
        result = json.loads(value)
    except json.JSONDecodeError:
        raise PublishError(f"{what} bukan JSON yang valid") from None
    if not isinstance(result, dict):
        raise PublishError(f"{what} harus berupa objek JSON")
    return result


def credential_summary(row) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "cli_project": row.cli_project or "",
        "cli_php": row.cli_php or "php",
        "field_map": _json_object(row.field_map_json, "field_map"),
        "enabled": bool(row.enabled),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def validate_location(cli_project: str, cli_php: str) -> tuple[Path, str]:
    """Fail early for a bad project/PHP path, before a preview or a job is created."""
    project = (cli_project or "").strip()
    if not project:
        raise PublishError("Lokasi project dry24 belum diisi")
    project_path = Path(project).expanduser()
    if not project_path.is_dir():
        raise PublishError("Lokasi project dry24 tidak ditemukan")
    if not (project_path / "artisan").is_file():
        raise PublishError("File artisan tidak ditemukan di lokasi project dry24")

    php = (cli_php or "php").strip() or "php"
    if "/" in php or "\\" in php:
        php_path = Path(php).expanduser()
        if not php_path.is_file():
            raise PublishError("Path binary PHP tidak ditemukan")
        php = str(php_path)
    else:
        found = shutil.which(php)
        if not found:
            raise PublishError("PHP tidak ditemukan di PATH")
        php = found
    return project_path, php


def _resolve(credential) -> tuple[Path, str]:
    return validate_location(credential.cli_project, credential.cli_php)


def build(credential, article: dict) -> tuple[list[str], dict, Path]:
    project_path, php = _resolve(credential)
    fields = {**DEFAULT_FIELDS, **_json_object(credential.field_map_json, "field_map")}
    content = article.get("content", "")
    if not isinstance(content, str) or not content.strip():
        raise PublishError("Artikel tidak memiliki isi (content kosong)")

    payload = {}
    for source, target in fields.items():
        if source in article and article[source] not in (None, ""):
            payload[str(target)] = article[source]
    if not payload.get("judul") or not payload.get("isi"):
        raise PublishError("Field map harus menghasilkan judul dan isi untuk dry24")
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if len(body) > MAX_PAYLOAD:
        raise PublishError("Payload terlalu besar (batas 512 KB)")

    args = [php, str(project_path / "artisan"), "--no-ansi", "berita:publish", "--payload=-"]
    return args, payload, project_path


def preview(credential, article: dict) -> dict:
    """Describe the exact payload without running any command."""
    _args, payload, project_path = build(credential, article)
    return {
        "provider": "dry24",
        "transport": "cli",
        "project": str(project_path),
        "command": DRY24_PRESET["command"],
        "payload": payload,
        "note": "Tidak ada HTTP/token. Preview ini tidak menjalankan perintah apa pun.",
    }


def publish(db, credential, article: dict) -> dict:
    """Run the local CLI. Only called by service.execute() after explicit approval."""
    args, payload, project_path = build(credential, article)
    try:
        proc = subprocess.run(
            args,
            input=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(project_path),
            timeout=TIMEOUT_S,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        raise PublishError(f"dry24 CLI timeout setelah {TIMEOUT_S} detik") from None
    except OSError as e:
        raise PublishError(f"dry24 CLI gagal dijalankan: {redact(str(e), 200)}") from None

    out = proc.stdout.decode("utf-8", "replace")[:MAX_OUTPUT]
    err = proc.stderr.decode("utf-8", "replace")[:1000]
    lines = [line for line in out.splitlines() if line.strip()]
    result = {}
    if lines:
        try:
            parsed = json.loads(lines[-1])
            if isinstance(parsed, dict):
                result = parsed
        except json.JSONDecodeError:
            pass

    if proc.returncode != 0 or result.get("status") is False:
        detail = result.get("message") if result else None
        if not detail:
            detail = err.strip() or out.strip() or f"exit code {proc.returncode}"
        raise PublishError(f"dry24 CLI: {redact(str(detail), 400)}")
    if not result or result.get("status") is not True:
        raise PublishError("dry24 CLI tidak mengembalikan JSON hasil yang valid")

    return {"exit_code": proc.returncode, "result": result}

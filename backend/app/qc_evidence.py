"""Build the evidence packet the text-only QC reviewer is allowed to judge.

The reviewer never gets tool access: the orchestrator reads the workspace and the stored
artifacts, runs deterministic checks, and hands over a bounded, redacted packet. The refs in
that packet are the only artifacts a verdict may cite, so a reviewer cannot "discover" a file
that was never delivered (the exact failure this replaces).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

MAX_FILE_BYTES = 256 * 1024
MAX_INVENTORY = 18
MAX_CHECKS = 14
MAX_EXCERPTS = 4
MAX_EXCERPT_CHARS = 500
DEFAULT_BUDGET = 6500

SOURCE_EXTENSIONS = {
    ".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
    ".json", ".md", ".txt", ".svg", ".py", ".yml", ".yaml", ".toml",
}
CHECKED_KINDS = {"html", "css", "js", "md", "json", "svg", "text"}
DIFF_EXTENSIONS = SOURCE_EXTENSIONS

SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv", "env",
    "dist", "build", "out", ".next", ".nuxt", ".cache", "coverage", ".pytest_cache",
    ".mypy_cache", ".ruff_cache", ".tox", ".idea", ".vscode",
    "scratch", ".scratch", "tmp", "temp",
}
SKIP_FILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "pipfile.lock",
    "composer.lock", "gemfile.lock", "cargo.lock", "npm-shrinkwrap.json",
}

SECRET_NAME = re.compile(
    r"(^|/)(\.env($|\.)|credentials?($|\.)|secrets?($|\.)|\.npmrc$|\.pypirc$|"
    r"\.netrc$|token\.json$|id_(rsa|dsa|ecdsa|ed25519)(\.|$)|[^/]+\.(pem|key|p12|pfx|"
    r"jks|keystore|crt|csr)$)",
    re.IGNORECASE,
)
SECRET_ASSIGN = re.compile(
    r"(?i)\b(api[_-]?key|secret|token|password|passwd|authorization|client[_-]?secret)"
    r"\b\s*[:=]\s*[\"']?([^\s\"',;]{4,})"
)
TOKEN_PATTERN = re.compile(
    r"\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|"
    r"AKIA[0-9A-Z]{16})\b"
)
HTML_ID = re.compile(r"\bid=[\"']([^\"']+)", re.IGNORECASE)
JS_ID = re.compile(r"getElementById\(\s*[\"']([^\"']+)[\"']")
LOCAL_REF = re.compile(r"(?<![-\w])(?:href|src)=[\"']([^\"']+)[\"']", re.IGNORECASE)
DIFF_HEADER = re.compile(r"^diff --git a/(.+?) b/(.+)$")


@dataclass(frozen=True)
class QcEvidence:
    text: str
    refs: frozenset[str]
    files: tuple[dict, ...]
    missing: tuple[str, ...]


@dataclass
class _Item:
    ref: str
    rel: str
    path: Path
    kind: str
    size: int
    lines: int
    text: str


def build_evidence(*, workspace: Path | None, artifact_paths: list[str], artifact_dir: Path,
                   project_root: Path, diff: str = "", budget: int = DEFAULT_BUDGET) -> QcEvidence:
    """Return a bounded evidence packet plus the exact refs it contains.

    `workspace` is the shared project workspace, `artifact_paths` are Task.artifact_path
    values (relative to the project root or absolute), and `diff` is an already-captured
    workspace diff. Nothing outside those two roots is read.
    """
    workspace_path = _safe_root(workspace)
    artifact_root = _safe_root(artifact_dir)
    roots = [str(p) for p in (workspace_path, artifact_root, _safe_root(project_root)) if p]

    items: list[_Item] = []
    if workspace_path is not None:
        items.extend(_workspace_items(workspace_path, roots, MAX_INVENTORY))
    items.extend(_artifact_items(artifact_paths, artifact_root, roots,
                                 max(4, MAX_INVENTORY - len(items))))
    items = _dedupe(items)

    missing = [item for item in items if item.ref.startswith("missing:")]
    readable = [item for item in items if not item.ref.startswith("missing:")]

    inventory = [_inventory_line(item) for item in readable]
    inventory.extend(f"{item.ref} | NOT FOUND (do not cite as evidence)" for item in missing)
    inventory = inventory[:MAX_INVENTORY]

    checks = _cross_checks(readable, workspace_path)
    for item in readable:
        if item.kind in CHECKED_KINDS:
            facts = _file_checks(item)
            if facts:
                checks.append(f"- {item.ref}: " + "; ".join(facts))
    checks = checks[:MAX_CHECKS]

    diff_text = _project_diff(diff, roots)
    text = _assemble(inventory, checks, diff_text, readable, budget)
    refs = frozenset(item.ref for item in items)
    files = tuple({"ref": item.ref, "kind": item.kind, "size": item.size,
                   "lines": item.lines} for item in readable)
    return QcEvidence(text=text, refs=refs, files=files,
                      missing=tuple(item.ref for item in missing))


def _safe_root(path: Path | None) -> Path | None:
    if path is None:
        return None
    try:
        return Path(path).resolve()
    except OSError:
        return None


def _is_secret(rel: str) -> bool:
    return bool(SECRET_NAME.search(rel.replace("\\", "/")))


def _skip_file(name: str) -> bool:
    lowered = name.lower()
    return lowered in SKIP_FILES or ".min." in lowered or lowered.endswith(".map")


def _ref(prefix: str, rel: str) -> str:
    return f"{prefix}:{rel.replace(chr(92), '/').replace(' ', '%20')}"


def _kind(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in (".html", ".htm"):
        return "html"
    if suffix == ".css":
        return "css"
    if suffix in (".js", ".mjs", ".cjs", ".jsx"):
        return "js"
    if suffix == ".md":
        return "md"
    if suffix == ".json":
        return "json"
    if suffix == ".svg":
        return "svg"
    if suffix in (".txt", ".yml", ".yaml", ".toml"):
        return "text"
    return suffix.lstrip(".") or "file"


def _read(path: Path, roots: list[str]) -> _Item | None:
    try:
        if path.is_symlink() or not path.is_file():
            return None
        size = path.stat().st_size
        if size > MAX_FILE_BYTES:
            return None
        raw = path.read_bytes()[:MAX_FILE_BYTES]
    except OSError:
        return None
    if b"\x00" in raw[:4096]:
        return None
    text = raw.decode("utf-8", errors="replace")
    text = _redact(text, roots)
    rel = path.name
    return _Item(ref="", rel=rel, path=path, kind=_kind(path), size=size,
                 lines=text.count("\n") + 1, text=text)


def _score(rel: Path) -> tuple:
    rank = {".html": 0, ".htm": 0, ".css": 1, ".js": 1, ".mjs": 1, ".jsx": 2,
            ".ts": 2, ".tsx": 2, ".md": 3, ".json": 4, ".svg": 5}
    in_project = 0 if "landing" in {part.lower() for part in rel.parts} else 1
    return (in_project, rank.get(rel.suffix.lower(), 9), len(rel.parts), rel.as_posix())


def _workspace_items(workspace: Path, roots: list[str], limit: int) -> list[_Item]:
    found: list[tuple[tuple, Path, Path]] = []
    for root, dirs, files in os.walk(workspace, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not _is_secret(d))
        for name in sorted(files):
            path = Path(root) / name
            try:
                if path.is_symlink() or not path.is_file():
                    continue
                rel = path.relative_to(workspace)
            except (OSError, ValueError):
                continue
            if _is_secret(rel.as_posix()):
                continue
            if _skip_file(name):
                continue
            if path.suffix.lower() not in SOURCE_EXTENSIONS:
                continue
            found.append((_score(rel), rel, path))
    found.sort(key=lambda row: row[0])
    items: list[_Item] = []
    for _rank, rel, path in found[:limit]:
        item = _read(path, roots)
        if item is None:
            continue
        item.rel = rel.as_posix()
        item.ref = _ref("workspace", item.rel)
        items.append(item)
    return items


def _artifact_items(paths: list[str], artifact_dir: Path | None, roots: list[str],
                    limit: int) -> list[_Item]:
    if artifact_dir is None:
        return []
    items: list[_Item] = []
    seen: set[str] = set()
    for raw in paths:
        raw = (raw or "").strip()
        if not raw:
            continue
        candidate = Path(raw)
        options = [candidate] if candidate.is_absolute() else [artifact_dir / candidate]
        if not candidate.is_absolute():
            # save_result stores paths relative to the project root when possible.
            project_root = Path(roots[-1]) if roots else None
            if project_root is not None:
                options.append(project_root / candidate)
        resolved = None
        for option in options:
            try:
                option = option.resolve()
                option.relative_to(artifact_dir)
            except (OSError, ValueError):
                continue
            if option.is_file():
                resolved = option
                break
        if resolved is None:
            ref = _ref("missing", raw)
            if ref not in seen:
                seen.add(ref)
                items.append(_Item(ref=ref, rel=raw, path=Path(raw), kind="missing",
                                   size=0, lines=0, text=""))
            continue
        rel = resolved.relative_to(artifact_dir).as_posix()
        ref = _ref("artifact", rel)
        if ref in seen:
            continue
        seen.add(ref)
        item = _read(resolved, roots)
        if item is None:
            continue
        item.rel = rel
        item.ref = ref
        items.append(item)
        if len(items) >= limit:
            break
    return items


def _dedupe(items: list[_Item]) -> list[_Item]:
    seen: set[str] = set()
    unique: list[_Item] = []
    for item in items:
        if item.ref in seen:
            continue
        seen.add(item.ref)
        unique.append(item)
    return unique


def _one_line(value: str, limit: int = 80) -> str:
    return re.sub(r"\s+", " ", value).strip()[:limit]


def _inventory_line(item: _Item) -> str:
    line = f"{item.ref} | {item.kind} | {item.size} B | {item.lines} lines"
    if item.kind == "html":
        title = re.search(r"<title[^>]*>(.*?)</title>", item.text, re.IGNORECASE | re.DOTALL)
        if title:
            line += f' | title="{_one_line(title.group(1), 60)}"'
    elif item.kind == "md":
        heading = re.search(r"^#\s+(.+)$", item.text, re.MULTILINE)
        if heading:
            line += f' | h1="{_one_line(heading.group(1), 60)}"'
    return line


def _redact(text: str, roots: list[str]) -> str:
    for root in roots:
        if root and len(root) > 3:
            text = text.replace(root, "<path>")
            text = text.replace(root.replace("\\", "/"), "<path>")
    text = SECRET_ASSIGN.sub(lambda m: f"{m.group(1)}=[redacted]", text)
    text = TOKEN_PATTERN.sub("[redacted]", text)
    return text


def _file_checks(item: _Item) -> list[str]:
    if item.kind == "html":
        return _html_checks(item.text)
    if item.kind == "css":
        return _css_checks(item.text)
    if item.kind == "js":
        return _js_checks(item.text)
    if item.kind == "md":
        return _md_checks(item.text)
    if item.kind == "json":
        return _json_checks(item.text)
    if item.kind == "svg":
        return _svg_checks(item.text)
    if item.kind == "text":
        return _generic_checks(item.text)
    return []


def _html_checks(text: str) -> list[str]:
    lower = text.lower()
    clean = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    facts = ["doctype=" + ("yes" if "<!doctype html" in lower else "no")]
    lang = re.search(r"<html\b[^>]*\blang=[\"']([^\"']*)", text, re.IGNORECASE)
    if lang:
        facts.append(f"lang={_one_line(lang.group(1), 12)}")
    facts.append("viewport=" + ("yes" if re.search(
        r"<meta[^>]+name=[\"']viewport", text, re.IGNORECASE) else "no"))
    title = re.search(r"<title[^>]*>(.*?)</title>", text, re.IGNORECASE | re.DOTALL)
    if title:
        facts.append(f'title="{_one_line(title.group(1), 60)}"')
    for tag in ("h1", "h2", "section", "nav", "main", "footer", "form", "button"):
        count = len(re.findall(rf"<{tag}\b", text, re.IGNORECASE))
        if count:
            facts.append(f"{tag}={count}")
    sheets = [link for link in re.findall(r"<link\b[^>]*>", text, re.IGNORECASE)
              if "stylesheet" in link.lower()]
    hrefs = [m.group(1) for m in
             (re.search(r"href=[\"']([^\"']+)", link, re.IGNORECASE) for link in sheets) if m]
    if hrefs:
        facts.append("stylesheets=" + ",".join(hrefs)[:120])
    scripts = re.findall(r"<script\b[^>]*>", text, re.IGNORECASE)
    srcs = [m.group(1) for m in
            (re.search(r"src=[\"']([^\"']+)", tag, re.IGNORECASE) for tag in scripts) if m]
    facts.append(f"scripts={len(scripts)}" + (f" src={','.join(srcs)[:100]}" if srcs else ""))
    images = re.findall(r"<img\b[^>]*>", text, re.IGNORECASE)
    if images:
        missing_alt = sum(1 for image in images
                          if not re.search(r"\balt\s*=", image, re.IGNORECASE))
        facts.append(f"img={len(images)}(missing alt={missing_alt})")
    inline = len(re.findall(r"\sstyle=[\"']", text, re.IGNORECASE))
    if inline:
        facts.append(f"inline-style={inline}")
    ids = set(HTML_ID.findall(text))
    facts.append(f"ids={len(ids)}")
    section_ids = re.findall(r"<section\b[^>]*\bid=[\"']([^\"']+)", text, re.IGNORECASE)
    if section_ids:
        facts.append("section-ids=" + ",".join(dict.fromkeys(section_ids))[:120])
    anchors = list(dict.fromkeys(
        re.findall(r"<a\b[^>]*\bhref=[\"']#([^\"']+)", text, re.IGNORECASE)))
    if anchors:
        missing_targets = [anchor for anchor in anchors if anchor not in ids]
        facts.append("anchor-targets=" + ",".join(anchors)[:120])
        facts.append(f"anchor-targets-missing={len(missing_targets)}"
                     + (":" + ",".join(missing_targets[:4]) if missing_targets else ""))
    wa_links = re.findall(r"https?://wa\.me/[^\s\"'<>]+", text, re.IGNORECASE)
    if wa_links:
        text_param = any("text=" in link for link in wa_links)
        new_tab = 'target="_blank"' in text or "target='_blank'" in text
        facts.append(f"wa-links={len(wa_links)} text-param="
                     f"{'yes' if text_param else 'no'} new-tab={'yes' if new_tab else 'no'}")
    external_scripts = [src for src in srcs
                        if src.startswith(("http://", "https://", "//"))]
    external_styles = [href for href in hrefs
                       if href.startswith(("http://", "https://", "//"))]
    facts.append(f"external-scripts={len(external_scripts)} "
                 f"external-styles={len(external_styles)}")
    inline_handlers = len(re.findall(r"\son[a-z]+\s*=", text, re.IGNORECASE))
    facts.append(f"inline-handlers={inline_handlers}")
    mismatches: list[str] = []
    for tag in ("html", "head", "body", "header", "main", "section", "footer", "nav",
                "div", "ul", "li", "a", "button", "form"):
        opens = len(re.findall(rf"<{tag}\b(?![^>]*/>)", clean, re.IGNORECASE))
        closes = len(re.findall(rf"</{tag}\s*>", clean, re.IGNORECASE))
        if opens != closes:
            mismatches.append(f"{tag}:{opens}/{closes}")
    facts.append("tag-balance=" + ("ok" if not mismatches
                                   else "mismatch " + ",".join(mismatches[:5])))
    return facts


def _css_checks(text: str) -> list[str]:
    media = len(re.findall(r"@media", text, re.IGNORECASE))
    keyframes = len(re.findall(r"@keyframes", text, re.IGNORECASE))
    custom_props = len(re.findall(r"--[A-Za-z0-9_-]+\s*:", text))
    var_uses = len(re.findall(r"var\(\s*--", text))
    colors = len(re.findall(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(", text))
    facts = [
        f"rule-blocks={text.count('{')}",
        f"@media={media}",
        f"@keyframes={keyframes}",
        f"custom-props={custom_props}",
        f"var-uses={var_uses}",
    ]
    layout = len(re.findall(r"display\s*:\s*(?:flex|grid)", text, re.IGNORECASE))
    if layout:
        facts.append(f"flex-grid={layout}")
    facts.append(f"!important={text.lower().count('!important')}")
    facts.append(f"colors={colors}")
    conditions = list(dict.fromkeys(
        _one_line(item, 50) for item in re.findall(r"@media[^{]+", text, re.IGNORECASE)))
    if conditions:
        facts.append("breakpoints=" + " | ".join(conditions)[:160])
    fonts = list(dict.fromkeys(
        _one_line(item, 40) for item in
        re.findall(r"font-family\s*:\s*([^;}{]+)", text, re.IGNORECASE)))
    if fonts:
        facts.append("font-families=" + " | ".join(fonts)[:140])
    prop_names = list(dict.fromkeys(re.findall(r"(--[A-Za-z0-9_-]+)\s*:", text)))
    if prop_names:
        facts.append("custom-prop-names=" + ",".join(prop_names)[:140])
    overflow_hidden = bool(re.search(r"overflow-x\s*:\s*hidden", text, re.IGNORECASE))
    facts.append(f"overflow-x-hidden={'yes' if overflow_hidden else 'no'}")
    facts.append(f"box-sizing={'yes' if 'box-sizing' in text else 'no'}")
    max_width = len(re.findall(r"max-width\s*:\s*100%", text, re.IGNORECASE))
    facts.append(f"max-width-100={max_width}")
    smooth = bool(re.search(r"scroll-behavior\s*:\s*smooth", text, re.IGNORECASE))
    facts.append(f"smooth-scroll={'yes' if smooth else 'no'}")
    external_imports = len(re.findall(
        r"@import[^;]*url\(\s*[\"']?https?://", text, re.IGNORECASE))
    facts.append(f"external-imports={external_imports}")
    return facts


def _js_checks(text: str) -> list[str]:
    checks = (
        ("listeners", r"addEventListener\s*\("),
        ("querySelector", r"querySelector(?:All)?\s*\("),
        ("getElementById", r"getElementById\s*\("),
        ("fetch", r"\bfetch\s*\("),
        ("innerHTML-writes", r"\.innerHTML\s*=|insertAdjacentHTML\s*\("),
        ("storage", r"\b(?:local|session)Storage\b"),
        ("dom-ready", r"DOMContentLoaded"),
        ("todo-markers", r"\b(?:TODO|FIXME|XXX)\b"),
    )
    facts = [f"{label}={len(re.findall(pattern, text))}"
             for label, pattern in checks if re.search(pattern, text)]
    toggles = len(re.findall(r"classList\.(?:toggle|add|remove)", text))
    if toggles:
        facts.append(f"classlist-updates={toggles}")
    scroll_calls = len(re.findall(r"scrollIntoView|scrollTo\s*\(", text))
    if scroll_calls:
        facts.append(f"scroll-calls={scroll_calls}")
    wa_refs = len(re.findall(r"wa\.me", text, re.IGNORECASE))
    if wa_refs:
        facts.append(f"wa-me-refs={wa_refs}")
    window_opens = len(re.findall(r"window\.open\s*\(", text))
    if window_opens:
        facts.append(f"window-open={window_opens}")
    external_imports = len(re.findall(
        r"(?:import|require)\s*\(?\s*[\"']https?://", text, re.IGNORECASE))
    facts.append(f"external-imports={external_imports}")
    aria_refs = len(re.findall(r"aria-expanded", text))
    if aria_refs:
        facts.append(f"aria-expanded-refs={aria_refs}")
    return facts


def _md_checks(text: str) -> list[str]:
    headings = len(re.findall(r"^#{1,6}\s+\S", text, re.MULTILINE))
    words = len(re.findall(r"\w+", text))
    facts = [
        f"headings={headings}",
        f"code-blocks={text.count('```') // 2}",
        f"words={words}",
    ]
    tables = len(re.findall(r"^\|.*\|\s*$", text, re.MULTILINE))
    if tables:
        facts.append(f"table-rows={tables}")
    links = len(re.findall(r"\[[^\]]+\]\([^)]+\)", text))
    if links:
        facts.append(f"links={links}")
    todos = len(re.findall(r"\b(?:TODO|FIXME|XXX)\b", text))
    if todos:
        facts.append(f"todo-markers={todos}")
    lowered = text.lower()
    mentions = [marker for marker in
                ("html-validate", "lighthouse", "viewport", "wa.me", "320", "console")
                if marker in lowered]
    if mentions:
        facts.append("verification-mentions=" + ",".join(mentions))
    return facts


def _json_checks(text: str) -> list[str]:
    try:
        payload = json.loads(text)
    except ValueError as exc:
        return [f"valid-json=no ({_one_line(str(exc), 60)})"]
    if isinstance(payload, dict):
        return [f"valid-json=yes keys={len(payload)}"]
    if isinstance(payload, list):
        return [f"valid-json=yes items={len(payload)}"]
    return ["valid-json=yes"]


def _svg_checks(text: str) -> list[str]:
    facts = []
    viewbox = re.search(r"viewBox=[\"']([^\"']+)", text, re.IGNORECASE)
    if viewbox:
        facts.append(f"viewBox={_one_line(viewbox.group(1), 30)}")
    paths = len(re.findall(r"<path\b", text, re.IGNORECASE))
    facts.append(f"paths={paths}")
    title = re.search(r"<title[^>]*>(.*?)</title>", text, re.IGNORECASE | re.DOTALL)
    if title:
        facts.append(f'title="{_one_line(title.group(1), 40)}"')
    return facts


def _generic_checks(text: str) -> list[str]:
    words = len(re.findall(r"\w+", text))
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]
    return [f"words={words}", f"sha256={digest}"]


def _cross_checks(items: list[_Item], workspace: Path | None) -> list[str]:
    if workspace is None:
        return []
    facts: list[str] = []
    htmls = [item for item in items if item.kind == "html"]
    if htmls:
        missing: list[str] = []
        for html in htmls:
            for ref in _local_refs(html.text):
                target = _resolve_relative(workspace, html.rel, ref)
                if target is not None and not target.exists():
                    missing.append(f"{html.rel}->{ref}")
        if missing:
            facts.append("- cross-file: missing local assets: " + ", ".join(missing[:5]))
        else:
            facts.append("- cross-file: all local HTML asset refs exist")
    html_ids: set[str] = set()
    for html in htmls:
        html_ids.update(HTML_ID.findall(html.text))
    js_ids: set[str] = set()
    for script in (item for item in items if item.kind == "js"):
        js_ids.update(JS_ID.findall(script.text))
    if js_ids:
        absent = sorted(js_ids - html_ids)
        if absent:
            facts.append("- cross-file: JS getElementById ids absent from HTML: "
                         + ", ".join(absent[:6]))
        else:
            facts.append(f"- cross-file: all {len(js_ids)} JS getElementById ids exist in HTML")
    return facts


def _local_refs(text: str):
    """Only real relative asset refs are local; lazy data-src, schemes and comments are not files."""
    text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    for ref in LOCAL_REF.findall(text):
        cleaned = ref.strip()
        if cleaned.lower().startswith(
                ("http://", "https://", "//", "#", "mailto:", "tel:", "data:",
                 "javascript:", "ftp:")):
            continue
        yield cleaned


def _resolve_relative(workspace: Path, rel_file: str, ref: str) -> Path | None:
    cleaned = ref.strip().split("?")[0].split("#")[0]
    if not cleaned:
        return None
    if cleaned.startswith(("/", "\\")):
        candidate = workspace / cleaned.lstrip("/\\")
    else:
        candidate = (workspace / rel_file).parent / cleaned
    try:
        resolved = candidate.resolve()
        resolved.relative_to(workspace)
    except (OSError, ValueError):
        return None
    return resolved


def _project_diff(diff: str, roots: list[str]) -> str:
    """Keep only text-source diff blocks; metadata, binaries and secrets are dropped."""
    if not diff.strip():
        return "no diff captured"
    blocks: list[str] = []
    current: list[str] = []
    path: str | None = None
    for line in diff.splitlines():
        header = DIFF_HEADER.match(line)
        if header:
            if current and path and _diff_allowed(path):
                blocks.append("\n".join(current))
            current = [line]
            path = header.group(2)
        else:
            current.append(line)
    if current and path and _diff_allowed(path):
        blocks.append("\n".join(current))
    if not blocks:
        return "no project source changes (metadata, binaries and secrets excluded)"
    text = "\n".join(blocks)
    text = _redact(text, roots)
    if len(text) > 1800:
        text = text[:1800] + "\n… diff excerpt truncated …"
    return text


def _diff_allowed(path: str) -> bool:
    if _is_secret(path) or _skip_file(path.rsplit("/", 1)[-1]):
        return False
    parts = path.replace("\\", "/").split("/")
    if any(part in SKIP_DIRS for part in parts):
        return False
    return Path(path).suffix.lower() in DIFF_EXTENSIONS


def _excerpt_priority(item: _Item) -> tuple[int, str]:
    name = item.rel.lower()
    if name.endswith(("index.html", "index.htm", "style.css", "script.js",
                      "app.js", "main.js")):
        return (0, name)
    if item.kind == "md" and re.search(
            r"laporan|verifikasi|verification|report|test|hasil|qc",
            item.text[:2000], re.IGNORECASE):
        return (1, name)
    if item.kind in {"html", "css", "js"}:
        return (2, name)
    if item.kind == "md":
        return (3, name)
    return (4, name)


def _excerpt(item: _Item, limit: int) -> str:
    text = item.text
    if item.kind == "html":
        head = text[:min(240, limit)]
        marker = re.search(r"<nav\b|<main\b", text, re.IGNORECASE)
        if marker:
            start = max(0, marker.start() - 30)
            tail = text[start:start + max(200, limit - len(head) - 8)]
            return head.rstrip() + "\n…\n" + tail.strip()
        return head
    if item.kind == "css":
        head = text[:min(300, limit)]
        marker = re.search(r"@media\b", text, re.IGNORECASE)
        if marker:
            start = max(0, marker.start() - 20)
            tail = text[start:start + max(200, limit - len(head) - 8)]
            return head.rstrip() + "\n…\n" + tail.strip()
        return head
    if item.kind == "md":
        marker = re.search(
            r"^#{1,3}\s*(?:Hasil|Ringkasan|Kesimpulan|Result|Summary|Verification|Verifikasi)",
            text, re.IGNORECASE | re.MULTILINE)
        if marker:
            head = text[:140]
            tail = text[marker.start():marker.start() + max(200, limit - len(head) - 8)]
            return head.rstrip() + "\n…\n" + tail.strip()
        return text[:limit]
    return text[:limit]


def _assemble(inventory: list[str], checks: list[str], diff_text: str,
              items: list[_Item], budget: int) -> str:
    header = [
        "EVIDENCE INVENTORY (these are the only refs that exist; cite them verbatim)",
    ]
    diff_header = ["", "PROJECT DIFF (text source only; secrets and binaries excluded)"]

    def render(inv: list[str], chk: list[str], diff_body: str) -> str:
        parts = header + inv
        if chk:
            parts += ["", "DETERMINISTIC CHECKS"] + chk
        parts += diff_header + [diff_body]
        return "\n".join(parts)

    # Reserve room for code/report excerpts: they are what the reviewer actually judges.
    reserve = min(2400, max(1200, budget // 3))
    base_budget = max(1200, budget - reserve)
    diff_body = diff_text
    text = render(inventory, checks, diff_body)
    if len(text) > base_budget:
        diff_body = diff_text[:700] + ("\n… truncated …" if len(diff_text) > 700 else "")
        text = render(inventory, checks, diff_body)
    if len(text) > base_budget:
        checks = checks[:8]
        text = render(inventory, checks, diff_body)
    if len(text) > base_budget:
        checks = checks[:5]
        text = render(inventory, checks, diff_body)
    if len(text) > base_budget:
        inventory = inventory[:8]
        text = render(inventory, checks, diff_body)
    if len(text) > base_budget:
        diff_body = "diff omitted to keep the packet within budget"
        text = render(inventory, checks, diff_body)

    excerpts: list[str] = ["", "EXCERPTS (truncated; full files are not provided)"]
    remaining = budget - len(text)
    used = 0
    for item in sorted(items, key=_excerpt_priority):
        if used >= MAX_EXCERPTS:
            break
        body = _excerpt(item, MAX_EXCERPT_CHARS)
        if not body.strip():
            continue
        block = f"\n--- {item.ref} ---\n{body}"
        if len(block) + 40 > remaining:
            if remaining <= 320:
                break
            body = body[:max(120, remaining - 80)]
            block = f"\n--- {item.ref} ---\n{body}"
        excerpts.append(block)
        remaining -= len(block)
        used += 1
    if used:
        text = text + "\n".join(excerpts)
    return text[:budget]

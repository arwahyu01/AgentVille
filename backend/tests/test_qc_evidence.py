import json

from app.qc_evidence import build_evidence


def make_workspace(tmp_path):
    workspace = tmp_path / "ws"
    landing = workspace / "landing"
    landing.mkdir(parents=True)
    (landing / "index.html").write_text(
        "<!doctype html>\n<html lang=\"en\"><head><title>AgentVille</title>"
        "<meta name=\"viewport\" content=\"width=device-width\">"
        "<link rel=\"stylesheet\" href=\"style.css\"></head>"
        "<body><nav>menu</nav><main><h1>Hello</h1><section id=\"app\">"
        "<img src=\"missing.png\" alt=\"x\">"
        "<img data-src=\"assets/lazy.jpg\" alt=\"lazy\">"
        "<!-- <link rel=\"icon\" href=\"assets/favicon.svg\"> -->"
        "<a href=\"https://example.com\">external</a>"
        "<img src=\"data:image/png;base64,AAAA\" alt=\"inline\">"
        "</section></main>"
        "<script src=\"script.js\"></script></body></html>",
        encoding="utf-8")
    (landing / "style.css").write_text(
        ":root{--ink:#222}\nbody{display:grid;color:var(--ink)}\n"
        "@media (max-width:600px){body{display:flex}}\n@keyframes fade{from{opacity:0}}",
        encoding="utf-8")
    (landing / "script.js").write_text(
        "document.addEventListener('DOMContentLoaded', () => {"
        "document.getElementById('app'); document.getElementById('ghost');"
        "document.querySelector('main');});",
        encoding="utf-8")
    (landing / "api_keys.js").write_text(
        "const api_key = \"supersecret123\";\n", encoding="utf-8")
    (workspace / ".env").write_text("TOKEN=do-not-read\n", encoding="utf-8")
    modules = workspace / "node_modules"
    modules.mkdir()
    (modules / "lib.js").write_text("console.log('vendored')\n", encoding="utf-8")
    (workspace / "package-lock.json").write_text(
        json.dumps({"lockfileVersion": 3}), encoding="utf-8")
    return workspace


def make_artifacts(tmp_path):
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    (artifacts / "task-1.md").write_text(
        "# Report\n\nSummary of the delivered work.\n", encoding="utf-8")
    return artifacts


def test_inventory_checks_and_exclusions(tmp_path):
    workspace = make_workspace(tmp_path)
    artifacts = make_artifacts(tmp_path)
    evidence = build_evidence(
        workspace=workspace,
        artifact_paths=["task-1.md", "not-there.md"],
        artifact_dir=artifacts,
        project_root=tmp_path,
    )

    assert "workspace:landing/index.html" in evidence.refs
    assert "workspace:landing/style.css" in evidence.refs
    assert "workspace:landing/script.js" in evidence.refs
    assert "artifact:task-1.md" in evidence.refs
    assert "missing:not-there.md" in evidence.refs
    assert not any(".env" in ref for ref in evidence.refs)
    assert not any("node_modules" in ref for ref in evidence.refs)
    assert not any("package-lock" in ref for ref in evidence.refs)

    assert "doctype=yes" in evidence.text
    assert "rule-blocks=" in evidence.text
    assert "listeners=" in evidence.text
    assert "NOT FOUND" in evidence.text
    assert "supersecret123" not in evidence.text
    assert len(evidence.text) <= 6500


def test_secret_assignment_is_redacted_in_excerpts(tmp_path):
    workspace = tmp_path / "ws"
    workspace.mkdir()
    (workspace / "config.js").write_text(
        'const api_key = "supersecret123";\nconst safe = "visible";\n', encoding="utf-8")
    artifacts = make_artifacts(tmp_path)
    evidence = build_evidence(
        workspace=workspace, artifact_paths=[], artifact_dir=artifacts,
        project_root=tmp_path)

    assert "supersecret123" not in evidence.text
    assert "[redacted]" in evidence.text
    assert "visible" in evidence.text


def test_cross_file_checks_report_missing_assets_and_js_ids(tmp_path):
    workspace = make_workspace(tmp_path)
    artifacts = make_artifacts(tmp_path)
    evidence = build_evidence(
        workspace=workspace, artifact_paths=[], artifact_dir=artifacts,
        project_root=tmp_path)

    check_section = evidence.text.split("EXCERPTS")[0]
    assert "missing local assets" in check_section
    assert "missing.png" in check_section
    assert "lazy.jpg" not in check_section
    assert "favicon.svg" not in check_section
    assert "example.com" not in check_section
    assert "data:image" not in check_section
    assert "JS getElementById ids absent from HTML" in check_section
    assert "ghost" in check_section


def test_project_diff_excludes_secrets_lockfiles_and_binaries(tmp_path):
    workspace = make_workspace(tmp_path)
    artifacts = make_artifacts(tmp_path)
    diff = (
        "diff --git a/landing/index.html b/landing/index.html\n"
        "index 111..222 100644\n--- a/landing/index.html\n+++ b/landing/index.html\n"
        "@@ -1 +1 @@\n-old\n+<h1>new</h1>\n"
        "diff --git a/.env b/.env\n"
        "index 111..222 100644\n--- a/.env\n+++ b/.env\n"
        "@@ -1 +1 @@\n-OLD\n+SECRET_VALUE\n"
        "diff --git a/package-lock.json b/package-lock.json\n"
        "index 111..222 100644\n--- a/package-lock.json\n+++ b/package-lock.json\n"
        "@@ -1 +1 @@\n-{}\n+{\"lockfileVersion\": 3}\n"
        "diff --git a/logo.png b/logo.png\n"
        "Binary files a/logo.png and b/logo.png differ\n"
    )
    evidence = build_evidence(
        workspace=workspace, artifact_paths=[], artifact_dir=artifacts,
        project_root=tmp_path, diff=diff)

    assert "landing/index.html" in evidence.text
    assert "<h1>new</h1>" in evidence.text
    assert "SECRET_VALUE" not in evidence.text
    assert "lockfileVersion" not in evidence.text
    assert "Binary files" not in evidence.text


def test_artifact_outside_artifact_dir_is_refused(tmp_path):
    workspace = make_workspace(tmp_path)
    artifacts = make_artifacts(tmp_path)
    secret = tmp_path / "outside.md"
    secret.write_text("TOPSECRET-CONTENT", encoding="utf-8")
    evidence = build_evidence(
        workspace=workspace, artifact_paths=[str(secret)], artifact_dir=artifacts,
        project_root=tmp_path)

    assert "TOPSECRET-CONTENT" not in evidence.text
    assert any(ref.startswith("missing:") for ref in evidence.refs)


def test_evidence_respects_a_small_budget(tmp_path):
    workspace = make_workspace(tmp_path)
    artifacts = make_artifacts(tmp_path)
    evidence = build_evidence(
        workspace=workspace, artifact_paths=["task-1.md"], artifact_dir=artifacts,
        project_root=tmp_path, budget=1200)
    assert len(evidence.text) <= 1200


def test_missing_workspace_still_returns_artifact_evidence(tmp_path):
    artifacts = make_artifacts(tmp_path)
    evidence = build_evidence(
        workspace=None, artifact_paths=["task-1.md"], artifact_dir=artifacts,
        project_root=tmp_path)
    assert evidence.refs == frozenset({"artifact:task-1.md"})
    assert "EVIDENCE INVENTORY" in evidence.text

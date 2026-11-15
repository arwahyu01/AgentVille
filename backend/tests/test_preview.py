"""The office's deliverable must be showable: the UI puts these bytes on screen."""

from pathlib import Path

import pytest

from app.models import Task
from app.settings_store import set_setting


@pytest.fixture
def workspace(tmp_path, session_factory):
    root = tmp_path / "ws"
    with session_factory() as db:
        set_setting(db, "workspace_root", str(root))
        db.commit()
    return root


def make_task(session_factory, *, title="Landing page", parent_id=None) -> int:
    with session_factory() as db:
        task = Task(title=title, status="completed", parent_id=parent_id)
        db.add(task)
        db.commit()
        return task.id


def write(root: Path, task_id: int, relative: str, text: str) -> Path:
    path = root / f"project-{task_id}" / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def test_serves_the_built_site_inline(client, session_factory, workspace):
    task_id = make_task(session_factory)
    write(workspace, task_id, "landing/index.html", "<h1>Rujak In Siak</h1>")
    write(workspace, task_id, "landing/style.css", "h1 { color: teal; }")

    meta = client.get(f"/api/tasks/{task_id}/preview").json()
    assert meta["kind"] == "web"
    assert meta["entry"] == "landing/index.html"
    assert meta["url"] == f"/api/tasks/{task_id}/preview/landing/index.html"

    page = client.get(meta["url"])
    assert page.status_code == 200
    assert page.headers["content-type"].startswith("text/html")
    assert "Rujak In Siak" in page.text
    # The crew keeps rewriting files while the site is open in the stage.
    assert "no-store" in page.headers["cache-control"]

    css = client.get(f"/api/tasks/{task_id}/preview/landing/style.css")
    assert css.status_code == 200
    assert "color: teal" in css.text


def test_prefers_index_html_over_other_pages(client, session_factory, workspace):
    task_id = make_task(session_factory)
    write(workspace, task_id, "about.html", "<h1>About</h1>")
    write(workspace, task_id, "site/index.html", "<h1>Home</h1>")

    meta = client.get(f"/api/tasks/{task_id}/preview").json()
    assert meta["entry"] == "site/index.html"


def test_child_step_shares_the_anchor_workspace(client, session_factory, workspace):
    anchor_id = make_task(session_factory, title="Build a site")
    step_id = make_task(session_factory, title="Write index.html", parent_id=anchor_id)
    write(workspace, anchor_id, "index.html", "<p>shared</p>")

    assert client.get(f"/api/tasks/{step_id}/preview").json()["kind"] == "web"
    assert client.get(f"/api/tasks/{step_id}/preview/index.html").text == "<p>shared</p>"


def test_returns_an_image_and_a_video_as_such(client, session_factory, workspace):
    image_id = make_task(session_factory, title="Poster")
    write(workspace, image_id, "out/poster.png", "png-bytes")
    image = client.get(f"/api/tasks/{image_id}/preview").json()
    assert image["kind"] == "image"
    assert image["url"].endswith("/out/poster.png")

    video_id = make_task(session_factory, title="Promo")
    write(workspace, video_id, "out/promo.mp4", "mp4-bytes")
    video = client.get(f"/api/tasks/{video_id}/preview").json()
    assert video["kind"] == "video"
    assert video["url"].endswith("/out/promo.mp4")


def test_markdown_is_the_fallback_deliverable(client, session_factory, workspace):
    task_id = make_task(session_factory, title="Report")
    write(workspace, task_id, "LAPORAN.md", "# Findings\n")

    meta = client.get(f"/api/tasks/{task_id}/preview").json()
    assert meta["kind"] == "markdown"
    assert client.get(meta["url"]).text.startswith("# Findings")


def test_no_workspace_means_nothing_to_show(client, session_factory, workspace):
    task_id = make_task(session_factory)
    meta = client.get(f"/api/tasks/{task_id}/preview").json()
    assert meta["kind"] == "none"
    assert meta["url"] == ""


def test_hidden_and_dependency_folders_are_never_exposed(client, session_factory, workspace):
    task_id = make_task(session_factory)
    write(workspace, task_id, ".git/config", "secret")
    write(workspace, task_id, "node_modules/pkg/index.js", "module")
    write(workspace, task_id, "index.html", "<p>ok</p>")

    meta = client.get(f"/api/tasks/{task_id}/preview").json()
    assert [row["path"] for row in meta["files"]] == ["index.html"]
    assert client.get(f"/api/tasks/{task_id}/preview/.git/config").status_code == 404
    assert client.get(f"/api/tasks/{task_id}/preview/node_modules/pkg/index.js").status_code == 404


def test_path_traversal_is_refused(client, session_factory, workspace):
    task_id = make_task(session_factory)
    write(workspace, task_id, "index.html", "<p>ok</p>")
    outside = workspace / "project-secret.txt"
    outside.write_text("do not serve", encoding="utf-8")

    assert client.get(f"/api/tasks/{task_id}/preview/../project-secret.txt").status_code in (404, 400)
    assert client.get(f"/api/tasks/{task_id}/preview/%2e%2e/project-secret.txt").status_code in (404, 400)


def test_result_payload_carries_the_preview(client, session_factory, workspace):
    task_id = make_task(session_factory)
    write(workspace, task_id, "index.html", "<p>ok</p>")

    body = client.get(f"/api/tasks/{task_id}/result").json()
    assert body["preview"]["kind"] == "web"
    assert body["preview"]["entry"] == "index.html"

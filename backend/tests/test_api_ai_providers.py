def test_config_exposes_provider_registry(client, monkeypatch):
    from app.ai import qoder as qoder_mod, registry
    registry._cache.clear()
    monkeypatch.setattr(qoder_mod, "list_available_models", lambda timeout_s=30: ["Efficient", "GLM-5.3"])
    body = client.get("/api/ai/config").json()
    assert body["provider"] == "opencode"
    assert body["ai_model_qoder"] == "Efficient"
    assert body["fallback_enabled"] is False
    assert body["retry_max"] == 1
    assert set(body["providers"]) == {"opencode", "qoder"}
    models = client.get("/api/ai/models", params={"provider": "qoder"}).json()
    assert models["models"] == ["Efficient", "GLM-5.3"]


def test_patch_provider_and_fallback_roundtrip(client):
    resp = client.patch("/api/ai/config", json={"provider": "qoder", "fallback_enabled": True,
                                                "retry_max": 2, "ai_model_qoder": "GLM-5.3"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["provider"] == "qoder" and body["fallback_enabled"] is True
    assert body["retry_max"] == 2 and body["ai_model_qoder"] == "GLM-5.3"


def test_bad_provider_and_models_rejected(client):
    assert client.patch("/api/ai/config", json={"provider": "openrouter"}).status_code == 422
    assert client.patch("/api/ai/config", json={"ai_model_qoder": "../../evil"}).status_code == 422
    assert client.patch("/api/ai/config", json={"ai_model": "Efficient spaces not here"}).status_code == 422
    assert client.get("/api/ai/models", params={"provider": "nope"}).status_code == 422

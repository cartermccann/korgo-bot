"""Credential-isolation contract for Korgo Mini profile operations."""

from pathlib import Path

import tui_gateway.server as server
from hermes_cli import profiles
from hermes_constants import get_hermes_home


def _source_profile(name: str = "source") -> Path:
    source = profiles.create_profile(name, no_alias=True)
    (source / ".env").write_text("SENTINEL_ENV_KEY=secret\n", encoding="utf-8")
    (source / "auth.json").write_text('{"token":"SENTINEL_AUTH"}\n', encoding="utf-8")
    (source / "config.yaml").write_text(
        "model:\n"
        "  provider: sentinel\n"
        "  default: sentinel-model\n"
        "  api_key: SENTINEL_CONFIG_KEY\n"
        "voice:\n"
        "  provider: sentinel-voice\n",
        encoding="utf-8",
    )
    (source / "SOUL.md").write_text("Copied persona, no credentials.\n", encoding="utf-8")
    return source


def test_profiles_create_inherit_none_omits_every_source_and_launch_credential(monkeypatch):
    source = _source_profile()
    launch_home = get_hermes_home()
    (launch_home / ".env").write_text("LAUNCH_SENTINEL=secret\n", encoding="utf-8")
    (launch_home / "auth.json").write_text('{"token":"LAUNCH_AUTH"}\n', encoding="utf-8")
    monkeypatch.setattr(profiles, "check_alias_collision", lambda _name: True)

    response = server._methods["profiles.create"](
        "rid-mini",
        {"clone_from": "source", "inherit": "none", "name": "isolated"},
    )

    assert "error" not in response
    assert response["result"]["mirrored"] == {
        "auth": False,
        "env": False,
        "model_inherited": False,
        "voice": False,
    }
    target = profiles.get_profile_dir("isolated")
    assert not (target / "config.yaml").exists()
    assert not (target / "auth.json").exists()
    env_text = (target / ".env").read_text(encoding="utf-8")
    assert "SENTINEL_ENV_KEY" not in env_text
    assert "LAUNCH_SENTINEL" not in env_text
    assert (target / "SOUL.md").read_text(encoding="utf-8") == "Copied persona, no credentials.\n"
    assert "SENTINEL" not in "\n".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for path in target.rglob("*")
        if path.is_file()
    )
    assert source.is_dir()


def test_profiles_create_default_keeps_legacy_clone_behavior(monkeypatch):
    _source_profile()
    monkeypatch.setattr(profiles, "check_alias_collision", lambda _name: True)

    response = server._methods["profiles.create"](
        "rid-full",
        {"clone_from": "source", "name": "legacy-copy"},
    )

    assert "error" not in response
    target = profiles.get_profile_dir("legacy-copy")
    assert "SENTINEL_ENV_KEY=secret" in (target / ".env").read_text(encoding="utf-8")
    assert "SENTINEL_CONFIG_KEY" in (target / "config.yaml").read_text(encoding="utf-8")
    assert "SENTINEL_AUTH" not in (target / "auth.json").read_text(encoding="utf-8") if (target / "auth.json").exists() else True


def test_profiles_delete_uses_the_validated_profile_primitive(monkeypatch):
    target = profiles.create_profile("disposable", no_alias=True)
    monkeypatch.setattr(profiles, "remove_wrapper_script", lambda _name: None)

    response = server._methods["profiles.delete"]("rid-delete", {"name": "disposable"})

    assert response["result"]["ok"] is True
    assert not target.exists()

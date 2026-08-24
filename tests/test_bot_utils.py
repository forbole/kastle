"""Regression tests for the fixes applied in this branch."""

from __future__ import annotations

import importlib
import time

import pytest

from bot.utils import metrics, teachings


@pytest.fixture(autouse=True)
def teachings_store(tmp_path, monkeypatch):
    monkeypatch.setenv("TEACHINGS_PATH", str(tmp_path / "teachings.json"))
    importlib.reload(teachings)
    yield
    importlib.reload(teachings)


def test_delete_teaching_ignores_short_pattern_snippets():
    entry = teachings.add_teaching("how do i stake", "answer A")
    teachings.add_teaching("what are the fees", "answer B")

    # A one-character snippet matches both patterns as a substring; without the
    # minimum-length guard it would wipe the whole store.
    assert teachings.delete_teaching("a") is False
    assert len(teachings.list_teachings()) == 2

    assert teachings.delete_teaching(entry.id) is True
    assert teachings.delete_teaching("fees") is True
    assert teachings.list_teachings() == []


def test_register_fallback_event_prunes_stale_users():
    registry = metrics.Metrics()
    registry._FALLBACK_WINDOW_SECONDS = 0.05

    assert registry.register_fallback_event(1) is False
    assert registry.register_fallback_event(1) is True

    time.sleep(0.06)
    registry.register_fallback_event(2)

    # User 1's window has expired, so its queue must not linger in the map.
    assert list(registry._fallback_events) == [2]

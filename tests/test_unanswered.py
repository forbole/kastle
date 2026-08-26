from __future__ import annotations

import json
from pathlib import Path

import pytest

from bot.utils import unanswered


@pytest.fixture(autouse=True)
def unanswered_store(tmp_path, monkeypatch):
    path = tmp_path / "unanswered.json"
    monkeypatch.setenv("UNANSWERED_PATH", str(path))
    # Reload module to pick up new path
    import importlib

    importlib.reload(unanswered)
    yield path
    importlib.reload(unanswered)


def test_record_unanswered_creates_entry(unanswered_store: Path):
    entry = unanswered.record_unanswered(
        "How do I back up my wallet?",
        reason="low_confidence",
        metadata={"username": "user1"},
    )

    assert entry["question"] == "How do I back up my wallet?"
    assert entry["reason"] == "low_confidence"
    assert entry["occurrences"] == 1
    assert entry["metadata"]["username"] == "user1"

    stored = json.loads(unanswered_store.read_text())
    assert len(stored) == 1


def test_record_unanswered_increments_occurrences(unanswered_store: Path):
    unanswered.record_unanswered(
        "How do I back up my wallet?",
        reason="low_confidence",
        metadata={"username": "user1"},
    )
    entry = unanswered.record_unanswered(
        "How do I back up my wallet?",
        reason="low_confidence",
        metadata={"chat_type": "group"},
    )

    assert entry["occurrences"] == 2
    assert entry["metadata"]["chat_type"] == "group"
    stored = unanswered.list_unanswered()
    assert len(stored) == 1


def test_clear_unanswered(unanswered_store: Path):
    first = unanswered.record_unanswered(
        "How do I back up my wallet?",
        reason="low_confidence",
    )
    unanswered.record_unanswered(
        "Why is my transaction pending?",
        reason="no_docs",
    )

    removed = unanswered.clear_unanswered([first["id"]])
    assert removed == 1

    remaining = unanswered.list_unanswered()
    assert len(remaining) == 1
    assert remaining[0]["question"] == "Why is my transaction pending?"

    removed_all = unanswered.clear_unanswered()
    assert removed_all == 1
    assert unanswered.list_unanswered() == []


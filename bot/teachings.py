"""Lightweight storage helpers for admin-provided teachings.

Teachings are stored in a JSON file so that admins can add overrides when the
primary documentation does not cover a specific question.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Dict, List, Optional
from uuid import uuid4


DEFAULT_PATH = Path(os.getenv("TEACHINGS_PATH", "data/teachings.json"))


@dataclass
class Teaching:
    id: str
    pattern: str
    answer: str
    context_type: str
    created_at: str
    created_by: str


_LOCK = Lock()


def _ensure_path(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("[]", encoding="utf-8")


def _load_teachings(path: Path = DEFAULT_PATH) -> List[Dict[str, str]]:
    _ensure_path(path)
    with path.open("r", encoding="utf-8") as fh:
        try:
            data = json.load(fh)
        except json.JSONDecodeError:
            data = []
    if not isinstance(data, list):
        data = []
    return data


def _save_teachings(data: List[Dict[str, str]], path: Path = DEFAULT_PATH) -> None:
    _ensure_path(path)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)


def list_teachings() -> List[Dict[str, str]]:
    with _LOCK:
        return _load_teachings()


def add_teaching(
    pattern: str,
    answer: str,
    *,
    context_type: str = "override",
    created_by: str = "system",
) -> Teaching:
    pattern = pattern.strip()
    answer = answer.strip()
    if not pattern or not answer:
        raise ValueError("pattern and answer must be non-empty")

    entry = Teaching(
        id=str(uuid4()),
        pattern=pattern,
        answer=answer,
        context_type=context_type.strip().lower() or "override",
        created_at=datetime.now(timezone.utc).isoformat(),
        created_by=created_by,
    )

    with _LOCK:
        data = _load_teachings()
        data.append(entry.__dict__)
        _save_teachings(data)

    return entry


def delete_teaching(identifier: str) -> bool:
    identifier = identifier.strip().lower()
    if not identifier:
        return False

    removed = False
    with _LOCK:
        data = _load_teachings()
        filtered: List[Dict[str, str]] = []
        for entry in data:
            entry_id = entry.get("id", "").lower()
            pattern = entry.get("pattern", "").lower()
            if entry_id == identifier or identifier in pattern:
                removed = True
                continue
            filtered.append(entry)
        if removed:
            _save_teachings(filtered)
    return removed


def find_matching_teaching(query: str) -> Optional[Dict[str, str]]:
    """Return the teaching whose pattern best matches the query."""

    query_lower = query.lower()
    best: Optional[Dict[str, str]] = None
    best_len = 0

    with _LOCK:
        data = _load_teachings()

    for entry in data:
        pattern = (entry.get("pattern") or "").strip().lower()
        if not pattern:
            continue
        if pattern in query_lower:
            if len(pattern) > best_len:
                best = entry
                best_len = len(pattern)

    return best

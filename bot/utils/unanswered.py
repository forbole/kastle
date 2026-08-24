"""Storage helpers for unanswered questions that require manual follow-up."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Iterable, List, Optional
from uuid import uuid4

DEFAULT_PATH = Path(os.getenv("UNANSWERED_PATH", "data/unanswered.json"))
_LOCK = Lock()


@dataclass
class UnansweredEntry:
    id: str
    question: str
    reason: str
    created_at: str
    updated_at: str
    occurrences: int
    metadata: Dict[str, Any]


def _ensure_path(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("[]", encoding="utf-8")


def _load(path: Path = DEFAULT_PATH) -> List[Dict[str, Any]]:
    _ensure_path(path)
    with path.open("r", encoding="utf-8") as fh:
        try:
            data = json.load(fh)
        except json.JSONDecodeError:
            data = []
    if not isinstance(data, list):
        data = []
    return data


def _save(data: Iterable[Dict[str, Any]], path: Path = DEFAULT_PATH) -> None:
    _ensure_path(path)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(list(data), fh, indent=2, ensure_ascii=False)


def record_unanswered(
    question: str,
    *,
    reason: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Persist an unanswered question for later follow-up.

    Subsequent calls with the same question (case-insensitive) and reason will
    increment an ``occurrences`` counter instead of duplicating entries.
    """

    question = (question or "").strip()
    if not question:
        raise ValueError("question must be non-empty")

    timestamp = datetime.now(timezone.utc).isoformat()
    metadata = metadata or {}
    question_key = question.lower()

    with _LOCK:
        data = _load()
        for entry in data:
            if (
                entry.get("question", "").strip().lower() == question_key
                and entry.get("reason") == reason
            ):
                entry["occurrences"] = int(entry.get("occurrences", 1)) + 1
                entry["updated_at"] = timestamp
                entry.setdefault("metadata", {}).update(metadata)
                _save(data)
                return entry

        unanswered_entry = UnansweredEntry(
            id=str(uuid4()),
            question=question,
            reason=reason,
            created_at=timestamp,
            updated_at=timestamp,
            occurrences=1,
            metadata=metadata,
        )
        data.append(asdict(unanswered_entry))
        _save(data)
        return asdict(unanswered_entry)


def list_unanswered(limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """Return unanswered questions sorted by most recent update."""

    with _LOCK:
        data = _load()

    sorted_entries = sorted(
        data,
        key=lambda entry: entry.get("updated_at") or entry.get("created_at") or "",
        reverse=True,
    )
    if limit is not None and limit >= 0:
        return sorted_entries[:limit]
    return sorted_entries


def clear_unanswered(ids: Optional[Iterable[str]] = None) -> int:
    """Remove unanswered entries. Returns the number of entries removed."""

    with _LOCK:
        data = _load()
        if not ids:
            removed = len(data)
            _save([])
            return removed

        ids_lower = {entry_id.lower() for entry_id in ids}
        filtered = [entry for entry in data if entry.get("id", "").lower() not in ids_lower]
        removed = len(data) - len(filtered)
        if removed:
            _save(filtered)
        return removed
"""Storage helpers for unanswered questions that require manual follow-up."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Iterable, List, Optional
from uuid import uuid4

DEFAULT_PATH = Path(os.getenv("UNANSWERED_PATH", "data/unanswered.json"))
_LOCK = Lock()


@dataclass
class UnansweredEntry:
    id: str
    question: str
    reason: str
    created_at: str
    updated_at: str
    occurrences: int
    metadata: Dict[str, Any]


def _ensure_path(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("[]", encoding="utf-8")


def _load(path: Path = DEFAULT_PATH) -> List[Dict[str, Any]]:
    _ensure_path(path)
    with path.open("r", encoding="utf-8") as fh:
        try:
            data = json.load(fh)
        except json.JSONDecodeError:
            data = []
    if not isinstance(data, list):
        data = []
    return data


def _save(data: Iterable[Dict[str, Any]], path: Path = DEFAULT_PATH) -> None:
    _ensure_path(path)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(list(data), fh, indent=2, ensure_ascii=False)


def record_unanswered(
    question: str,
    *,
    reason: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Persist an unanswered question for later follow-up.

    Subsequent calls with the same question (case-insensitive) and reason will
    increment an ``occurrences`` counter instead of duplicating entries.
    """

    question = (question or "").strip()
    if not question:
        raise ValueError("question must be non-empty")

    timestamp = datetime.now(timezone.utc).isoformat()
    metadata = metadata or {}
    question_key = question.lower()

    with _LOCK:
        data = _load()
        for entry in data:
            if (
                entry.get("question", "").strip().lower() == question_key
                and entry.get("reason") == reason
            ):
                entry["occurrences"] = int(entry.get("occurrences", 1)) + 1
                entry["updated_at"] = timestamp
                entry.setdefault("metadata", {}).update(metadata)
                _save(data)
                return entry

        unanswered = UnansweredEntry(
            id=str(uuid4()),
            question=question,
            reason=reason,
            created_at=timestamp,
            updated_at=timestamp,
            occurrences=1,
            metadata=metadata,
        )
        data.append(asdict(unanswered))
        _save(data)
        return asdict(unanswered)


def list_unanswered(limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """Return unanswered questions sorted by most recent update."""

    with _LOCK:
        data = _load()

    sorted_entries = sorted(
        data,
        key=lambda entry: entry.get("updated_at") or entry.get("created_at") or "",
        reverse=True,
    )
    if limit is not None and limit >= 0:
        return sorted_entries[:limit]
    return sorted_entries


def clear_unanswered(ids: Optional[Iterable[str]] = None) -> int:
    """Remove unanswered entries. Returns the number of entries removed."""

    with _LOCK:
        data = _load()
        if not ids:
            removed = len(data)
            _save([])
            return removed

        ids_lower = {entry_id.lower() for entry_id in ids}
        filtered = [entry for entry in data if entry.get("id", "").lower() not in ids_lower]
        removed = len(data) - len(filtered)
        if removed:
            _save(filtered)
        return removed


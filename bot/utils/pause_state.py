"""Shared pause state for the Telegram bot."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Optional

from bot.utils.logger import get_logger

logger = get_logger("kastle_ai_bot.pause")


@dataclass(frozen=True)
class PauseSnapshot:
    paused: bool
    until: Optional[datetime]
    paused_by: Optional[str]
    started_at: Optional[datetime]


class PauseState:
    """Manage a global pause flag, including auto-resume after a deadline."""

    def __init__(self, default_duration: int) -> None:
        self._default_duration = max(default_duration, 0)
        self._lock = Lock()
        self._paused = False
        self._until: Optional[datetime] = None
        self._paused_by: Optional[str] = None
        self._start_time: Optional[datetime] = None

    # ------------------------------------------------------------------ helpers
    def _now(self) -> datetime:
        return datetime.now(timezone.utc)

    def _auto_resume_locked(self) -> None:
        if self._paused and self._until and self._now() >= self._until:
            logger.info("PAUSE_CLEARED auto resume reached deadline")
            self._paused = False
            self._until = None
            self._paused_by = None
            self._start_time = None

    # ------------------------------------------------------------------ API
    @property
    def default_duration(self) -> int:
        return self._default_duration

    def pause(self, *, duration: Optional[int], actor: Optional[str]) -> PauseSnapshot:
        """Pause the bot for ``duration`` seconds or the default when ``None``."""

        with self._lock:
            self._auto_resume_locked()
            seconds = self._default_duration if duration is None else max(duration, 0)
            now = self._now()
            if seconds == 0:
                logger.info("PAUSE_CLEARED resume requested by %s", actor)
                self._paused = False
                self._until = None
                self._paused_by = None
                self._start_time = None
            else:
                self._paused = True
                self._start_time = now
                self._paused_by = actor
                self._until = now + timedelta(seconds=seconds)
                logger.info(
                    "PAUSE_SET paused_by=%s duration=%s seconds until=%s",
                    actor,
                    seconds,
                    self._until.isoformat(),
                )
            return self.snapshot_locked()

    def resume(self, *, actor: Optional[str]) -> PauseSnapshot:
        with self._lock:
            self._auto_resume_locked()
            if self._paused:
                logger.info("PAUSE_CLEARED resume requested by %s", actor)
            self._paused = False
            self._until = None
            self._paused_by = None
            self._start_time = None
            return self.snapshot_locked()

    def is_paused(self) -> bool:
        with self._lock:
            self._auto_resume_locked()
            return self._paused

    def remaining(self) -> Optional[int]:
        with self._lock:
            self._auto_resume_locked()
            if not self._paused:
                return None
            if not self._until:
                return None
            remaining = int((self._until - self._now()).total_seconds())
            return max(remaining, 0)

    def snapshot(self) -> PauseSnapshot:
        with self._lock:
            self._auto_resume_locked()
            return self.snapshot_locked()

    def snapshot_locked(self) -> PauseSnapshot:
        return PauseSnapshot(
            paused=self._paused,
            until=self._until,
            paused_by=self._paused_by,
            started_at=self._start_time,
        )




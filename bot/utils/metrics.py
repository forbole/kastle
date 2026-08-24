"""In-memory metrics collector used by admin commands and telemetry."""

from __future__ import annotations

import time
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from datetime import datetime
from threading import Lock
from typing import Deque, Dict, Mapping, Optional


@dataclass(frozen=True)
class MetricsSnapshot:
    """Lightweight serialisable view of the collected metrics."""

    counters: Mapping[str, int]
    command_counters: Mapping[str, int]
    latency_avg_ms: float
    latency_samples: int
    uptime_seconds: int
    pause_active: bool
    pause_until: Optional[datetime]


class Metrics:
    """Thread-safe metrics accumulator for bot activity."""

    _FALLBACK_WINDOW_SECONDS = 5 * 60

    def __init__(self) -> None:
        self._lock = Lock()
        self._start_time = time.time()
        self._counters: Counter[str] = Counter()
        self._command_counters: Counter[str] = Counter()
        self._latency_sum_ms = 0.0
        self._latency_count = 0
        self._pause_active = False
        self._pause_until: Optional[datetime] = None
        self._fallback_events: Dict[int, Deque[float]] = defaultdict(deque)

    # ------------------------------------------------------------------ counters
    def incr(self, key: str) -> None:
        with self._lock:
            self._counters[key] += 1

    def incr_command(self, name: str) -> None:
        with self._lock:
            self._command_counters[name] += 1

    def record_latency(self, latency_ms: float) -> None:
        with self._lock:
            self._latency_sum_ms += max(latency_ms, 0.0)
            self._latency_count += 1

    def record_answer(self, latency_ms: float, fallback: bool) -> None:
        with self._lock:
            self._counters["answers_total"] += 1
            if fallback:
                self._counters["fallback_total"] += 1
            if latency_ms >= 0:
                self._latency_sum_ms += latency_ms
                self._latency_count += 1

    def record_pause_state(self, active: bool, until: Optional[datetime]) -> None:
        with self._lock:
            if active and not self._pause_active:
                self._counters["pause_total"] += 1
            self._pause_active = active
            self._pause_until = until

    # ---------------------------------------------------------- fallback tracking
    def register_fallback_event(self, user_id: Optional[int]) -> bool:
        if user_id is None:
            return False

        now = time.time()
        cutoff = now - self._FALLBACK_WINDOW_SECONDS
        with self._lock:
            # ponytail: full sweep is O(users); bucket by time if user count ever grows.
            for stale_id in [uid for uid, ev in self._fallback_events.items() if uid != user_id]:
                events = self._fallback_events[stale_id]
                while events and events[0] < cutoff:
                    events.popleft()
                if not events:
                    self._fallback_events.pop(stale_id, None)

            queue = self._fallback_events[user_id]
            while queue and queue[0] < cutoff:
                queue.popleft()
            queue.append(now)
            return len(queue) >= 2

    # ------------------------------------------------------------------ snapshots
    def snapshot(self) -> MetricsSnapshot:
        with self._lock:
            latency_avg = (
                self._latency_sum_ms / self._latency_count if self._latency_count else 0.0
            )
            return MetricsSnapshot(
                counters=dict(self._counters),
                command_counters=dict(self._command_counters),
                latency_avg_ms=round(latency_avg, 2),
                latency_samples=self._latency_count,
                uptime_seconds=int(time.time() - self._start_time),
                pause_active=self._pause_active,
                pause_until=self._pause_until,
            )




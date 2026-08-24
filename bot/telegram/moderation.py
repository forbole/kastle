"""Optional moderation stub to gate incoming messages."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class ModerationDecision:
    blocked: bool
    reason: Optional[str] = None
    message: Optional[str] = None


def moderation_enabled() -> bool:
    raw = os.getenv("ENABLE_MODERATION", "false")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def check_message(_: str) -> ModerationDecision:
    """Placeholder moderation implementation.

    When moderation integration is enabled this function can be extended to call
    the provider configured via ``MODERATION_PROVIDER``. For now it returns a
    permissive decision so behaviour remains unchanged by default.
    """

    return ModerationDecision(blocked=False)




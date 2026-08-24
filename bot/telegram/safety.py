"""Safety filters applied to incoming user messages."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from bot.pipeline.qa import FALLBACK_MENTION
from bot.utils.metrics import Metrics

INJECTION_PATTERNS = [
    re.compile(r"\bignore (all )?(previous|above) (instructions|rules)\b", re.I),
    re.compile(r"\boverride\b.*\brules?\b", re.I),
    re.compile(r"\breveal\b.*\bsystem prompt\b", re.I),
    re.compile(r"\bdisregard\b.*\bguidelines?\b", re.I),
]

PII_PATTERNS = [
    re.compile(r"\b(?:seed|secret) (?:phrase|words)\b", re.I),
    re.compile(r"\bprivate key\b", re.I),
    re.compile(r"\b(?:recovery|backup) phrase\b", re.I),
    re.compile(r"\bmnemonic\b", re.I),
    re.compile(r"(?:\b[a-z]{3,}\b[\s,;:]){11,}\b[a-z]{3,}\b", re.I),
]

MAX_MESSAGE_LENGTH = 4096


@dataclass(frozen=True)
class SafetyDecision:
    text: str
    blocked: bool
    response: Optional[str]
    event: Optional[str]
    reason: Optional[str]
    fallback: bool = False


def _strip_control_characters(value: str) -> str:
    return "".join(ch for ch in value if ch.isprintable() or ch in {"\n", "\r", "\t"})


def apply_safety_checks(message: str, metrics: Metrics) -> SafetyDecision:
    """Run prompt-injection and PII heuristics on ``message``."""

    if not message:
        return SafetyDecision(text="", blocked=True, response=None, event=None, reason=None)

    cleaned = _strip_control_characters(message)[:MAX_MESSAGE_LENGTH].strip()
    lowered = cleaned.lower()

    for pattern in INJECTION_PATTERNS:
        if pattern.search(lowered):
            metrics.incr("injections_total")
            warning = (
                "I can't help with that request. "
                f"I'm looping in {FALLBACK_MENTION} so they can review it."
            )
            return SafetyDecision(
                text="",
                blocked=True,
                response=warning,
                event="injection_detected",
                reason="prompt_injection",
                fallback=True,
            )

    for pattern in PII_PATTERNS:
        if pattern.search(lowered):
            metrics.incr("pii_blocks_total")
            response = (
                "For your security, never share recovery phrases or private keys. "
                "Please contact official Kastle support channels if you need help."
            )
            return SafetyDecision(
                text="",
                blocked=True,
                response=response,
                event="pii_blocked",
                reason="pii_detected",
                fallback=False,
            )

    return SafetyDecision(text=cleaned, blocked=False, response=None, event=None, reason=None)




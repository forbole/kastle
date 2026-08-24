"""Helper utilities for evaluating authorisation and admin status.

This module centralises guard checks so that handlers can consistently
determine whether a chat is allowed to interact with the bot and whether a
specific user has administrative privileges.
"""

from __future__ import annotations

from typing import Optional

from telegram import Update

from bot.telegram.auth import AuthConfig


def _normalise_username(username: Optional[str]) -> Optional[str]:
    if not username:
        return None
    if username.startswith("@"):
        return username.lower()
    return f"@{username.lower()}"


def is_admin(update: Update, auth: AuthConfig) -> bool:
    """Return ``True`` if the update is sent by a configured admin."""

    user = update.effective_user
    user_id = user.id if user else None
    username = _normalise_username(user.username if user else None)
    return auth.is_admin(user_id, username)


def is_allowed_chat(update: Update, auth: AuthConfig) -> bool:
    """Return ``True`` when the chat is permitted to use the bot."""

    chat = update.effective_chat
    chat_id = chat.id if chat else None
    return auth.is_chat_allowed(chat_id)


def admin_identifier(update: Update) -> str:
    """Return a human friendly identifier for logging/admin responses."""

    user = update.effective_user
    if not user:
        return "unknown"
    if user.username:
        return _normalise_username(user.username) or str(user.id)
    return str(user.id)




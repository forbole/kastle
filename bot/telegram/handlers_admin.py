"""Admin-only command handlers."""

from __future__ import annotations

import os
import re
from datetime import timezone
from typing import Iterable, Optional

from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

from bot.pipeline import qa
from bot.telegram.formatting import DEFAULT_PARSE_MODE, format_plain_text
from bot.telegram.handlers import HandlerDependencies
from bot.utils.guards import admin_identifier, is_admin
from bot.utils.teachings import (
    add_teaching,
    delete_teaching,
    list_teachings,
)


DURATION_PATTERN = re.compile(r"^(?P<value>\d+)(?P<unit>[smhd]?)$")

ADMIN_COMMANDS = {
    "help_admin": "Show this help message.",
    "ping": "Health check with uptime.",
    "stats": "Display metrics counters and latency averages.",
    "mode": "Show current configuration.",
    "set_threshold": "Update confidence threshold (0.0-1.0).",
    "stop": "Pause the bot (/stop 5m, /stop 2h).",
    "resume": "Resume immediately.",
    "teach": "Reply to a question with /teach [override|append] <answer> to store an override.",
    "teach_list": "List stored overrides (teachings).",
    "teach_delete": "Delete an override by id or pattern snippet.",
}


def register_admin_handlers(application: Application, deps: HandlerDependencies) -> None:
    application.bot_data["deps"] = deps
    application.add_handler(CommandHandler("help_admin", _command_help_admin))
    application.add_handler(CommandHandler("ping", _command_ping))
    application.add_handler(CommandHandler("stats", _command_stats))
    application.add_handler(CommandHandler("mode", _command_mode))
    application.add_handler(CommandHandler("set_threshold", _command_set_threshold))
    application.add_handler(CommandHandler("stop", _command_stop))
    application.add_handler(CommandHandler("resume", _command_resume))
    application.add_handler(CommandHandler("teach", _command_teach))
    application.add_handler(CommandHandler("teach_list", _command_teach_list))
    application.add_handler(CommandHandler("teach_delete", _command_teach_delete))


async def _require_admin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> Optional[HandlerDependencies]:
    deps = context.application.bot_data.get("deps")
    if not isinstance(deps, HandlerDependencies):
        raise RuntimeError("Handler dependencies not initialised on application")
    if not is_admin(update, deps.auth):
        if update.message:
            await update.message.reply_text(
                format_plain_text("You're not authorised to use this command."),
                parse_mode=DEFAULT_PARSE_MODE,
                disable_web_page_preview=True,
            )
        return None
    return deps


async def _command_help_admin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    deps = await _require_admin(update, context)
    if not deps or not update.message:
        return

    deps.metrics.incr_command("help_admin")
    lines = ["Admin commands:"]
    for command, description in ADMIN_COMMANDS.items():
        lines.append(f"/{command} – {description}")
    await update.message.reply_text(
        format_plain_text("\n".join(lines)),
        parse_mode=DEFAULT_PARSE_MODE,
        disable_web_page_preview=True,
    )


async def _command_ping(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    deps = await _require_admin(update, context)
    if not deps or not update.message:
        return

    deps.metrics.incr_command("ping")
    uptime = deps.metrics.snapshot().uptime_seconds
    await update.message.reply_text(
        format_plain_text(f"Pong! Uptime: {uptime} seconds."),
        parse_mode=DEFAULT_PARSE_MODE,
        disable_web_page_preview=True,
    )


async def _command_stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    deps = await _require_admin(update, context)
    if not deps or not update.message:
        return

    deps.metrics.incr_command("stats")
    snapshot = deps.metrics.snapshot()
    counters = "\n".join(f"{key}: {value}" for key, value in sorted(snapshot.counters.items()))
    command_counts = "\n".join(
        f"{key}: {value}" for key, value in sorted(snapshot.command_counters.items())
    )

    pause_summary = (
        "active" if snapshot.pause_active else "inactive"
    )
    if snapshot.pause_until:
        pause_summary = f"{pause_summary} until {snapshot.pause_until.astimezone(timezone.utc).isoformat()}"

    lines = [
        "Metrics snapshot:",
        counters or "(no counters yet)",
        "",
        "Command counters:",
        command_counts or "(no admin commands yet)",
        "",
        f"Average latency: {snapshot.latency_avg_ms} ms ({snapshot.latency_samples} samples)",
        f"Uptime: {snapshot.uptime_seconds} seconds",
        f"Pause state: {pause_summary}",
    ]
    await update.message.reply_text(
        format_plain_text("\n".join(lines)),
        parse_mode=DEFAULT_PARSE_MODE,
        disable_web_page_preview=True,
    )


async def _command_mode(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    deps = await _require_admin(update, context)
    if not deps or not update.message:
        return

    deps.metrics.incr_command("mode")
    pause_snapshot = deps.pause_state.snapshot()
    conf_threshold = qa.get_conf_threshold()
    lines = [
        "Current mode configuration:",
        f"Chat provider: {os.getenv('CHAT_PROVIDER', 'openai')}",
        f"Embedding provider: {os.getenv('EMBED_PROVIDER', 'openai')}",
        f"Model: {os.getenv('OPENAI_CHAT_MODEL', 'gpt-4o-mini')}",
        f"RAG_TOP_K: {os.getenv('RAG_TOP_K', qa.RAG_TOP_K)}",
        f"CONF_THRESHOLD: {conf_threshold:.2f}",
        f"Paused: {'yes' if pause_snapshot.paused else 'no'}",
    ]
    if pause_snapshot.until:
        lines.append(f"Pause until: {pause_snapshot.until.astimezone(timezone.utc).isoformat()}")
    if pause_snapshot.paused_by:
        lines.append(f"Paused by: {pause_snapshot.paused_by}")
    await update.message.reply_text(
        format_plain_text("\n".join(lines)),
        parse_mode=DEFAULT_PARSE_MODE,
        disable_web_page_preview=True,
    )


async def _command_set_threshold(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    deps = await _require_admin(update, context)
    if not deps or not update.message:
        return

    deps.metrics.incr_command("set_threshold")
    if not context.args:
        await update.message.reply_text(
            format_plain_text("Usage: /set_threshold <value between 0 and 1>."),
            parse_mode=DEFAULT_PARSE_MODE,
            disable_web_page_preview=True,
        )
        return

    raw_value = context.args[0]
    try:
        value = float(raw_value)
    except ValueError:
        await update.message.reply_text(
            format_plain_text("Threshold must be a number between 0 and 1."),
            parse_mode=DEFAULT_PARSE_MODE,
            disable_web_page_preview=True,
        )
        return

    if not 0.0 <= value <= 1.0:
        await update.message.reply_text(
            format_plain_text("Threshold must be within the [0, 1] range."),
            parse_mode=DEFAULT_PARSE_MODE,
            disable_web_page_preview=True,
        )
        return

    qa.set_conf_threshold(value)
    await update.message.reply_text(
        format_plain_text(f"Updated confidence threshold to {value:.2f}."),
        parse_mode=DEFAULT_PARSE_MODE,
        disable_web_page_preview=True,
    )


async def _command_stop(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    deps = await _require_admin(update, context)
    if not deps or not update.message:
        return

    deps.metrics.incr_command("stop")
    duration_arg = context.args[0] if context.args else None
    if duration_arg and duration_arg.lower() in {"0", "cancel"}:
        snapshot = deps.pause_state.resume(actor=admin_identifier(update))
        deps.metrics.record_pause_state(snapshot.paused, snapshot.until)
        await update.message.reply_text(
            format_plain_text("Bot resumed."),
            parse_mode=DEFAULT_PARSE_MODE,
            disable_web_page_preview=True,
        )
        return

    seconds = _parse_duration(duration_arg, deps.pause_state.default_duration)
    snapshot = deps.pause_state.pause(duration=seconds, actor=admin_identifier(update))
    deps.metrics.record_pause_state(snapshot.paused, snapshot.until)

    if not snapshot.paused:
        await update.message.reply_text(
            format_plain_text("Bot not paused (duration resolved to zero)."),
            parse_mode=DEFAULT_PARSE_MODE,
            disable_web_page_preview=True,
        )
        return

    human_readable = _describe_duration(seconds)
    until = (
        snapshot.until.astimezone(timezone.utc).isoformat() if snapshot.until else "indefinite"
    )
    await update.message.reply_text(
        format_plain_text(f"Bot paused for {human_readable}. Resume scheduled at {until}."),
        parse_mode=DEFAULT_PARSE_MODE,
        disable_web_page_preview=True,
    )


async def _command_resume(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    deps = await _require_admin(update, context)
    if not deps or not update.message:
        return

    deps.metrics.incr_command("resume")
    deps.telemetry.log_event("admin_command", update, name="resume")
    snapshot = deps.pause_state.resume(actor=admin_identifier(update))
    deps.metrics.record_pause_state(snapshot.paused, snapshot.until)
    deps.telemetry.log_event("admin_resume", update)
    await update.message.reply_text(
        format_plain_text("Bot resumed."),
        parse_mode=DEFAULT_PARSE_MODE,
        disable_web_page_preview=True,
    )


async def _command_teach(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    deps = await _require_admin(update, context)
    if not deps or not update.message:
        return

    deps.metrics.incr_command("teach")
    deps.telemetry.log_event("admin_command", update, name="teach")

    reply = update.message.reply_to_message
    if not reply or not (reply.text or reply.caption):
        await update.message.reply_text(
            format_plain_text(
                "Reply to a user's question with /teach [override|append] <answer>."
            ),
            parse_mode=DEFAULT_PARSE_MODE,
            disable_web_page_preview=True,
        )
        return

    args = list(context.args)
    if not args:
        await update.message.reply_text(
            format_plain_text("Provide an answer after the command."),
            parse_mode=DEFAULT_PARSE_MODE,
            disable_web_page_preview=True,
        )
        return

    context_type = "override"
    first = args[0].lower()
    if first in {"override", "append"}:
        context_type = first
        args = args[1:]

    answer_text = " ".join(args).strip()
    if not answer_text:
        await update.message.reply_text(
            format_plain_text("Teachings require a non-empty answer."),
            parse_mode=DEFAULT_PARSE_MODE,
            disable_web_page_preview=True,
        )
        return

    pattern = (reply.text or reply.caption or "").strip()
    try:
        entry = add_teaching(
            pattern=pattern,
            answer=answer_text,
            context_type=context_type,
            created_by=admin_identifier(update),
        )
    except ValueError as exc:
        await update.message.reply_text(
            format_plain_text(str(exc)),
            parse_mode=DEFAULT_PARSE_MODE,
            disable_web_page_preview=True,
        )
        return

    deps.telemetry.log_event(
        "teaching_added",
        update,
        pattern=pattern[:120],
        context_type=context_type,
        teaching_id=entry.id,
    )
    await update.message.reply_text(
        format_plain_text(
            f"Saved teaching {entry.id} (pattern: {pattern[:60]!r}, context: {context_type})."
        ),
        parse_mode=DEFAULT_PARSE_MODE,
        disable_web_page_preview=True,
    )


async def _command_teach_list(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    deps = await _require_admin(update, context)
    if not deps or not update.message:
        return

    deps.metrics.incr_command("teach_list")
    deps.telemetry.log_event("admin_command", update, name="teach_list")

    entries = list_teachings()
    if not entries:
        await update.message.reply_text(
            format_plain_text("No teachings stored."),
            parse_mode=DEFAULT_PARSE_MODE,
            disable_web_page_preview=True,
        )
        return

    lines = ["Teachings:"]
    for entry in entries:
        lines.append(
            f"- {entry.get('id')} | pattern: {entry.get('pattern', '')[:40]!r} | "
            f"context: {entry.get('context_type', 'override')} | created_by: {entry.get('created_by', '')}"
        )

    await update.message.reply_text(
        format_plain_text("\n".join(lines)),
        parse_mode=DEFAULT_PARSE_MODE,
        disable_web_page_preview=True,
    )


async def _command_teach_delete(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    deps = await _require_admin(update, context)
    if not deps or not update.message:
        return

    deps.metrics.incr_command("teach_delete")
    deps.telemetry.log_event("admin_command", update, name="teach_delete")

    if not context.args:
        await update.message.reply_text(
            format_plain_text("Usage: /teach_delete <teaching id or pattern snippet>."),
            parse_mode=DEFAULT_PARSE_MODE,
            disable_web_page_preview=True,
        )
        return

    identifier = " ".join(context.args)
    removed = delete_teaching(identifier)
    if removed:
        deps.telemetry.log_event("teaching_removed", update, identifier=identifier)
        await update.message.reply_text(
            format_plain_text(f"Removed teachings matching {identifier!r}."),
            parse_mode=DEFAULT_PARSE_MODE,
            disable_web_page_preview=True,
        )
    else:
        await update.message.reply_text(
            format_plain_text("No teachings matched that identifier."),
            parse_mode=DEFAULT_PARSE_MODE,
            disable_web_page_preview=True,
        )


def _parse_duration(arg: Optional[str], default_seconds: int) -> Optional[int]:
    if not arg:
        return default_seconds

    match = DURATION_PATTERN.match(arg)
    if not match:
        return default_seconds

    value = int(match.group("value"))
    unit = match.group("unit") or "s"
    multiplier = {"s": 1, "m": 60, "h": 3600, "d": 86400}.get(unit, 1)
    return value * multiplier


def _describe_duration(seconds: Optional[int]) -> str:
    if seconds is None or seconds <= 0:
        return "0 seconds"

    parts: Iterable[str] = []
    remaining = seconds
    days, remaining = divmod(remaining, 86400)
    hours, remaining = divmod(remaining, 3600)
    minutes, remaining = divmod(remaining, 60)

    items = []
    if days:
        items.append(f"{days}d")
    if hours:
        items.append(f"{hours}h")
    if minutes:
        items.append(f"{minutes}m")
    if remaining or not items:
        items.append(f"{remaining}s")

    return " ".join(items)




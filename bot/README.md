# Telegram bot

Admin-only command surface for the support bot. All commands require the caller
to be listed as an admin; unauthorised callers get a refusal.

| Command | Description |
| --- | --- |
| `/help_admin` | Show the admin command list. |
| `/ping` | Health check with uptime. |
| `/stats` | Display metrics counters and latency averages. |
| `/mode` | Show current configuration. |
| `/set_threshold <0..1>` | Adjust in-memory confidence threshold until restart. |
| `/stop [duration]` | Pause bot for `10s`, `5m`, `2h`, `1d`, or default duration. Use `0`/`cancel` to resume immediately. |
| `/resume` | Resume the bot immediately. |
| `/teach [override\|append] <answer>` | Reply to a user's question with this command to store an override. |
| `/teach_list` | List the overrides (teachings) currently stored. |
| `/teach_delete <id or pattern>` | Remove stored overrides by id or pattern snippet. Pattern snippets must be at least 4 characters. |

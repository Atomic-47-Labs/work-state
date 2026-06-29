# JSONL fields — read vs. ignore

This document records exactly which fields in Claude Code's JSONL transcripts the harvester reads, and which it deliberately ignores. It exists because the JSONL format has known data-quality issues that have tripped up other tools.

## Source paths

- **Per-session transcripts:** `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`
- **Global prompt index:** `~/.claude/history.jsonl` (one line per prompt across all projects)
- **Per-project index:** `~/.claude/projects/<encoded-cwd>/sessions-index.json` (session summaries, message counts, branch, timestamps)

The harvester reads the per-session JSONLs as primary source and the per-project `sessions-index.json` as a metadata accelerator. `history.jsonl` is currently unused (its content is reachable via per-session files) but could be used in the future for cross-project prompt clustering.

## JSONL line schema (per session file)

Each line is a JSON object. Top-level fields:

| Field          | Type    | Read? | Use                                          |
| -------------- | ------- | ----- | -------------------------------------------- |
| `type`         | string  | yes   | `"user"`, `"assistant"`, plus lifecycle types (compaction boundaries, summary insertions, hook output, snapshots, team/subagent coordination — these vary by version) |
| `uuid`         | string  | no    | not needed for aggregation                   |
| `parentUuid`   | string  | no    | threading; not surfaced in events            |
| `timestamp`    | string  | yes   | event timestamps, burst windows, durations   |
| `sessionId`    | string  | yes   | the canonical id for the session             |
| `cwd`          | string  | yes   | project attribution                          |
| `gitBranch`    | string  | yes   | recorded in evidence                         |
| `version`      | string  | yes   | Claude Code version at time of session       |

## `message.content` block types

Each `message.content` is an array of blocks. Block types observed:

| Block type    | Read?   | Use                                                          |
| ------------- | ------- | ------------------------------------------------------------ |
| `text`        | yes     | counted as part of `assistant_turns` or `user_turns`; text body only captured if `capture_prompts: true` |
| `thinking`    | no      | extended-thinking content; not aggregated                    |
| `tool_use`    | yes     | the primary signal — name, id, input. Drives `tool_calls`, `files_touched`, `bash_commands_count`, `subagent_invocations`, and burst detection |
| `tool_result` | partial | id matched to its `tool_use` to confirm completion; result content not stored |

### Mapping `tool_use` blocks to per-tool counters

For each `tool_use` block in an assistant message, increment `tool_calls[block.name]`. The harvester groups tool names as they appear; unknown names are bucketed under `tool_calls["<other>"]` until added to the known set.

Known tool names (as of harvester v1.0.0):
- `Read`, `Edit`, `Write`, `MultiEdit`, `Bash`, `Grep`, `Glob`, `Task`, `WebFetch`, `WebSearch`, `NotebookEdit`, `TodoWrite`

### Extracting file paths

`files_touched` accumulates the `file_path` argument from `tool_use.input` for these tool names:
- `Read` (input.file_path)
- `Edit` (input.file_path)
- `Write` (input.file_path)
- `MultiEdit` (input.file_path)
- `NotebookEdit` (input.notebook_path)

Deduplicate before writing to the event.

## `message.usage` fields — what we read

| Field                            | Read? | Reliable? | Notes                                |
| -------------------------------- | ----- | --------- | ------------------------------------ |
| `input_tokens`                   | **NO**| **NO**    | Streaming placeholder; 75% of entries are 0 or 1. Undercounts by 100-174x. |
| `output_tokens`                  | **NO**| **NO**    | Excludes thinking tokens; undercounts by 10-17x. |
| `cache_creation_input_tokens`    | yes   | yes       | Accurate. Sum across the session.    |
| `cache_read_input_tokens`        | yes   | yes       | Accurate. Sum across the session.    |

**Hard rule:** the harvester never reads `input_tokens` or `output_tokens` from JSONL. They exist in the data; we route past them. The Admin API `cost` event is the source of truth for tokens and cost.

This is the single most important data-quality decision in this harvester. Any future field added to `message.usage` should be treated as suspect until validated against the API.

## `sessions-index.json` (per-project)

This file is maintained by Claude Code itself and is more efficient to read than re-deriving the same metadata from the JSONL. Fields used:

| Field           | Use                                          |
| --------------- | -------------------------------------------- |
| `summary`       | Stamped into `evidence.summary` if present.  |
| `messageCount`  | Cross-check against derived `user_turns + assistant_turns`. Mismatch is logged but not fatal. |
| `gitBranch`     | Cross-check against per-line `gitBranch`. The per-line value wins (it's snapshotted at the time of the message, not the index update). |
| `createdAt`     | Cross-check against derived `started_at`.    |
| `modifiedAt`    | Cross-check against derived `ended_at`.      |

If `sessions-index.json` is missing or stale, the harvester proceeds with values derived from the JSONL.

## Lifecycle events we observe but do not surface (yet)

These appear in the JSONL stream but are not yet aggregated into work-state events:

- **Compaction boundaries** — when Claude Code compacts context. Could be valuable as a "this session got long" signal.
- **Summary insertions** — auto-generated summaries inserted into context.
- **Hook output** — output from Claude Code hooks.
- **File snapshots** — snapshots taken for the session.
- **Team/subagent coordination** — events emitted by `Task` tool delegation.

Future versions could surface compaction events as their own event type, or include compaction counts in the build event's metrics. For v1, the count of `Task` tool calls (`subagent_invocations`) is the only subagent signal recorded.

## Version drift

The exact set of `type` values and content block shapes evolves with Claude Code releases. The harvester is defensive:

- Unknown `type` values are skipped silently (not logged as errors).
- Unknown content block types within a known message type are skipped.
- Unknown tool names are bucketed into `tool_calls["<other>"]` with a one-time-per-session log line so we know to add them.

Strategy: tolerate forward-compat drift, log it once, never fail a harvest because the schema changed.

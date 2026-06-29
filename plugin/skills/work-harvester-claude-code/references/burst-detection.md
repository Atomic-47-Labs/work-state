# Tool-burst detection

A `tool-burst` is a window inside a session where tool calls fire densely enough to constitute a recognisable unit of work — an edit storm, a Bash sequence, a Grep-and-Edit refactor pass, a Task delegation cascade.

The goal is to expose the *texture* of a session without flooding the timeline with one event per tool call.

## Definition

A burst is a contiguous sequence of `tool_use` blocks within a single session such that:

1. At least `burst_threshold_calls` calls (default: 10)
2. Span at most `burst_threshold_minutes` minutes (default: 5)
3. Are followed by an idle gap of at least `burst_idle_gap_seconds` (default: 60) — which is what closes the burst

These thresholds are tunable in `manifest.yaml:surfaces.claude-code.*`.

## Algorithm (sliding window with idle-gap closure)

```python
def detect_bursts(tool_use_timestamps, threshold_calls, threshold_minutes, idle_gap):
    """
    tool_use_timestamps: list of (ts, tool_name, tool_input) tuples, sorted by ts
    Returns: list of burst dicts
    """
    if len(tool_use_timestamps) < threshold_calls:
        return []

    bursts = []
    burst_start = None
    burst_calls = []
    last_ts = None
    burst_index = 0
    threshold_seconds = threshold_minutes * 60

    for i, (ts, tool_name, tool_input) in enumerate(tool_use_timestamps):
        if burst_start is None:
            # Look forward: does the next `threshold_calls` worth of calls fit in `threshold_seconds`?
            window = tool_use_timestamps[i : i + threshold_calls]
            if len(window) == threshold_calls and (window[-1][0] - window[0][0]) <= threshold_seconds:
                burst_start = ts
                burst_calls = [tool_use_timestamps[i]]
                last_ts = ts
        else:
            gap = (ts - last_ts).total_seconds()
            if gap >= idle_gap:
                # Burst closes
                if len(burst_calls) >= threshold_calls:
                    bursts.append({
                        "index": burst_index,
                        "start": burst_start,
                        "end": last_ts,
                        "calls": burst_calls,
                        "preceding_idle_seconds": _gap_before_burst(burst_start, bursts, tool_use_timestamps),
                    })
                    burst_index += 1
                burst_start = None
                burst_calls = []
                last_ts = None
                # Reconsider current ts as a possible burst start
                # (the for loop will handle it on the next iteration via the if burst_start is None branch)
            else:
                burst_calls.append(tool_use_timestamps[i])
                last_ts = ts

    # Close final burst if still open at EOF
    if burst_start is not None and len(burst_calls) >= threshold_calls:
        bursts.append({
            "index": burst_index,
            "start": burst_start,
            "end": last_ts,
            "calls": burst_calls,
            "preceding_idle_seconds": _gap_before_burst(burst_start, bursts, tool_use_timestamps),
        })

    return bursts
```

## Edge cases

**Single mega-burst spanning the whole session.** A session of solid tool calls with no idle gaps produces one burst spanning the entire session. This is correct — the burst event captures the same window as the build event, but with the burst-specific shape (dominant tool, intensity, files touched in that window). Downstream consumers can choose to skip burst events that overlap their parent build event > 95%.

**Calls that exceed threshold but never get an idle gap (running session).** When the JSONL ends without an idle gap (still-in-progress session), the harvester treats EOF as a closing condition only if the burst already meets the call-count threshold. Otherwise the partial burst is dropped — it will appear on the next harvest once more activity (or session end) gives it a clean boundary.

**Tool calls inside a Task subagent invocation.** Subagent tool calls do NOT appear in the parent session's JSONL — they're recorded in the subagent's own context. The parent session sees only one `Task` tool_use block (counted as one call), and the subagent's burst activity would be invisible to this harvester even if it had access. This is a known limitation; if subagent-level instrumentation matters, that's an OTel-based harvester job, not JSONL.

**Multi-day sessions.** A session left open across midnight is treated as one session with timestamps crossing the date boundary. The build event uses `started_at` for both `timestamp` and date partition in the id, so it lands in the earlier day's events directory. Burst events likewise use their own `burst_start`, which means bursts late in the session can land in a later day's directory than the parent build event. This is intentional — bursts are independent records.

## Determinism

The same JSONL file produces the same set of bursts, in the same order, with the same `burst_index` values. This is what makes the deterministic id scheme work:

```
claude-code-tool-burst-{YYYY-MM-DD}-{session_id[:8]}-{burst_index}
```

A re-harvest produces the same ids and `work-state log-event` returns `{status: "duplicate"}` for all of them.

The one case where re-harvesting *changes* burst output: a session that was in-progress at first harvest (no closing idle gap) and is now finished. On the second harvest, the trailing activity may have closed differently, producing new bursts or merging existing ones. Because of this, in-progress sessions can have their burst events superseded — see the SKILL.md `Idempotency proof` section for how this is handled.

## Why these defaults

| Default                       | Reasoning                                                                |
| ----------------------------- | ------------------------------------------------------------------------ |
| `burst_threshold_calls: 10`   | Below 10, you're in conversational territory or sparse tool use. 10+ feels like deliberate activity. |
| `burst_threshold_minutes: 5`  | Captures sustained pushes without splitting them on micro-pauses. 5 min is a typical attention window. |
| `burst_idle_gap_seconds: 60`  | 60s of no tool calls usually means the assistant is thinking, the user is reading, or the user stepped away. Closes a burst cleanly. |

Tune these in `manifest.yaml`; the harvester re-reads them each run.

## A worked example

Session timeline (tool_use timestamps only):

```
14:22:07  Read
14:22:11  Read
14:22:14  Read
14:22:18  Grep
14:22:24  Read
14:22:31  Read
14:22:38  Edit
14:22:47  Edit
14:22:58  Edit
14:23:12  Edit
14:23:26  Edit          ← 11 calls in 79s. burst_start = 14:22:07.
14:23:40  Bash
14:23:51  Bash
14:24:02  Bash          ← still building burst 0.
[…]
14:24:50  (last call in burst)
14:26:30  (gap of 100s closes burst 0. recorded: 22 calls, start 14:22:07, end 14:24:50, intensity 13.4/min)

14:35:10  Read          ← fresh activity but only 4 calls in next 5 min — no burst.
14:36:22  Edit
14:37:01  Read
14:38:44  Edit
[long quiet stretch]

15:31:18  Read
15:31:21  Read
15:31:25  Edit
[…]
15:34:02  (40 calls in 164s — burst 1.)
```

Two bursts emitted for this session: index 0 and index 1.

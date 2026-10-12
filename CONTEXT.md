# Herdr Rich Presence

A companion that represents the user's current Herdr activity through Discord Rich Presence.

## Language

**Companion**:
The background presence publisher that waits for Herdr and represents its activity on Discord.
_Avoid_: Script, RPC

**Focused Workspace**:
The workspace identified as focused by the default local Herdr server snapshot and represented as the user's present location. It may differ from a client-specific or remote-machine selection. Its exact label is hidden only when it is a Private Workspace.
_Avoid_: Space, project

**Shared Workspace**:
A workspace published by its exact label because its label does not match a Private Pattern.
_Avoid_: Allowed workspace, public project

**Private Workspace**:
A workspace whose label matches a Private Pattern and is therefore represented by generic text.
_Avoid_: Blocked workspace, private fallback

**Private Pattern**:
An exact label or simple glob pattern matched case-insensitively to prevent workspace labels from being published.
_Avoid_: Denylist entry, exclusion rule

**Detected Agent**:
A live coding agent recognized by Herdr, regardless of whether it is working, idle, or blocked.
_Avoid_: Running agent

**Working Agent**:
A detected agent whose current Herdr state is `working`.
_Avoid_: Active agent, running agent

**Presence**:
The Discord Rich Presence entry containing the Focused Workspace and the counts of Working and Detected Agents across the default local Herdr session.
_Avoid_: Status, RPC status

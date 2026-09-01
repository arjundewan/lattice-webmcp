---
name: lattice
description: Review the current Lattice architecture board from its comments, or create a new diagram from an explicit goal.
metadata:
  short-description: Review or create a Lattice board
---

# Lattice

Use this skill only when the user explicitly invokes `/lattice` (or `$lattice`).

The open Lattice board is the shared context. Do not ask the user to describe
the board again, and do not tell them which WebMCP tool to call.

The hosted Lattice app is:

```text
https://lattice-webmcp.vercel.app
```

Use the host's browser/navigation capability to open this URL when needed. The
page must be open in a WebMCP-capable browser before using the tools below. If
the host cannot navigate to a browser page or expose WebMCP tools, explain that
limitation instead of pretending the board was opened or changed.

## Invocation modes

### Bare `/lattice`

Treat the invocation as: “Read the current board and handle the annotations I
left there.” Comments are general work items, not necessarily change requests.
They may contain:

- a requested diagram change;
- a question about the diagram;
- an observation, concern, or request for explanation; or
- an ambiguous mixture of these.

Stay on the currently open Lattice document when one is available. If no
Lattice document is open, navigate to the hosted URL above and use the newly
created document; it will not contain prior annotations.

First call:

```json
get_diagram({ "scope": "all" })
```

Use the returned revision, nodes, edges, selection, and unresolved comments as
the source of truth. Then handle each relevant comment according to its intent:

- For a concrete requested change, apply the smallest targeted patch using the
  comment's captured semantic target and `targetCommentId`.
- For a question, answer from the current diagram state without mutating the
  board.
- For an observation or concern, explain what the current diagram shows and
  propose a change only when the user asked for one.
- If the intent is ambiguous, describe the ambiguity and ask one focused
  question rather than guessing.

Resolve a comment only after a successful target-scoped patch has addressed a
concrete requested change. Do not force-resolve questions or observations: the
current Lattice contract requires a successful target-scoped patch before
`resolve_comment` can be used.

Repeated bare invocations must be safe. Re-read the live board every time,
skip already-resolved work, use the current revision, and do not repeat a
previous patch merely because a comment remains open.

### `/lattice create ...`

Treat the text after `create` as a request to generate a new architecture
diagram. Navigate to the hosted root URL above before creating so this command
starts a fresh `/d/:id` document. Infer a useful title, typed nodes, and
directed edges from the goal, then call `create_diagram`:

```json
{
  "title": "...",
  "replaceExisting": true,
  "nodes": [
    { "id": "client", "label": "Client", "kind": "client" }
  ],
  "edges": []
}
```

If navigation to a fresh document is unavailable and the current document is
non-empty, do not silently replace it. Explain that the host could not open a
new board. The current tool replaces Lattice nodes and edges but preserves
ordinary tldraw objects and comments; it does not create a new `/d/:id`
document by itself. Do not claim that a separate document was created unless
the browser actually opened a new document URL.

Keep the generated diagram focused on the user's goal. Use stable semantic IDs,
avoid unnecessary nodes and edges, and respect the tool's input limits.

## WebMCP contract

Use the page-advertised Lattice tools directly. Do not substitute source
inspection, screenshots, or coordinate-based editing for the semantic tools.

- `get_diagram({ scope: "all" | "selection" | "comments" })` reads the live
  diagram, revision, selection, and unresolved comments.
- `create_diagram({ title?, replaceExisting?, nodes, edges? })` creates and lays
  out a typed diagram.
- `apply_diagram_patch({ expectedRevision, targetCommentId?, operations })`
  applies explicit node or edge operations. Supported operation types are
  `add_node`, `update_node`, `remove_node`, `add_edge`, `update_edge`, and
  `remove_edge`.
- `resolve_comment({ commentId, expectedRevision })` resolves one comment only
  after its target-scoped patch succeeds at the current revision.

For every mutation:

1. Read the current revision first.
2. Use semantic node and edge IDs from that result.
3. Keep the patch narrow and preserve unrelated positions and objects.
4. Pass `expectedRevision` to guard against stale state.
5. If a patch fails because the revision changed, re-read the board and
   recompute the patch instead of retrying stale arguments.

After a successful patch, resolve the corresponding comment with the revision
returned by the patch. Report what changed in plain language, including when a
comment was answered without changing the board.

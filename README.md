# Lattice

Lattice is a local-first architecture canvas where people edit visually and browser agents edit structurally in the same live workspace.

It is a focused entry for the [WebMCP Challenge](https://webmcp.devpost.com/): the user can move ordinary tldraw objects, attach a comment to selected elements or a freeform region, and ask an agent to address it. The agent reads exact semantic targets through WebMCP, applies a revision-guarded patch without replacing the rest of the canvas, and resolves the comment.

## Run locally

Lattice requires Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

The hosted app is available at [lattice-webmcp.vercel.app](https://lattice-webmcp.vercel.app).

Open the printed local URL in a WebMCP-capable browser. Each new session receives a stable `/d/:id` URL and persists in that browser's local storage.

Useful checks:

```bash
npm run typecheck
npm run build
```

## Lightweight agent skill

Lattice works best with the lightweight `/lattice` skill. It keeps the agent
workflow simple without requiring users to mention WebMCP tools:

- `/lattice` reads the current board and handles unresolved annotations as
  requests, questions, observations, or concerns.
- `/lattice create a new board to do XYZ` creates a typed architecture diagram
  from the supplied goal.

The skill is optional; any WebMCP-capable agent can use the page tools directly.
When starting from a new agent session, `/lattice create ...` opens the hosted
app before creating a fresh board, while bare `/lattice` uses the currently
open board.
The portable skill definition lives at [`skills/lattice/SKILL.md`](skills/lattice/SKILL.md).

## Demo the collaboration loop

### Direct WebMCP flow

1. In a WebMCP-capable browser, ask the agent: “Create a basic realtime collaboration architecture on this canvas.”
2. Move a node to show that the result is ordinary editable canvas content.
3. Select one or more elements, choose the comment tool, place the comment, and submit a request. Dragging instead captures a freeform region and the elements intersecting it.
4. Tell the agent: “I added a comment. Please address it.”
5. The agent reads the comment and its frozen target, applies a narrow patch, and resolves the thread. Unrelated shapes and positions remain unchanged.

### Lightweight skill flow

1. In a WebMCP-capable browser, invoke `/lattice create a basic realtime collaboration architecture`.
2. Move a node to show that the result is ordinary editable canvas content.
3. Select one or more elements, choose the comment tool, place the comment, and submit a request. Dragging instead captures a freeform region and the elements intersecting it.
4. Invoke `/lattice`.
5. The skill reads the comment and its frozen target, applies a narrow patch when appropriate, and resolves concrete change requests. Questions and observations are answered without mutating the board.

## WebMCP tools

The top-level page registers four narrow tools with `document.modelContext.registerTool`:

- `get_diagram` reads the current semantic graph, selection, revision, and unresolved comments.
- `create_diagram` creates and lays out a typed graph. With `replaceExisting: true`, it replaces Lattice diagram nodes and edges only; ordinary tldraw objects and comments are preserved.
- `apply_diagram_patch` applies explicit node and edge operations at an expected revision. When scoped to a comment, edits are restricted to that comment's captured element IDs.
- `resolve_comment` closes one comment only after a successful target-scoped patch addressed it at the expected current revision.

Tool schemas use bounded inputs, mutation annotations, stable semantic IDs, and deterministic JSON results. The implementation follows the challenge's linked [WebMCP specification](https://webmachinelearning.github.io/webmcp/), [OpenAI guide](https://learn.chatgpt.com/docs/webmcp), [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api), and [tool security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools).

## Product boundary

The first demo is intentionally architecture-focused: typed nodes, directed edges, and precise structural patches create a clear agent workflow. The canvas and comment target model remain generic enough for broader whiteboarding—native tldraw objects can still be selected, moved, connected, annotated, and grouped spatially.

Data stays in the current browser. There is no account, backend, analytics, or remote sync in this version.

## License

The project source is available under the [MIT License](LICENSE). tldraw and its commenting package are separately licensed dependencies; development use does not require a license key, while a public production deployment requires an [appropriate tldraw license](https://tldraw.dev/sdk-features/license-key).

import type { LatticeBridge } from '../lattice/bridge'
import type {
  ApplyDiagramPatchInput,
  CreateDiagramInput,
  DiagramScope,
  ResolveCommentInput,
} from '../lattice/types'
import {
  LATTICE_DIRECTIONS,
  LATTICE_ID_PATTERN,
  LATTICE_LIMITS,
  NODE_KINDS,
} from '../lattice/types'

const id = {
  type: 'string',
  minLength: 1,
  maxLength: LATTICE_LIMITS.id,
  pattern: LATTICE_ID_PATTERN,
}
const label = { type: 'string', minLength: 1, maxLength: LATTICE_LIMITS.label }
const nodeKind = { type: 'string', enum: NODE_KINDS }

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}

async function executeSafely(action: () => unknown | Promise<unknown>) {
  try {
    return await action()
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The Lattice tool failed.',
    }
  }
}

export function registerLatticeTools(getBridge: () => LatticeBridge | null) {
  const context = document.modelContext
  if (!context) return () => undefined

  const lifecycle = new AbortController()
  const executionSignal = (context?: { signal: AbortSignal }) =>
    context?.signal ?? lifecycle.signal
  const bridge = () => {
    if (lifecycle.signal.aborted) throw new DOMException('Tools were unregistered.', 'AbortError')
    const current = getBridge()
    if (!current) throw new Error('The Lattice canvas is not ready.')
    return current
  }

  const tools: WebMcpTool[] = [
    {
      name: 'get_diagram',
      title: 'Read the open diagram',
      description:
        'Read the live Lattice diagram, current selection, and unresolved comments. Use selection when the user refers to “this” or “these”.',
      inputSchema: objectSchema({
        scope: {
          type: 'string',
          enum: ['all', 'selection', 'comments'],
          description: 'Content to return. Defaults to all.',
        },
      }),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (raw, context) =>
        executeSafely(() => {
          const signal = executionSignal(context)
          if (signal.aborted) throw new DOMException('Tool execution aborted.', 'AbortError')
          const scope = (raw as { scope?: DiagramScope }).scope ?? 'all'
          return bridge().getDiagram(scope, signal)
        }),
    },
    {
      name: 'create_diagram',
      title: 'Create an architecture diagram',
      description:
        'Create and lay out a typed architecture diagram. With replaceExisting true, replaces Lattice diagram nodes and edges while preserving ordinary tldraw objects and comments.',
      inputSchema: objectSchema(
        {
          title: { type: 'string', maxLength: LATTICE_LIMITS.title },
          replaceExisting: { type: 'boolean' },
          nodes: {
            type: 'array',
            minItems: 1,
            maxItems: LATTICE_LIMITS.nodes,
            items: objectSchema({ id, label, kind: nodeKind }, ['id', 'label', 'kind']),
          },
          edges: {
            type: 'array',
            maxItems: LATTICE_LIMITS.edges,
            items: objectSchema(
              {
                id,
                source: id,
                target: id,
                label: { type: 'string', maxLength: LATTICE_LIMITS.label },
              },
              ['id', 'source', 'target'],
            ),
          },
        },
        ['nodes'],
      ),
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (raw, context) =>
        executeSafely(() =>
          bridge().createDiagram(raw as CreateDiagramInput, executionSignal(context)),
        ),
    },
    {
      name: 'apply_diagram_patch',
      title: 'Patch the open diagram',
      description:
        'Apply explicit operations at an expected revision. Unmentioned shapes and positions stay unchanged; stale revisions fail.',
      inputSchema: objectSchema(
        {
          expectedRevision: { type: 'integer', minimum: 0 },
          targetCommentId: {
            type: 'string',
            minLength: 1,
            maxLength: LATTICE_LIMITS.commentId,
            description: 'Comment whose captured target bounds this patch.',
          },
          operations: {
            type: 'array',
            minItems: 1,
            maxItems: LATTICE_LIMITS.patchOperations,
            items: {
              oneOf: [
                objectSchema(
                  {
                    type: { type: 'string', const: 'add_node' },
                    id,
                    label,
                    kind: nodeKind,
                    near: id,
                    direction: { type: 'string', enum: LATTICE_DIRECTIONS },
                  },
                  ['type', 'id', 'label', 'kind'],
                ),
                objectSchema(
                  {
                    type: { type: 'string', const: 'update_node' },
                    id,
                    label,
                    kind: nodeKind,
                  },
                  ['type', 'id'],
                ),
                objectSchema(
                  { type: { type: 'string', const: 'remove_node' }, id },
                  ['type', 'id'],
                ),
                objectSchema(
                  {
                    type: { type: 'string', const: 'add_edge' },
                    id,
                    source: id,
                    target: id,
                    label: { type: 'string', maxLength: LATTICE_LIMITS.label },
                  },
                  ['type', 'id', 'source', 'target'],
                ),
                objectSchema(
                  {
                    type: { type: 'string', const: 'update_edge' },
                    id,
                    label: { type: 'string', maxLength: LATTICE_LIMITS.label },
                  },
                  ['type', 'id', 'label'],
                ),
                objectSchema(
                  { type: { type: 'string', const: 'remove_edge' }, id },
                  ['type', 'id'],
                ),
              ],
            },
          },
        },
        ['expectedRevision', 'operations'],
      ),
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (raw, context) =>
        executeSafely(() =>
          bridge().applyDiagramPatch(
            raw as ApplyDiagramPatchInput,
            executionSignal(context),
          ),
        ),
    },
    {
      name: 'resolve_comment',
      title: 'Resolve a diagram comment',
      description:
        'Resolve one comment only after a successful target-scoped patch addressed it at the expected current diagram revision.',
      inputSchema: objectSchema(
        {
          commentId: {
            type: 'string',
            minLength: 1,
            maxLength: LATTICE_LIMITS.commentId,
            description: 'Exact unresolved comment thread ID.',
          },
          expectedRevision: { type: 'integer', minimum: 0 },
        },
        ['commentId', 'expectedRevision'],
      ),
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (raw, context) =>
        executeSafely(() =>
          bridge().resolveComment(raw as ResolveCommentInput, executionSignal(context)),
        ),
    },
  ]

  void Promise.all(
    tools.map((tool) => context.registerTool(tool, { signal: lifecycle.signal })),
  ).catch((error: unknown) => {
    if (!lifecycle.signal.aborted) console.error('Lattice WebMCP registration failed.', error)
  })

  return () => lifecycle.abort()
}

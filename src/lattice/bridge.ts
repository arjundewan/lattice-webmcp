import {
  createBindingId,
  createShapeId,
  toRichText,
  type Editor,
  type JsonObject,
  type TLArrowShape,
  type TLCommentThread,
  type TLGeoShape,
  type TLShape,
  type TLShapeId,
} from 'tldraw'
import {
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultSizeStyle,
  GeoShapeGeoStyle,
} from '@tldraw/tlschema'
import {
  getLiveComments,
  getLiveCommentThreads,
  putCommentRecords,
  resolveThread,
  richTextToPlaintext,
} from '@tldraw/commenting'
import { layoutDiagram } from './layout'
import type {
  ApplyDiagramPatchInput,
  CreateDiagramInput,
  DiagramEdgeInput,
  DiagramNodeInput,
  DiagramScope,
  LatticeElementMeta,
  NodeKind,
  PatchOperation,
  PersistedCommentTarget,
  ResolveCommentInput,
} from './types'
import {
  LATTICE_DIRECTIONS,
  LATTICE_ID_PATTERN,
  LATTICE_LIMITS,
  NODE_KINDS,
} from './types'

const NODE_WIDTH = 220
const NODE_HEIGHT = 84
const NODE_APPEARANCE_VERSION = 2
const ID_PATTERN = new RegExp(LATTICE_ID_PATTERN)

const nodeAppearance: Record<
  NodeKind,
  Pick<TLGeoShape['props'], 'color' | 'fill' | 'geo'>
> = {
  client: { color: 'blue', fill: 'solid', geo: 'rectangle' },
  service: { color: 'blue', fill: 'solid', geo: 'rectangle' },
  data: { color: 'blue', fill: 'solid', geo: 'rectangle' },
  queue: { color: 'blue', fill: 'solid', geo: 'rectangle' },
  external: { color: 'blue', fill: 'solid', geo: 'rectangle' },
}

interface BridgeState {
  revision: number
  title: string
  isMutating: boolean
  selectionAtCommentStart: TLShapeId[]
}

interface BridgeCallbacks {
  onDocumentChanged(): void
  onTitleChanged(title: string): void
}

function readLatticeMeta(shape: TLShape): LatticeElementMeta | null {
  const value = shape.meta.lattice
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const meta = value as unknown as Partial<LatticeElementMeta>
  if ((meta.type !== 'node' && meta.type !== 'edge') || typeof meta.id !== 'string') return null
  return meta as LatticeElementMeta
}

function shapeMeta(meta: LatticeElementMeta): JsonObject {
  return { lattice: meta as unknown as JsonObject }
}

function assertId(id: unknown, label = 'ID'): asserts id is string {
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    id.length > LATTICE_LIMITS.id ||
    !ID_PATTERN.test(id)
  ) {
    throw new Error(`${label} must start with a letter and contain only letters, numbers, _ or -.`)
  }
}

function assertNodeKind(kind: unknown): asserts kind is NodeKind {
  if (typeof kind !== 'string' || !(NODE_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Unsupported node kind: ${kind}`)
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
}

function assertKnownKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const allowed = new Set(keys)
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  if (unknown) throw new Error(`${label} contains unsupported field: ${unknown}.`)
}

function assertString(
  value: unknown,
  label: string,
  { minLength = 0, maxLength }: { minLength?: number; maxLength?: number } = {},
): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`)
  if (value.length < minLength) throw new Error(`${label} must be at least ${minLength} character(s).`)
  if (maxLength !== undefined && value.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters.`)
  }
}

function assertOptionalString(
  value: Record<string, unknown>,
  key: string,
  label: string,
  options: { minLength?: number; maxLength?: number } = {},
) {
  if (key in value) assertString(value[key], label, options)
}

function assertInteger(value: unknown, label: string) {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`)
}

function assertArray(value: unknown, label: string, maxLength: number): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`)
  if (value.length > maxLength) throw new Error(`${label} may contain at most ${maxLength} items.`)
}

function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Tool execution aborted.', 'AbortError')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertPatchOperations(value: unknown): asserts value is PatchOperation[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('At least one patch operation is required.')
  }
  if (value.length > LATTICE_LIMITS.patchOperations) {
    throw new Error(`Patch operations may contain at most ${LATTICE_LIMITS.patchOperations} items.`)
  }

  for (const [index, operation] of value.entries()) {
    assertRecord(operation, `Patch operation ${index + 1}`)
    if (typeof operation.type !== 'string') {
      throw new Error(`Patch operation ${index + 1} needs a supported type.`)
    }

    switch (operation.type) {
      case 'add_node':
        assertKnownKeys(operation, ['type', 'id', 'label', 'kind', 'near', 'direction'], 'Add-node operation')
        assertId(operation.id, `Add-node operation ${index + 1} ID`)
        assertString(operation.label, `Add-node operation ${index + 1} label`, {
          minLength: 1,
          maxLength: LATTICE_LIMITS.label,
        })
        assertNodeKind(operation.kind)
        if ('near' in operation) assertId(operation.near, `Add-node operation ${index + 1} near`)
        if ('direction' in operation) {
          if (
            typeof operation.direction !== 'string' ||
            !(LATTICE_DIRECTIONS as readonly string[]).includes(operation.direction)
          ) {
            throw new Error(`Add-node operation ${index + 1} direction is unsupported.`)
          }
        }
        break
      case 'update_node':
        assertKnownKeys(operation, ['type', 'id', 'label', 'kind'], 'Update-node operation')
        assertId(operation.id, `Update-node operation ${index + 1} ID`)
        assertOptionalString(operation, 'label', `Update-node operation ${index + 1} label`, {
          maxLength: LATTICE_LIMITS.label,
        })
        if ('kind' in operation) assertNodeKind(operation.kind)
        if (!('label' in operation) && !('kind' in operation)) {
          throw new Error(`Update-node operation ${index + 1} needs a label or kind.`)
        }
        break
      case 'remove_node':
        assertKnownKeys(operation, ['type', 'id'], 'Remove-node operation')
        assertId(operation.id, `Remove-node operation ${index + 1} ID`)
        break
      case 'add_edge':
        assertKnownKeys(operation, ['type', 'id', 'source', 'target', 'label'], 'Add-edge operation')
        assertId(operation.id, `Add-edge operation ${index + 1} ID`)
        assertId(operation.source, `Add-edge operation ${index + 1} source`)
        assertId(operation.target, `Add-edge operation ${index + 1} target`)
        assertOptionalString(operation, 'label', `Add-edge operation ${index + 1} label`, {
          maxLength: LATTICE_LIMITS.label,
        })
        break
      case 'update_edge':
        assertKnownKeys(operation, ['type', 'id', 'label'], 'Update-edge operation')
        assertId(operation.id, `Update-edge operation ${index + 1} ID`)
        assertString(operation.label, `Update-edge operation ${index + 1} label`, {
          maxLength: LATTICE_LIMITS.label,
        })
        break
      case 'remove_edge':
        assertKnownKeys(operation, ['type', 'id'], 'Remove-edge operation')
        assertId(operation.id, `Remove-edge operation ${index + 1} ID`)
        break
      default:
        throw new Error(`Unsupported patch operation type: ${operation.type}`)
    }
  }
}

export class LatticeBridge {
  private isDrawingNode = false
  private readonly restoreInitialShapeMeta: () => void
  private commentPointerStart: {
    point: { x: number; y: number }
    previousSelection: TLShapeId[]
  } | null = null

  constructor(
    readonly editor: Editor,
    readonly state: BridgeState,
    private readonly callbacks: BridgeCallbacks,
  ) {
    const initialMetaForShape = editor.getInitialMetaForShape.bind(editor)
    editor.getInitialMetaForShape = (shape) => {
      const initialMeta = initialMetaForShape(shape)
      if (!this.isDrawingNode || shape.type !== 'geo') return initialMeta

      this.isDrawingNode = false
      return {
        ...initialMeta,
        ...shapeMeta({
          type: 'node',
          id: this.nextNodeId(),
          kind: 'service',
          customStyle: true,
          appearanceVersion: NODE_APPEARANCE_VERSION,
        }),
      }
    }
    this.restoreInitialShapeMeta = () => {
      editor.getInitialMetaForShape = initialMetaForShape
    }
  }

  dispose() {
    this.restoreInitialShapeMeta()
  }

  get revision() {
    return this.state.revision
  }

  noteUserChange() {
    if (this.state.isMutating) return
    this.state.revision += 1
    this.callbacks.onDocumentChanged()
  }

  beginComment() {
    this.state.selectionAtCommentStart = this.editor
      .getSelectedShapeIds()
      .filter((id) => this.isLatticeShape(id))
    this.editor.setHintingShapes([])
    this.editor.setCurrentTool('comment')
  }

  beginNodeDraw() {
    this.isDrawingNode = true
    this.editor.setStyleForNextShapes(DefaultColorStyle, 'blue')
    this.editor.setStyleForNextShapes(DefaultDashStyle, 'solid')
    this.editor.setStyleForNextShapes(DefaultFillStyle, 'solid')
    this.editor.setStyleForNextShapes(DefaultSizeStyle, 's')
    this.editor.setStyleForNextShapes(GeoShapeGeoStyle, 'rectangle')
    this.editor.setCurrentTool('geo')
  }

  undo() {
    if (!this.editor.canUndo()) return
    this.editor.undo()
    this.bumpRevision()
  }

  redo() {
    if (!this.editor.canRedo()) return
    this.editor.redo()
    this.bumpRevision()
  }

  updateSelectedNodeStyle(style: Pick<TLGeoShape['props'], 'color' | 'fill' | 'geo'>) {
    const selected = this.nodeShapes().filter(({ shape }) =>
      this.editor.getSelectedShapeIds().includes(shape.id),
    )
    const [node] = selected
    if (!node || selected.length !== 1) return

    this.mutate('Style node', () => {
      this.editor.updateShape<TLGeoShape>({
        id: node.shape.id,
        type: 'geo',
        props: style,
        meta: shapeMeta({
          ...node.meta,
          customStyle: true,
          appearanceVersion: NODE_APPEARANCE_VERSION,
        }),
      })
    })
  }

  normalizeNodeAppearance() {
    const nodesToNormalize = this.nodeShapes().filter(
      ({ meta }) => meta.appearanceVersion !== NODE_APPEARANCE_VERSION,
    )
    if (nodesToNormalize.length === 0) return

    this.state.isMutating = true
    try {
      this.editor.updateShapes<TLGeoShape>(
        nodesToNormalize.map(({ shape, meta }) => ({
          id: shape.id,
          type: 'geo',
          props: {
            color: meta.appearanceVersion === undefined ? 'blue' : shape.props.color,
            fill: 'solid',
            geo: meta.appearanceVersion === undefined ? 'rectangle' : shape.props.geo,
            dash: 'solid',
            size: 's',
          },
          meta: shapeMeta({
            ...meta,
            appearanceVersion: NODE_APPEARANCE_VERSION,
          }),
        })),
      )
    } finally {
      this.state.isMutating = false
    }
    this.bumpRevision()
  }

  syncSelectHover() {
    if (this.editor.getCurrentToolId() !== 'select' || this.editor.inputs.getIsDragging()) return
    const hoveredId = this.editor.getHoveredShapeId()
    const next = hoveredId && this.isLatticeShape(hoveredId) ? [hoveredId] : []
    const current = this.editor.getHintingShapeIds()
    if (current.length === next.length && current.every((id, index) => id === next[index])) return
    this.editor.setHintingShapes(next)
  }

  clearSelectHover() {
    if (this.editor.getCurrentToolId() === 'select') this.editor.setHintingShapes([])
  }

  captureCommentPointerDown(point: { x: number; y: number }) {
    this.commentPointerStart = null
    if (this.editor.getCurrentToolId() !== 'comment') return

    const pagePoint = this.editor.screenToPage(point)
    const shape = this.editor.getShapeAtPoint(pagePoint, {
      hitInside: true,
      hitLabels: true,
      margin: 8 / this.editor.getZoomLevel(),
      filter: (candidate) => this.isLatticeShape(candidate.id),
    })
    if (!shape || !this.isLatticeShape(shape.id)) return

    const previousSelection = [...this.state.selectionAtCommentStart]
    const selection = new Set(previousSelection)
    selection.add(shape.id)
    this.state.selectionAtCommentStart = [...selection]
    this.editor.setSelectedShapes(this.state.selectionAtCommentStart)
    this.editor.setHintingShapes(this.state.selectionAtCommentStart)
    this.commentPointerStart = {
      point,
      previousSelection,
    }
  }

  cancelCommentSelectionOnDrag(point: { x: number; y: number }) {
    const start = this.commentPointerStart
    if (!start || Math.hypot(point.x - start.point.x, point.y - start.point.y) <= 5) return

    this.state.selectionAtCommentStart = start.previousSelection
    this.editor.setSelectedShapes(start.previousSelection)
    this.commentPointerStart = null
  }

  finishCommentPointer() {
    this.commentPointerStart = null
  }

  captureUntrackedCommentTargets() {
    const threads = getLiveCommentThreads(this.editor)
    let captured = false

    for (const thread of threads) {
      if (this.readPersistedTarget(thread)) continue
      const target = this.targetForThread(thread)
      this.state.isMutating = true
      try {
        putCommentRecords(this.editor, [
          {
            ...thread,
            meta: {
              ...thread.meta,
              latticeTarget: target as unknown as JsonObject,
            },
          },
        ])
      } finally {
        this.state.isMutating = false
      }
      captured = true
    }

    if (captured) {
      this.state.selectionAtCommentStart = []
      this.bumpRevision()
      // tldraw returns to select after a new thread is posted. Restore comment mode after the
      // post completes so people can place several annotations without reselecting the tool.
      queueMicrotask(() => {
        if (this.editor.getCurrentToolId() === 'select') this.editor.setCurrentTool('comment')
      })
    }
  }

  getDiagram(scope: DiagramScope, signal: AbortSignal) {
    assertNotAborted(signal)
    const nodes = this.nodeShapes()
      .map(({ shape, meta }) => ({
        id: meta.id,
        kind: meta.kind,
        label: this.shapeText(shape),
        position: { x: Math.round(shape.x), y: Math.round(shape.y) },
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
    const edges = this.edgeShapes()
      .map(({ shape, meta }) => ({
        id: meta.id,
        source: meta.source,
        target: meta.target,
        label: this.shapeText(shape),
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
    const selection = this.editor
      .getSelectedShapeIds()
      .map((id) => this.editor.getShape(id))
      .filter((shape): shape is TLShape => Boolean(shape))
      .map((shape) => readLatticeMeta(shape))
      .filter((meta): meta is LatticeElementMeta => Boolean(meta))

    const comments = this.openComments()
    const base = {
      ok: true,
      document: { title: this.state.title, revision: this.state.revision },
      selection: {
        nodeIds: selection.filter((item) => item.type === 'node').map((item) => item.id),
        edgeIds: selection.filter((item) => item.type === 'edge').map((item) => item.id),
      },
    }

    if (scope === 'selection') return base
    if (scope === 'comments') return { ...base, openComments: comments }
    return { ...base, nodes, edges, openComments: comments }
  }

  createDiagram(input: CreateDiagramInput, signal: AbortSignal) {
    assertNotAborted(signal)
    this.validateCreateInput(input)
    this.validateDiagram(input.nodes, input.edges ?? [])
    const existing = this.latticeShapes()
    if (existing.length > 0 && !input.replaceExisting) {
      throw new Error(
        'The Lattice diagram is not empty. Set replaceExisting to true to replace its nodes and edges.',
      )
    }

    const edges = input.edges ?? []
    const positions = layoutDiagram(input.nodes, edges)

    this.mutate('Create diagram', () => {
      if (existing.length > 0) this.editor.deleteShapes(existing.map((shape) => shape.id))
      this.editor.createShapes(
        input.nodes.map((node) => {
          const position = positions.get(node.id) ?? { x: 0, y: 0 }
          return this.nodeRecord(node, position)
        }),
      )

      for (const edge of edges) this.createEdge(edge)
    })

    this.state.title = input.title?.trim() || 'Untitled architecture'
    this.callbacks.onTitleChanged(this.state.title)
    this.callbacks.onDocumentChanged()
    this.editor.zoomToFit({ animation: { duration: 220 } })

    return {
      ok: true,
      revision: this.state.revision,
      created: { nodeIds: input.nodes.map((node) => node.id), edgeIds: edges.map((edge) => edge.id) },
    }
  }

  applyDiagramPatch(input: ApplyDiagramPatchInput, signal: AbortSignal) {
    assertNotAborted(signal)
    this.validateApplyInput(input)
    this.assertRevision(input.expectedRevision)
    assertPatchOperations(input.operations)

    const allowedShapeIds = input.targetCommentId !== undefined
      ? new Set(this.commentTargetShapeIds(input.targetCommentId))
      : null
    this.validatePatch(input.operations, allowedShapeIds)
    const addedNodeIds = new Set<string>()
    const changedNodeIds = new Set<string>()
    const changedEdgeIds = new Set<string>()

    this.mutate('Apply agent update', () => {
      for (const operation of input.operations) {
        assertNotAborted(signal)
        switch (operation.type) {
          case 'add_node': {
            this.assertScopedAddDisallowed(allowedShapeIds, 'add_node')
            assertId(operation.id, 'Node ID')
            assertNodeKind(operation.kind)
            if (this.findBySemanticId(operation.id)) throw new Error(`Element ${operation.id} exists.`)
            const near = operation.near ? this.findNode(operation.near) : undefined
            const position = near
              ? this.relativePosition(near.shape, operation.direction ?? 'right')
              : this.nextOpenPosition()
            this.editor.createShape(this.nodeRecord(operation, position))
            addedNodeIds.add(operation.id)
            changedNodeIds.add(operation.id)
            break
          }
          case 'update_node': {
            const node = this.findNode(operation.id)
            this.assertTargetAllows(node.shape.id, allowedShapeIds, operation.id)
            const kind = operation.kind ?? node.meta.kind ?? 'service'
            assertNodeKind(kind)
            this.editor.updateShape<TLGeoShape>({
              id: node.shape.id,
              type: 'geo',
              props: {
                ...(operation.label ? { richText: toRichText(operation.label) } : {}),
                ...(operation.kind ? nodeAppearance[kind] : {}),
              },
              meta: shapeMeta({ ...node.meta, kind }),
            })
            changedNodeIds.add(operation.id)
            break
          }
          case 'remove_node': {
            const node = this.findNode(operation.id)
            this.assertTargetAllows(node.shape.id, allowedShapeIds, operation.id)
            const connected = this.edgeShapes().filter(
              ({ meta }) => meta.source === operation.id || meta.target === operation.id,
            )
            this.editor.deleteShapes([node.shape.id, ...connected.map(({ shape }) => shape.id)])
            changedNodeIds.add(operation.id)
            connected.forEach(({ meta }) => changedEdgeIds.add(meta.id))
            break
          }
          case 'add_edge': {
            this.assertScopedAddDisallowed(allowedShapeIds, 'add_edge')
            assertId(operation.id, 'Edge ID')
            if (this.findBySemanticId(operation.id)) throw new Error(`Element ${operation.id} exists.`)
            this.createEdge(operation)
            changedEdgeIds.add(operation.id)
            break
          }
          case 'update_edge': {
            const edge = this.findEdge(operation.id)
            this.assertTargetAllows(edge.shape.id, allowedShapeIds, operation.id)
            this.editor.updateShape<TLArrowShape>({
              id: edge.shape.id,
              type: 'arrow',
              props: { richText: toRichText(operation.label) },
            })
            changedEdgeIds.add(operation.id)
            break
          }
          case 'remove_edge': {
            const edge = this.findEdge(operation.id)
            this.assertTargetAllows(edge.shape.id, allowedShapeIds, operation.id)
            this.editor.deleteShape(edge.shape.id)
            changedEdgeIds.add(operation.id)
            break
          }
        }
      }
    })

    void addedNodeIds
    return {
      ok: true,
      revision: this.state.revision,
      changed: { nodeIds: [...changedNodeIds], edgeIds: [...changedEdgeIds] },
    }
  }

  resolveComment(input: ResolveCommentInput, signal: AbortSignal) {
    assertNotAborted(signal)
    this.validateResolveInput(input)
    this.assertRevision(input.expectedRevision)
    const thread = getLiveCommentThreads(this.editor).find((item) => item.id === input.commentId)
    if (!thread) throw new Error(`Comment ${input.commentId} was not found.`)
    if (thread.resolved) throw new Error(`Comment ${input.commentId} is already resolved.`)

    this.state.isMutating = true
    try {
      resolveThread(this.editor, thread, 'agent')
    } finally {
      this.state.isMutating = false
    }
    this.bumpRevision()
    return { ok: true, commentId: input.commentId, resolved: true, revision: this.state.revision }
  }

  private validateCreateInput(input: unknown): asserts input is CreateDiagramInput {
    assertRecord(input, 'Create-diagram input')
    assertKnownKeys(input, ['title', 'replaceExisting', 'nodes', 'edges'], 'Create-diagram input')
    assertOptionalString(input, 'title', 'Diagram title', { maxLength: LATTICE_LIMITS.title })
    if ('replaceExisting' in input) assertBoolean(input.replaceExisting, 'replaceExisting')
    if (!('nodes' in input)) throw new Error('At least one node is required.')
    if ('edges' in input && input.edges !== undefined) {
      assertArray(input.edges, 'Diagram edges', LATTICE_LIMITS.edges)
    }
  }

  private validateApplyInput(input: unknown): asserts input is ApplyDiagramPatchInput {
    assertRecord(input, 'Apply-patch input')
    assertKnownKeys(input, ['expectedRevision', 'targetCommentId', 'operations'], 'Apply-patch input')
    if (!('expectedRevision' in input)) throw new Error('expectedRevision is required.')
    assertInteger(input.expectedRevision, 'expectedRevision')
    assertOptionalString(input, 'targetCommentId', 'targetCommentId', {
      minLength: 1,
      maxLength: LATTICE_LIMITS.commentId,
    })
    if (!('operations' in input)) throw new Error('At least one patch operation is required.')
    assertPatchOperations(input.operations)
  }

  private validateResolveInput(input: unknown): asserts input is ResolveCommentInput {
    assertRecord(input, 'Resolve-comment input')
    assertKnownKeys(input, ['commentId', 'expectedRevision'], 'Resolve-comment input')
    assertString(input.commentId, 'commentId', {
      minLength: 1,
      maxLength: LATTICE_LIMITS.commentId,
    })
    if (!('expectedRevision' in input)) throw new Error('expectedRevision is required.')
    assertInteger(input.expectedRevision, 'expectedRevision')
  }

  private validateDiagram(nodes: unknown, edges: unknown) {
    assertArray(nodes, 'Diagram nodes', LATTICE_LIMITS.nodes)
    if (nodes.length === 0) throw new Error('At least one node is required.')
    assertArray(edges, 'Diagram edges', LATTICE_LIMITS.edges)
    const nodeIds = new Set<string>()
    for (const node of nodes) {
      assertRecord(node, 'Diagram node')
      assertKnownKeys(node, ['id', 'label', 'kind'], 'Diagram node')
      assertId(node.id, 'Node ID')
      assertString(node.label, `Node ${node.id} label`, {
        minLength: 1,
        maxLength: LATTICE_LIMITS.label,
      })
      assertNodeKind(node.kind)
      if (!node.label.trim()) throw new Error(`Node ${node.id} needs a label.`)
      if (nodeIds.has(node.id)) throw new Error(`Duplicate node ID: ${node.id}`)
      nodeIds.add(node.id)
    }
    const edgeIds = new Set<string>()
    for (const edge of edges) {
      assertRecord(edge, 'Diagram edge')
      assertKnownKeys(edge, ['id', 'source', 'target', 'label'], 'Diagram edge')
      assertId(edge.id, 'Edge ID')
      assertId(edge.source, `Edge ${edge.id} source`)
      assertId(edge.target, `Edge ${edge.id} target`)
      assertOptionalString(edge, 'label', `Edge ${edge.id} label`, {
        maxLength: LATTICE_LIMITS.label,
      })
      if (edgeIds.has(edge.id)) throw new Error(`Duplicate edge ID: ${edge.id}`)
      if (nodeIds.has(edge.id)) throw new Error(`Element ID ${edge.id} is already in use.`)
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        throw new Error(`Edge ${edge.id} references an unknown node.`)
      }
      edgeIds.add(edge.id)
    }
  }

  private validatePatch(operations: PatchOperation[], allowed: Set<string> | null) {
    const nodes = new Map(
      this.nodeShapes().map(({ shape, meta }) => [meta.id, shape.id] as const),
    )
    const edges = new Map(
      this.edgeShapes().map(({ shape, meta }) => [
        meta.id,
        { shapeId: shape.id, source: meta.source ?? '', target: meta.target ?? '' },
      ] as const),
    )
    const elementIds = new Set([...nodes.keys(), ...edges.keys()])

    for (const operation of operations) {
      switch (operation.type) {
        case 'add_node':
          this.assertScopedAddDisallowed(allowed, 'add_node')
          assertId(operation.id, 'Node ID')
          assertNodeKind(operation.kind)
          if (!operation.label.trim()) throw new Error(`Node ${operation.id} needs a label.`)
          if (elementIds.has(operation.id)) throw new Error(`Element ${operation.id} exists.`)
          elementIds.add(operation.id)
          nodes.set(operation.id, createShapeId(`lattice-node-${operation.id}`))
          break
        case 'update_node': {
          const shapeId = nodes.get(operation.id)
          if (!shapeId) throw new Error(`Node ${operation.id} was not found.`)
          this.assertTargetAllows(shapeId, allowed, operation.id)
          if (operation.kind) assertNodeKind(operation.kind)
          break
        }
        case 'remove_node': {
          const shapeId = nodes.get(operation.id)
          if (!shapeId) throw new Error(`Node ${operation.id} was not found.`)
          this.assertTargetAllows(shapeId, allowed, operation.id)
          nodes.delete(operation.id)
          elementIds.delete(operation.id)
          for (const [edgeId, edge] of edges) {
            if (edge.source === operation.id || edge.target === operation.id) {
              edges.delete(edgeId)
              elementIds.delete(edgeId)
            }
          }
          break
        }
        case 'add_edge':
          this.assertScopedAddDisallowed(allowed, 'add_edge')
          assertId(operation.id, 'Edge ID')
          if (elementIds.has(operation.id)) throw new Error(`Element ${operation.id} exists.`)
          if (!nodes.has(operation.source) || !nodes.has(operation.target)) {
            throw new Error(`Edge ${operation.id} references an unknown node.`)
          }
          elementIds.add(operation.id)
          edges.set(operation.id, {
            shapeId: createShapeId(`lattice-edge-${operation.id}`),
            source: operation.source,
            target: operation.target,
          })
          break
        case 'update_edge': {
          const edge = edges.get(operation.id)
          if (!edge) throw new Error(`Edge ${operation.id} was not found.`)
          this.assertTargetAllows(edge.shapeId, allowed, operation.id)
          break
        }
        case 'remove_edge': {
          const edge = edges.get(operation.id)
          if (!edge) throw new Error(`Edge ${operation.id} was not found.`)
          this.assertTargetAllows(edge.shapeId, allowed, operation.id)
          edges.delete(operation.id)
          elementIds.delete(operation.id)
          break
        }
      }
    }
  }

  private nodeRecord(node: DiagramNodeInput, position: { x: number; y: number }) {
    return {
      id: createShapeId(`lattice-node-${node.id}`),
      type: 'geo' as const,
      x: position.x,
      y: position.y,
      props: {
        w: NODE_WIDTH,
        h: NODE_HEIGHT,
        richText: toRichText(node.label),
        dash: 'solid' as const,
        size: 's' as const,
        font: 'sans' as const,
        align: 'middle' as const,
        verticalAlign: 'middle' as const,
        ...nodeAppearance[node.kind],
      },
      meta: shapeMeta({
        type: 'node',
        id: node.id,
        kind: node.kind,
        appearanceVersion: NODE_APPEARANCE_VERSION,
      }),
    }
  }

  private createEdge(edge: DiagramEdgeInput) {
    const source = this.findNode(edge.source)
    const target = this.findNode(edge.target)
    const arrowId = createShapeId(`lattice-edge-${edge.id}`)
    const sourceBounds = this.editor.getShapePageBounds(source.shape.id)
    const targetBounds = this.editor.getShapePageBounds(target.shape.id)
    if (!sourceBounds || !targetBounds) throw new Error(`Could not place edge ${edge.id}.`)

    this.editor.createShape<TLArrowShape>({
      id: arrowId,
      type: 'arrow',
      x: sourceBounds.center.x,
      y: sourceBounds.center.y,
      props: {
        start: { x: 0, y: 0 },
        end: {
          x: targetBounds.center.x - sourceBounds.center.x,
          y: targetBounds.center.y - sourceBounds.center.y,
        },
        arrowheadEnd: 'arrow',
        dash: 'solid',
        size: 's',
        color: 'grey',
        font: 'sans',
        bend: 0,
        richText: toRichText(edge.label ?? ''),
      },
      meta: shapeMeta({
        type: 'edge',
        id: edge.id,
        source: edge.source,
        target: edge.target,
      }),
    })
    this.editor.createBindings([
      {
        id: createBindingId(),
        type: 'arrow',
        fromId: arrowId,
        toId: source.shape.id,
        props: {
          terminal: 'start',
          isExact: false,
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isPrecise: false,
        },
      },
      {
        id: createBindingId(),
        type: 'arrow',
        fromId: arrowId,
        toId: target.shape.id,
        props: {
          terminal: 'end',
          isExact: false,
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isPrecise: false,
        },
      },
    ])
  }

  private mutate(name: string, action: () => void) {
    this.editor.markHistoryStoppingPoint(name)
    this.state.isMutating = true
    try {
      this.editor.run(action)
    } finally {
      this.state.isMutating = false
    }
    this.bumpRevision()
  }

  private bumpRevision() {
    this.state.revision += 1
    this.callbacks.onDocumentChanged()
  }

  private assertRevision(expectedRevision: number) {
    if (expectedRevision !== this.state.revision) {
      throw new Error(
        `Stale diagram revision. Expected ${expectedRevision}; current revision is ${this.state.revision}.`,
      )
    }
  }

  private assertScopedAddDisallowed(allowed: Set<string> | null, operationType: string) {
    if (allowed) {
      throw new Error(`${operationType} is not allowed when targetCommentId is present.`)
    }
  }

  private assertTargetAllows(shapeId: TLShapeId, allowed: Set<string> | null, semanticId: string) {
    if (allowed && !allowed.has(shapeId)) {
      throw new Error(`Element ${semanticId} is outside the target comment.`)
    }
  }

  private latticeShapes() {
    return this.editor.getCurrentPageShapes().filter((shape) => Boolean(readLatticeMeta(shape)))
  }

  private nodeShapes() {
    return this.latticeShapes()
      .map((shape) => ({ shape, meta: readLatticeMeta(shape) }))
      .filter(
        (item): item is { shape: TLGeoShape; meta: LatticeElementMeta } =>
          item.shape.type === 'geo' && item.meta?.type === 'node',
      )
  }

  private edgeShapes() {
    return this.latticeShapes()
      .map((shape) => ({ shape, meta: readLatticeMeta(shape) }))
      .filter(
        (item): item is { shape: TLArrowShape; meta: LatticeElementMeta } =>
          item.shape.type === 'arrow' && item.meta?.type === 'edge',
      )
  }

  private findBySemanticId(id: string) {
    return this.latticeShapes().find((shape) => readLatticeMeta(shape)?.id === id)
  }

  private findNode(id: string) {
    const found = this.nodeShapes().find(({ meta }) => meta.id === id)
    if (!found) throw new Error(`Node ${id} was not found.`)
    return found
  }

  private findEdge(id: string) {
    const found = this.edgeShapes().find(({ meta }) => meta.id === id)
    if (!found) throw new Error(`Edge ${id} was not found.`)
    return found
  }

  private isLatticeShape(id: TLShapeId) {
    const shape = this.editor.getShape(id)
    return Boolean(shape && readLatticeMeta(shape))
  }

  private shapeText(shape: TLShape) {
    return this.editor.getShapeUtil(shape).getText(shape)?.trim() ?? ''
  }

  private targetForThread(thread: TLCommentThread): PersistedCommentTarget {
    if (
      thread.anchor.type === 'region' &&
      (thread.anchor.w > 4 || thread.anchor.h > 4)
    ) {
      const region = thread.anchor
      const shapeIds = this.latticeShapes()
        .filter((shape) => {
          const bounds = this.editor.getShapePageBounds(shape)
          if (!bounds) return false
          return !(
            bounds.maxX < region.x ||
            bounds.x > region.x + region.w ||
            bounds.maxY < region.y ||
            bounds.y > region.y + region.h
          )
        })
        .map((shape) => shape.id)
      return { kind: 'region', shapeIds }
    }
    if (this.state.selectionAtCommentStart.length > 0) {
      return {
        kind: 'selection',
        shapeIds: this.state.selectionAtCommentStart.filter((id) => this.isLatticeShape(id)),
      }
    }
    if (thread.anchor.type === 'shape') {
      return {
        kind: 'shape',
        shapeIds: this.isLatticeShape(thread.anchor.shapeId) ? [thread.anchor.shapeId] : [],
      }
    }
    if (thread.anchor.type === 'region') return { kind: 'region', shapeIds: [] }
    return { kind: 'point', shapeIds: [] }
  }

  private readPersistedTarget(thread: TLCommentThread): PersistedCommentTarget | null {
    const value = thread.meta.latticeTarget
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const target = value as unknown as Partial<PersistedCommentTarget>
    if (!Array.isArray(target.shapeIds) || typeof target.kind !== 'string') return null
    return target as PersistedCommentTarget
  }

  private openComments() {
    const comments = getLiveComments(this.editor)
    return getLiveCommentThreads(this.editor)
      .filter((thread) => !thread.resolved)
      .map((thread) => {
        const target = this.readPersistedTarget(thread) ?? this.targetForThread(thread)
        const body = comments.find((comment) => comment.threadId === thread.id)?.body
        const targetItems = target.shapeIds
          .map((id) => this.editor.getShape(id as TLShapeId))
          .filter((shape): shape is TLShape => Boolean(shape))
          .map((shape) => readLatticeMeta(shape)?.id)
          .filter((id): id is string => Boolean(id))
        return {
          id: thread.id,
          text: body ? richTextToPlaintext(body, () => undefined) : '',
          target: {
            kind: target.kind,
            elementIds: targetItems,
            ...(target.kind === 'region' && thread.anchor.type === 'region'
              ? {
                  bounds: {
                    x: Math.round(thread.anchor.x),
                    y: Math.round(thread.anchor.y),
                    width: Math.round(thread.anchor.w),
                    height: Math.round(thread.anchor.h),
                  },
                }
              : {}),
          },
        }
      })
  }

  private commentTargetShapeIds(commentId: string) {
    const thread = getLiveCommentThreads(this.editor).find((item) => item.id === commentId)
    if (!thread) throw new Error(`Comment ${commentId} was not found.`)
    return (this.readPersistedTarget(thread) ?? this.targetForThread(thread)).shapeIds
  }

  private relativePosition(shape: TLGeoShape, direction: 'left' | 'right' | 'above' | 'below') {
    const offsets = {
      left: { x: -280, y: 0 },
      right: { x: 280, y: 0 },
      above: { x: 0, y: -150 },
      below: { x: 0, y: 150 },
    }
    return { x: shape.x + offsets[direction].x, y: shape.y + offsets[direction].y }
  }

  private nextOpenPosition() {
    const nodes = this.nodeShapes()
    if (nodes.length === 0) return { x: 0, y: 0 }
    const rightmost = nodes.reduce((best, item) => (item.shape.x > best.shape.x ? item : best))
    return { x: rightmost.shape.x + 280, y: rightmost.shape.y }
  }

  private nextNodeId() {
    let index = this.nodeShapes().length + 1
    while (this.findBySemanticId(`node${index}`)) index += 1
    return `node${index}`
  }
}

export type { BridgeState }

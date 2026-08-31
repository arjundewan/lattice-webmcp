export const NODE_KINDS = ['client', 'service', 'data', 'queue', 'external'] as const

export const LATTICE_DIRECTIONS = ['left', 'right', 'above', 'below'] as const

export const LATTICE_LIMITS = {
  id: 64,
  label: 120,
  title: 120,
  commentId: 160,
  nodes: 30,
  edges: 60,
  patchOperations: 20,
} as const

export const LATTICE_ID_PATTERN = '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$'

export type NodeKind = (typeof NODE_KINDS)[number]

export interface DiagramNodeInput {
  id: string
  label: string
  kind: NodeKind
}

export interface DiagramEdgeInput {
  id: string
  source: string
  target: string
  label?: string
}

export interface CreateDiagramInput {
  title?: string
  replaceExisting?: boolean
  nodes: DiagramNodeInput[]
  edges?: DiagramEdgeInput[]
}

export type PatchOperation =
  | {
      type: 'add_node'
      id: string
      label: string
      kind: NodeKind
      near?: string
      direction?: 'left' | 'right' | 'above' | 'below'
    }
  | { type: 'update_node'; id: string; label?: string; kind?: NodeKind }
  | { type: 'remove_node'; id: string }
  | {
      type: 'add_edge'
      id: string
      source: string
      target: string
      label?: string
    }
  | { type: 'update_edge'; id: string; label: string }
  | { type: 'remove_edge'; id: string }

export interface ApplyDiagramPatchInput {
  expectedRevision: number
  targetCommentId?: string
  operations: PatchOperation[]
}

export interface ResolveCommentInput {
  commentId: string
  expectedRevision: number
}

export type DiagramScope = 'all' | 'selection' | 'comments'

export interface LatticeElementMeta {
  type: 'node' | 'edge'
  id: string
  kind?: NodeKind
  customStyle?: boolean
  appearanceVersion?: number
  source?: string
  target?: string
}

export interface PersistedCommentTarget {
  kind: 'selection' | 'shape' | 'region' | 'point'
  shapeIds: string[]
}

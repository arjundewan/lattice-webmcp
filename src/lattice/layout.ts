import type { DiagramEdgeInput, DiagramNodeInput } from './types'

const COLUMN_GAP = 440
const ROW_GAP = 240

export interface NodePosition {
  x: number
  y: number
}

export function layoutDiagram(
  nodes: DiagramNodeInput[],
  edges: DiagramEdgeInput[],
): Map<string, NodePosition> {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
    outgoing.get(edge.source)?.push(edge.target)
  }

  const layerById = new Map<string, number>()
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id)

  if (queue.length === 0 && nodes[0]) queue.push(nodes[0].id)

  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]
    if (!id) continue
    const layer = layerById.get(id) ?? 0

    for (const target of outgoing.get(id) ?? []) {
      layerById.set(target, Math.max(layerById.get(target) ?? 0, layer + 1))
      incoming.set(target, (incoming.get(target) ?? 1) - 1)
      if (incoming.get(target) === 0) queue.push(target)
    }
  }

  for (const node of nodes) {
    if (!layerById.has(node.id)) layerById.set(node.id, 0)
  }

  const layers = new Map<number, string[]>()
  for (const node of nodes) {
    const layer = layerById.get(node.id) ?? 0
    const members = layers.get(layer) ?? []
    members.push(node.id)
    layers.set(layer, members)
  }

  const positions = new Map<string, NodePosition>()
  for (const [layer, members] of layers) {
    const totalHeight = (members.length - 1) * ROW_GAP
    members.forEach((id, row) => {
      positions.set(id, {
        x: layer * COLUMN_GAP,
        y: row * ROW_GAP - totalHeight / 2,
      })
    })
  }

  return positions
}

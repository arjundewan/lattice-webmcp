import type { TLStore, TLEditorSnapshot } from 'tldraw'
import { getSnapshot, loadSnapshot } from 'tldraw'

interface PersistedLatticeDocument {
  version: 1
  title: string
  revision: number
  snapshot: TLEditorSnapshot
}

function storageKey(documentId: string) {
  return `lattice:document:${documentId}`
}

export function loadPersistedDocument(
  store: TLStore,
  documentId: string,
): { title: string; revision: number } {
  const raw = localStorage.getItem(storageKey(documentId))
  if (!raw) return { title: 'Untitled architecture', revision: 0 }

  try {
    const saved = JSON.parse(raw) as PersistedLatticeDocument
    if (saved.version !== 1) return { title: 'Untitled architecture', revision: 0 }
    loadSnapshot(store, saved.snapshot)
    return { title: saved.title, revision: saved.revision }
  } catch (error) {
    console.warn('Lattice could not restore this local document.', error)
    return { title: 'Untitled architecture', revision: 0 }
  }
}

export function persistDocument(
  store: TLStore,
  documentId: string,
  title: string,
  revision: number,
) {
  const saved: PersistedLatticeDocument = {
    version: 1,
    title,
    revision,
    snapshot: getSnapshot(store),
  }

  localStorage.setItem(storageKey(documentId), JSON.stringify(saved))
}

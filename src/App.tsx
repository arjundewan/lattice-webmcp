import { CanvasComments, CommentTool, getLiveCommentThreads } from '@tldraw/commenting'
import {
  ArrowRight,
  Bot,
  BoxSelect,
  Circle,
  Hand,
  MessageSquare,
  MousePointer2,
  Redo2,
  Scan,
  Square,
  SquarePlus,
  Triangle,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  commentSchemaRecords,
  createTLSchema,
  createTLStore,
  EditorPortal,
  Tldraw,
  useEditor,
  useValue,
  type Editor,
  type TLComponents,
  type TLEventInfo,
  type TLGeoShape,
} from 'tldraw'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { LatticeBridge, type BridgeState } from './lattice/bridge'
import { loadPersistedDocument, persistDocument } from './lattice/persistence'
import { registerLatticeTools } from './webmcp/register'
import '@tldraw/commenting/commenting.css'
import 'tldraw/tldraw.css'

const COMMENT_TOOLS = [
  CommentTool.configure({ enableRegions: true, history: 'record', dragHistory: 'record' }),
]

interface LatticeUiContextValue {
  title: string
  beginNodeDraw(): void
  beginComment(): void
  updateSelectedNodeStyle(style: Pick<TLGeoShape['props'], 'color' | 'fill' | 'geo'>): void
}

const LatticeUiContext = createContext<LatticeUiContextValue | null>(null)

function useLatticeUi() {
  const value = useContext(LatticeUiContext)
  if (!value) throw new Error('Lattice UI context is unavailable.')
  return value
}

function documentIdFromLocation() {
  const match = window.location.pathname.match(/^\/d\/([a-zA-Z0-9-]+)$/)
  if (match?.[1]) return match[1]
  const id = crypto.randomUUID()
  window.history.replaceState(null, '', `/d/${id}`)
  return id
}

function ToolButton({
  label,
  active = false,
  badge,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  badge?: number
  onClick(): void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`tool-button${active ? ' is-active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      {children}
      {badge ? <span className="tool-badge">{badge}</span> : null}
    </button>
  )
}

const NODE_COLORS: Array<{
  value: TLGeoShape['props']['color']
  label: string
  swatch: string
}> = [
  { value: 'blue', label: 'Blue', swatch: '#5b82d6' },
  { value: 'violet', label: 'Violet', swatch: '#8a6ed1' },
  { value: 'green', label: 'Green', swatch: '#4e9c78' },
  { value: 'orange', label: 'Orange', swatch: '#c98647' },
  { value: 'grey', label: 'Grey', swatch: '#75766e' },
]

const NODE_SHAPES: Array<{
  value: TLGeoShape['props']['geo']
  label: string
  icon: typeof Square
}> = [
  { value: 'rectangle', label: 'Rectangle', icon: Square },
  { value: 'ellipse', label: 'Ellipse', icon: Circle },
  { value: 'triangle', label: 'Triangle', icon: Triangle },
]

function selectedLatticeNode(editor: Editor) {
  const selectedIds = editor.getSelectedShapeIds()
  if (selectedIds.length !== 1) return null

  const [selectedId] = selectedIds
  if (!selectedId) return null
  const shape = editor.getShape(selectedId)
  const meta = shape?.meta.lattice
  if (
    shape?.type !== 'geo' ||
    !meta ||
    typeof meta !== 'object' ||
    Array.isArray(meta) ||
    (meta as { type?: unknown }).type !== 'node'
  ) {
    return null
  }

  return shape
}

function NodeStylePanel() {
  const editor = useEditor()
  const { updateSelectedNodeStyle } = useLatticeUi()
  const node = useValue('selected Lattice node', () => selectedLatticeNode(editor), [editor])

  if (!node) return null

  return (
    <aside className="node-style-panel" aria-label="Selected node style">
      <div className="node-style-section">
        <div className="node-style-options">
          {NODE_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              className={`node-color-option${node.props.color === color.value ? ' is-selected' : ''}`}
              aria-label={`${color.label} node`}
              aria-pressed={node.props.color === color.value}
              title={color.label}
              onClick={() =>
                updateSelectedNodeStyle({ color: color.value, fill: 'solid', geo: node.props.geo })
              }
            >
              <span style={{ backgroundColor: color.swatch }} />
            </button>
          ))}
        </div>
      </div>
      <div className="node-style-section">
        <div className="node-style-options">
          {NODE_SHAPES.map((shape) => {
            const Icon = shape.icon
            return (
              <button
                key={shape.value}
                type="button"
                className={`node-shape-option${node.props.geo === shape.value ? ' is-selected' : ''}`}
                aria-label={`${shape.label} node`}
                aria-pressed={node.props.geo === shape.value}
                title={shape.label}
                onClick={() =>
                  updateSelectedNodeStyle({ color: node.props.color, fill: 'solid', geo: shape.value })
                }
              >
                <Icon size={16} strokeWidth={1.8} />
              </button>
            )
          })}
        </div>
      </div>
    </aside>
  )
}

function CanvasChrome() {
  const editor = useEditor()
  const { title, beginNodeDraw, beginComment } = useLatticeUi()
  const currentTool = useValue('current tool', () => editor.getCurrentToolId(), [editor])
  const shapeCount = useValue('shape count', () => editor.getCurrentPageShapes().length, [editor])
  const openComments = useValue(
    'open comment count',
    () => getLiveCommentThreads(editor).filter((thread) => !thread.resolved).length,
    [editor],
  )

  return (
    <>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <BoxSelect size={17} strokeWidth={2.2} />
          </div>
          <div>
            <div className="brand-name">Lattice</div>
            <div className="document-title">{title}</div>
          </div>
        </div>
      </header>

      {shapeCount === 0 ? (
        <div className="empty-canvas" aria-hidden="true">
          <div className="empty-icon"><Bot size={18} /></div>
          <p>Ask your agent to create an architecture diagram.</p>
          <span>Lattice will keep it editable on this canvas.</span>
        </div>
      ) : null}

      <div className="primary-toolbar" role="toolbar" aria-label="Canvas tools">
        <ToolButton
          label="Select (V)"
          active={currentTool === 'select'}
          onClick={() => editor.setCurrentTool('select')}
        >
          <MousePointer2 size={18} />
        </ToolButton>
        <ToolButton
          label="Hand (H)"
          active={currentTool === 'hand'}
          onClick={() => editor.setCurrentTool('hand')}
        >
          <Hand size={18} />
        </ToolButton>
        <span className="toolbar-divider" />
        <ToolButton label="Draw node (N)" active={currentTool === 'geo'} onClick={beginNodeDraw}>
          <SquarePlus size={18} />
        </ToolButton>
        <ToolButton
          label="Connector (A)"
          active={currentTool === 'arrow'}
          onClick={() => editor.setCurrentTool('arrow')}
        >
          <ArrowRight size={18} />
        </ToolButton>
        <ToolButton
          label="Comment (C)"
          active={currentTool === 'comment'}
          badge={openComments}
          onClick={beginComment}
        >
          <MessageSquare size={18} />
        </ToolButton>
      </div>

      <div className="history-toolbar" role="toolbar" aria-label="Edit history">
        <ToolButton label="Undo" onClick={() => editor.undo()}>
          <Undo2 size={17} />
        </ToolButton>
        <ToolButton label="Redo" onClick={() => editor.redo()}>
          <Redo2 size={17} />
        </ToolButton>
      </div>

      <div className="zoom-toolbar" role="toolbar" aria-label="Canvas view">
        <ToolButton label="Zoom out" onClick={() => editor.zoomOut()}>
          <ZoomOut size={17} />
        </ToolButton>
        <ToolButton
          label="Fit diagram"
          onClick={() => editor.zoomToFit({ animation: { duration: 180 } })}
        >
          <Scan size={17} />
        </ToolButton>
        <ToolButton label="Zoom in" onClick={() => editor.zoomIn()}>
          <ZoomIn size={17} />
        </ToolButton>
      </div>
      <NodeStylePanel />
    </>
  )
}

function LatticeOverlay() {
  return (
    <>
      <CanvasComments
        currentUserId="you"
        resolveAuthor={(id) =>
          id === 'agent'
            ? { name: 'Agent', color: '#6957d7' }
            : { name: 'You', color: '#167f71' }
        }
      />
      <EditorPortal>
        <CanvasChrome />
      </EditorPortal>
    </>
  )
}

const COMPONENTS: TLComponents = {
  InFrontOfTheCanvas: LatticeOverlay,
}

export function App() {
  const documentId = useMemo(documentIdFromLocation, [])
  const [{ store, initial }] = useState(() => {
    const nextStore = createTLStore({
      schema: createTLSchema({ records: commentSchemaRecords }),
    })
    return {
      store: nextStore,
      initial: loadPersistedDocument(nextStore, documentId),
    }
  })
  const bridgeRef = useRef<LatticeBridge | null>(null)
  const bridgeStateRef = useRef<BridgeState>({
    title: initial.title,
    revision: initial.revision,
    isMutating: false,
    selectionAtCommentStart: [],
  })
  const persistTimerRef = useRef<number | null>(null)
  const [title, setTitle] = useState(initial.title)

  const persistNow = useCallback(() => {
    persistDocument(
      store,
      documentId,
      bridgeStateRef.current.title,
      bridgeStateRef.current.revision,
    )
  }, [documentId, store])

  const schedulePersist = useCallback(() => {
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current)
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null
      persistNow()
    }, 80)
  }, [persistNow])

  const handleMount = useCallback(
    (editor: Editor) => {
      const bridge = new LatticeBridge(editor, bridgeStateRef.current, {
        onDocumentChanged: schedulePersist,
        onTitleChanged(nextTitle) {
          bridgeStateRef.current.title = nextTitle
          setTitle(nextTitle)
        },
      })
      bridgeRef.current = bridge

      const stopListening = editor.store.listen(
        () => {
          schedulePersist()
          queueMicrotask(() => bridge.captureUntrackedCommentTargets())
        },
        { scope: 'document', source: 'user' },
      )
      const handleEditorEvent = (event: TLEventInfo) => {
        if (event.name === 'pointer_move') bridge.syncSelectHover()
        if (event.name === 'pointer_down') bridge.clearSelectHover()
        if (event.type === 'pointer' && event.name === 'pointer_up') {
          bridge.noteUserChange()
        }
        if (event.name === 'key_up') bridge.noteUserChange()
      }
      editor.on('event', handleEditorEvent)
      queueMicrotask(() => bridge.captureUntrackedCommentTargets())

      return () => {
        stopListening()
        editor.off('event', handleEditorEvent)
        bridge.dispose()
        bridgeRef.current = null
        persistNow()
      }
    },
    [persistNow, schedulePersist],
  )

  useEffect(() => registerLatticeTools(() => bridgeRef.current), [])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return
      }

      const bridge = bridgeRef.current
      if (!bridge) return

      if (event.key.toLowerCase() === 'c') {
        event.preventDefault()
        event.stopPropagation()
        bridge.beginComment()
      }

      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        event.stopPropagation()
        bridge.beginNodeDraw()
      }
    }

    window.addEventListener('keydown', handleShortcut, true)
    return () => window.removeEventListener('keydown', handleShortcut, true)
  }, [])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') persistNow()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [persistNow])

  const ui = useMemo<LatticeUiContextValue>(
    () => ({
      title,
      beginNodeDraw() {
        bridgeRef.current?.beginNodeDraw()
      },
      beginComment() {
        bridgeRef.current?.beginComment()
      },
      updateSelectedNodeStyle(style) {
        bridgeRef.current?.updateSelectedNodeStyle(style)
      },
    }),
    [title],
  )

  const handlePointerDownCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest('button, input, textarea, [contenteditable="true"]')
    ) {
      return
    }
    bridgeRef.current?.captureCommentPointerDown({ x: event.clientX, y: event.clientY })
  }, [])

  const handlePointerMoveCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    bridgeRef.current?.cancelCommentSelectionOnDrag({ x: event.clientX, y: event.clientY })
  }, [])

  const handlePointerUpCapture = useCallback(() => {
    bridgeRef.current?.finishCommentPointer()
  }, [])

  return (
    <main
      className="app-shell"
      aria-label="Lattice architecture canvas"
      onPointerDownCapture={handlePointerDownCapture}
      onPointerMoveCapture={handlePointerMoveCapture}
      onPointerUpCapture={handlePointerUpCapture}
    >
      <LatticeUiContext.Provider value={ui}>
        <Tldraw
          autoFocus
          colorScheme="light"
          components={COMPONENTS}
          hideUi
          onMount={handleMount}
          store={store}
          tools={COMMENT_TOOLS}
        />
      </LatticeUiContext.Provider>
    </main>
  )
}

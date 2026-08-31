export {}

declare global {
  interface WebMcpTool {
    name: string
    title?: string
    description: string
    inputSchema: Record<string, unknown>
    annotations?: {
      readOnlyHint?: boolean
      untrustedContentHint?: boolean
    }
    execute(input: unknown, context?: { signal: AbortSignal }): unknown | Promise<unknown>
  }

  interface WebMcpModelContext extends EventTarget {
    registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): Promise<void>
  }

  interface Document {
    readonly modelContext?: WebMcpModelContext
  }
}

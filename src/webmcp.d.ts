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
    execute(input: unknown, context?: { signal: AbortSignal }): string | Promise<string>
  }

  interface WebMcpModelContext extends EventTarget {
    registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): Promise<void>
  }

  interface Document {
    readonly modelContext?: WebMcpModelContext
  }
}

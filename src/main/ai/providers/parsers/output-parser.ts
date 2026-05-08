import type { AIEvent } from '../../types'

export interface OutputParser {
  parseLine(line: string): AIEvent[]
  consume(data: string): AIEvent[]

  /**
   * Called on clean process exit (code 0, no stderr) before the session is torn down.
   * Emits any pending terminal events (typically 'complete' + 'done') so that the
   * renderer persists the final assistant message.
   */
  flush(): AIEvent[]

  // PTY-specific interaction control (no-ops for stream-json parsers)
  beginTurn(): void
  resolveInteraction(): void
  cancelTurn(): void
}

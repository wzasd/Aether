import type { AIEvent } from '../../types'
import type { OutputParser } from './output-parser'
import { EventParser } from '../../event-parser'
import { ManualTuiParser } from '../../manual-tui-parser'

export class ClaudeOutputParser implements OutputParser {
  private streamParser: EventParser | null = null
  private ptyParser: ManualTuiParser | null = null

  constructor(transport: 'stream-json' | 'pty', sessionId: string) {
    if (transport === 'stream-json') {
      this.streamParser = new EventParser()
    } else {
      this.ptyParser = new ManualTuiParser(sessionId)
    }
  }

  parseLine(line: string): AIEvent[] {
    if (!this.streamParser) return []
    const result = this.streamParser.parseLine(line)
    if (!result) return []
    return Array.isArray(result) ? result : [result]
  }

  consume(data: string): AIEvent[] {
    if (!this.ptyParser) return []
    return this.ptyParser.consume(data)
  }

  flush(): AIEvent[] {
    return []
  }

  beginTurn(): void {
    this.ptyParser?.beginTurn()
  }

  resolveInteraction(): void {
    this.ptyParser?.resolveInteraction()
  }

  cancelTurn(): void {
    this.ptyParser?.cancelTurn()
  }
}

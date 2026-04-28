import { ipcMain } from 'electron'
import { aiEngine } from '../ai/engine'
import type { SessionConfig } from '../ai/provider'

export function registerChatIpc(): void {
  // 启动新会话
  ipcMain.handle('chat:startSession', async (_, config: SessionConfig) => {
    return aiEngine.startSession(config)
  })

  // 发送消息
  ipcMain.handle('chat:sendMessage', async (_, sessionId: string, content: string) => {
    aiEngine.sendMessage(sessionId, content)
  })

  // 响应权限确认
  ipcMain.handle('chat:respondPermission', async (_, sessionId: string, approved: boolean) => {
    aiEngine.respondPermission(sessionId, approved)
  })

  // 响应用户提问
  ipcMain.handle('chat:respondQuestion', async (_, sessionId: string, answer: string) => {
    aiEngine.respondQuestion(sessionId, answer)
  })

  // 中断会话
  ipcMain.handle('chat:abort', async (_, sessionId: string) => {
    aiEngine.abort(sessionId)
  })

  // 结束会话
  ipcMain.handle('chat:endSession', async (_, sessionId: string) => {
    await aiEngine.endSession(sessionId)
  })
}

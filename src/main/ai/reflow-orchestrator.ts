import type { A2ATask, PartialResult, ReflowState } from './a2a-types'

export interface ReflowGroup {
  id: string
  callbackToProfileId: string
  triggerTaskId: string
  childTaskIds: Set<string>
  completedResults: Map<string, PartialResult>
  timeoutAt: number
  state: ReflowState
}

/**
 * Manages multi-agent result aggregation for parallel @mention groups.
 *
 * When an agent (or user) @mentions multiple agents in parallel with a
 * callbackTo target, ReflowOrchestrator waits for all children to complete,
 * then aggregates their outputs into a single feedback message.
 *
 * Anti-cascade: if too many children fail, the group fails early.
 */
export class ReflowOrchestrator {
  private groups = new Map<string, ReflowGroup>()
  private taskToGroup = new Map<string, string>() // taskId -> groupId
  private readonly DEFAULT_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
  private readonly ANTI_CASCADE_MAX_FAILURES = 2
  private timeoutCheckInterval?: ReturnType<typeof setInterval>
  /** AbortControllers per dispatch — keyed by groupId for cancellation */
  private dispatchControllers = new Map<string, AbortController>()

  /**
   * Create a reflow group when dispatchIntents produces multiple parallel tasks
   * that should aggregate back to a callbackTo agent.
   */
  createGroup(
    callbackToProfileId: string,
    triggerTaskId: string,
    childTaskIds: string[],
    timeoutMs?: number
  ): ReflowGroup {
    const id = `${triggerTaskId}::reflow`
    const group: ReflowGroup = {
      id,
      callbackToProfileId,
      triggerTaskId,
      childTaskIds: new Set(childTaskIds),
      completedResults: new Map(),
      timeoutAt: Date.now() + (timeoutMs ?? this.DEFAULT_TIMEOUT_MS),
      state: 'running',
    }
    this.groups.set(id, group)
    for (const taskId of childTaskIds) {
      this.taskToGroup.set(taskId, id)
    }
    // Create an AbortController for this dispatch so callers can cancel it
    this.dispatchControllers.set(id, new AbortController())
    return group
  }

  /** Register an AbortController for an existing group (e.g. from external dispatch). */
  registerDispatch(groupId: string, controller: AbortController): void {
    this.dispatchControllers.set(groupId, controller)
  }

  /** Abort all child tasks in a group (e.g. when user stops the conversation). */
  abortGroup(groupId: string): void {
    const controller = this.dispatchControllers.get(groupId)
    if (controller && !controller.signal.aborted) {
      controller.abort()
    }
  }

  /** Abort all active groups for a given set of task IDs (e.g. conversation stop). */
  abortByTaskIds(taskIds: string[]): void {
    const groupIds = new Set<string>()
    for (const taskId of taskIds) {
      const groupId = this.taskToGroup.get(taskId)
      if (groupId) groupIds.add(groupId)
    }
    for (const groupId of Array.from(groupIds)) {
      this.abortGroup(groupId)
    }
  }

  /** Returns the AbortSignal for a group, if any. */
  getAbortSignal(groupId: string): AbortSignal | undefined {
    return this.dispatchControllers.get(groupId)?.signal
  }

  /** Look up which group a task belongs to, if any. */
  getGroupForTask(taskId: string): ReflowGroup | undefined {
    const groupId = this.taskToGroup.get(taskId)
    return groupId ? this.groups.get(groupId) : undefined
  }

  onChildComplete(taskId: string, output: string): PartialResult | undefined {
    const group = this.getGroupForTask(taskId)
    if (!group) return undefined

    const result: PartialResult = { fromProfileId: taskId, output, status: 'ok' }
    group.completedResults.set(taskId, result)
    this.tryAggregate(group)
    return result
  }

  onChildFail(taskId: string, error: string): PartialResult | undefined {
    const group = this.getGroupForTask(taskId)
    if (!group) return undefined

    const result: PartialResult = { fromProfileId: taskId, output: error, status: 'failed' }
    group.completedResults.set(taskId, result)
    this.tryAggregate(group)
    return result
  }

  /** Returns true if the group is ready for aggregation. */
  tryAggregate(group: ReflowGroup): boolean {
    if (group.state !== 'running') return false

    const failures = Array.from(group.completedResults.values()).filter((r) => r.status === 'failed').length

    // Anti-cascade guard
    if (failures > this.ANTI_CASCADE_MAX_FAILURES) {
      group.state = 'failed'
      return true
    }

    // Check if all children have reported
    const allDone = Array.from(group.childTaskIds).every((id) => group.completedResults.has(id))
    if (allDone) {
      group.state = failures > 0 ? 'partial' : 'done'
      return true
    }

    return false
  }

  /** Build the aggregated message sent to the callbackTo agent. */
  buildAggregationMessage(group: ReflowGroup): string {
    const parts: string[] = []
    parts.push(`以下 ${group.childTaskIds.size} 个 Agent 的并行任务已完成：\n`)

    for (const taskId of Array.from(group.childTaskIds)) {
      const result = group.completedResults.get(taskId)
      if (!result) {
        parts.push(`- [${taskId}]: ⏳ 未响应`)
        continue
      }
      const statusIcon = result.status === 'ok' ? '✅' : '❌'
      const truncated = result.output.length > 800
        ? result.output.slice(0, 800) + '\n\n[输出过长，已截断...]'
        : result.output
      parts.push(`\n${statusIcon} **${taskId}**:\n${truncated}`)
    }

    const failures = Array.from(group.completedResults.values()).filter((r) => r.status === 'failed').length
    if (failures > 0) {
      parts.push(`\n\n⚠️ 共有 ${failures} 个任务失败，请查看错误并决定下一步。`)
    } else {
      parts.push(`\n\n请查看所有结果并决定下一步行动。`)
    }

    return parts.join('\n')
  }

  /** Mark a group as timed out and return its current results. */
  timeoutGroup(groupId: string): ReflowGroup | undefined {
    const group = this.groups.get(groupId)
    if (!group || group.state !== 'running') return undefined
    group.state = 'timeout'
    return group
  }

  /** Clean up a group and its mappings. */
  disposeGroup(groupId: string): void {
    const group = this.groups.get(groupId)
    if (!group) return
    for (const taskId of Array.from(group.childTaskIds)) {
      this.taskToGroup.delete(taskId)
    }
    this.groups.delete(groupId)
    this.dispatchControllers.delete(groupId)
  }

  private onTimeoutCallback?: (group: ReflowGroup) => void

  setTimeoutCallback(callback: (group: ReflowGroup) => void): void {
    this.onTimeoutCallback = callback
  }

  /** Start a periodic timeout guard. */
  startTimeoutGuard(checkIntervalMs = 30 * 1000): void {
    if (this.timeoutCheckInterval) return
    this.timeoutCheckInterval = setInterval(() => {
      const now = Date.now()
      for (const group of Array.from(this.groups.values())) {
        if (group.state === 'running' && now > group.timeoutAt) {
          this.timeoutGroup(group.id)
          this.onTimeoutCallback?.(group)
        }
      }
    }, checkIntervalMs)
  }

  stopTimeoutGuard(): void {
    if (this.timeoutCheckInterval) {
      clearInterval(this.timeoutCheckInterval)
      this.timeoutCheckInterval = undefined
    }
  }
}

import { create } from 'zustand'

export interface TodoItem {
  content: string
  status: string
  activeForm?: string
}

interface TodoState {
  items: TodoItem[]
}

export const useTodoStore = create<TodoState & {
  onTodoUpdated: (event: { todos: TodoItem[] }) => void
  loadFromDB: (items: Array<{ content: string; completed: number }>) => void
  clear: () => void
}>((set) => ({
  items: [],
  onTodoUpdated: (event) => {
    set({ items: event.todos || [] })
  },
  loadFromDB: (records) => {
    set({
      items: records.map((r) => ({
        content: r.content,
        status: r.completed ? 'completed' : 'pending'
      }))
    })
  },
  clear: () => set({ items: [] })
}))

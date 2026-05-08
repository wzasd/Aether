import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useMemoryPalaceStore } from './memoryPalaceStore'
import type { MemoryEntry } from './memoryPalaceStore'

const mockEntries: MemoryEntry[] = [
  {
    id: '1',
    workspaceId: 'ws1',
    category: 'architecture',
    title: 'Component Layout',
    content: '# Overview\n\nUse layered architecture',
    tags: ['architecture', 'layout'],
    citedBy: ['conv-1'],
    createdAt: 1700000000,
    updatedAt: 1700000100
  },
  {
    id: '2',
    workspaceId: 'ws1',
    category: 'conventions',
    title: 'Naming Rules',
    content: '- use camelCase\n- PascalCase for components',
    tags: ['naming'],
    citedBy: [],
    createdAt: 1700000000,
    updatedAt: 1700000200
  }
]

// Setup mock for window.api.memoryPalace
beforeEach(() => {
  vi.stubGlobal('window', {
    api: {
      memoryPalace: {
        list: vi.fn().mockResolvedValue(mockEntries),
        create: vi.fn().mockImplementation(async (_wsId, data) => ({
          id: '3',
          workspaceId: _wsId,
          category: data.category,
          title: data.title,
          content: data.content,
          tags: data.tags ?? [],
          citedBy: [],
          createdAt: Date.now() / 1000,
          updatedAt: Date.now() / 1000
        })),
        update: vi.fn().mockImplementation(async (id, patch) => {
          const entry = mockEntries.find((e) => e.id === id)
          return { ...entry!, ...patch, updatedAt: Date.now() / 1000 }
        }),
        delete: vi.fn().mockResolvedValue(undefined)
      }
    }
  })
})

describe('memoryPalaceStore', () => {
  describe('initial state', () => {
    it('has empty items array', () => {
      const state = useMemoryPalaceStore.getState()
      expect(state.items).toEqual([])
    })

    it('defaults filterCategory to all', () => {
      const state = useMemoryPalaceStore.getState()
      expect(state.filterCategory).toBe('all')
    })

    it('defaults selectedId to null', () => {
      const state = useMemoryPalaceStore.getState()
      expect(state.selectedId).toBeNull()
    })

    it('defaults isEditing to false', () => {
      const state = useMemoryPalaceStore.getState()
      expect(state.isEditing).toBe(false)
    })
  })

  describe('loadItems', () => {
    it('loads items from API and stores in state', async () => {
      await useMemoryPalaceStore.getState().loadItems('ws1')

      const state = useMemoryPalaceStore.getState()
      expect(state.items).toEqual(mockEntries)
    })

    it('handles API errors gracefully', async () => {
      vi.stubGlobal('window', {
        api: {
          memoryPalace: {
            list: vi.fn().mockRejectedValue(new Error('IPC error')),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn()
          }
        }
      })

      // Start with non-empty state
      useMemoryPalaceStore.setState({ items: mockEntries })
      await useMemoryPalaceStore.getState().loadItems('ws1')

      // Should keep existing state on error
      const state = useMemoryPalaceStore.getState()
      expect(state.items).toEqual(mockEntries)
    })
  })

  describe('createItem', () => {
    it('adds new item to front of items list', async () => {
      useMemoryPalaceStore.setState({ items: [...mockEntries] })

      await useMemoryPalaceStore.getState().createItem('ws1', {
        category: 'core',
        title: 'New Entry',
        content: 'Content',
        tags: ['test']
      })

      const state = useMemoryPalaceStore.getState()
      expect(state.items).toHaveLength(3)
      expect(state.items[0].title).toBe('New Entry')
      expect(state.selectedId).toBe(state.items[0].id)
      expect(state.isEditing).toBe(false)
    })
  })

  describe('updateItem', () => {
    it('updates item and exits editing', async () => {
      useMemoryPalaceStore.setState({ items: [...mockEntries], isEditing: true })

      await useMemoryPalaceStore.getState().updateItem('1', {
        title: 'Updated Title',
        tags: ['updated']
      })

      const state = useMemoryPalaceStore.getState()
      expect(state.isEditing).toBe(false)
      expect(state.editDraft).toEqual({})
    })
  })

  describe('deleteItem', () => {
    it('removes item from list', async () => {
      useMemoryPalaceStore.setState({ items: [...mockEntries] })

      await useMemoryPalaceStore.getState().deleteItem('1')

      const state = useMemoryPalaceStore.getState()
      expect(state.items).toHaveLength(1)
      expect(state.items[0].id).toBe('2')
    })

    it('resets selectedId when deleted item was selected', async () => {
      useMemoryPalaceStore.setState({ items: [...mockEntries], selectedId: '1' })

      await useMemoryPalaceStore.getState().deleteItem('1')

      const state = useMemoryPalaceStore.getState()
      expect(state.selectedId).toBe('2') // falls back to first remaining
    })

    it('resets selectedId to null when deleting last item', async () => {
      useMemoryPalaceStore.setState({ items: [mockEntries[0]], selectedId: '1' })

      await useMemoryPalaceStore.getState().deleteItem('1')

      const state = useMemoryPalaceStore.getState()
      expect(state.selectedId).toBeNull()
    })
  })

  describe('setFilter', () => {
    it('changes filterCategory', () => {
      useMemoryPalaceStore.getState().setFilter('architecture')
      expect(useMemoryPalaceStore.getState().filterCategory).toBe('architecture')
    })

    it('accepts "all" as filter', () => {
      useMemoryPalaceStore.getState().setFilter('architecture')
      useMemoryPalaceStore.getState().setFilter('all')
      expect(useMemoryPalaceStore.getState().filterCategory).toBe('all')
    })
  })

  describe('selectEntry', () => {
    it('sets selectedId and exits editing', () => {
      useMemoryPalaceStore.setState({ isEditing: true, editDraft: { title: 'draft' } })
      useMemoryPalaceStore.getState().selectEntry('1')

      const state = useMemoryPalaceStore.getState()
      expect(state.selectedId).toBe('1')
      expect(state.isEditing).toBe(false)
      expect(state.editDraft).toEqual({})
    })
  })

  describe('startEditing / cancelEditing', () => {
    it('startEditing sets isEditing and populates draft from selected entry', () => {
      useMemoryPalaceStore.setState({ items: [...mockEntries], selectedId: '1' })
      useMemoryPalaceStore.getState().startEditing()

      const state = useMemoryPalaceStore.getState()
      expect(state.isEditing).toBe(true)
      expect(state.editDraft.title).toBe('Component Layout')
    })

    it('cancelEditing resets editing state', () => {
      useMemoryPalaceStore.setState({ isEditing: true, editDraft: { title: 'draft' } })
      useMemoryPalaceStore.getState().cancelEditing()

      const state = useMemoryPalaceStore.getState()
      expect(state.isEditing).toBe(false)
      expect(state.editDraft).toEqual({})
    })
  })

  describe('setDraft', () => {
    it('merges patch into editDraft', () => {
      useMemoryPalaceStore.setState({ editDraft: { title: 'old' } })
      useMemoryPalaceStore.getState().setDraft({ content: 'new content' })

      const state = useMemoryPalaceStore.getState()
      expect(state.editDraft.title).toBe('old')
      expect(state.editDraft.content).toBe('new content')
    })
  })

  describe('requestOpenPanel', () => {
    it('increments _openPanelSeq', () => {
      const before = useMemoryPalaceStore.getState()._openPanelSeq
      useMemoryPalaceStore.getState().requestOpenPanel()
      expect(useMemoryPalaceStore.getState()._openPanelSeq).toBe(before + 1)
    })
  })
})

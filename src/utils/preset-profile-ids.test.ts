import { describe, expect, it } from 'vitest'
import { PRESET_PROFILE_IDS, isPresetProfileId } from './preset-profile-ids'

describe('preset-profile-ids', () => {
  it('recognizes every preset profile id', () => {
    for (const id of Object.values(PRESET_PROFILE_IDS)) {
      expect(isPresetProfileId(id)).toBe(true)
    }
  })

  it('rejects custom and malformed ids', () => {
    expect(isPresetProfileId('')).toBe(false)
    expect(isPresetProfileId('custom-agent')).toBe(false)
    expect(isPresetProfileId('claude-primary-custom')).toBe(false)
    expect(isPresetProfileId('codex/reviewer')).toBe(false)
  })

  it('keeps the exported preset ids unique', () => {
    const ids = Object.values(PRESET_PROFILE_IDS)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

import { describe, expect, it, vi } from 'vitest'

import {
  deleteBotProfileRequest as deleteFullProfile,
  updateBotDescription as updateFullDescription
} from './profile-operations.full'
import {
  deleteBotProfileRequest as deleteMiniProfile,
  updateBotDescription as updateMiniDescription
} from './profile-operations.mini'

describe('bot profile operations by desktop SKU', () => {
  it('preserves the full client CLI compatibility contract', async () => {
    const request = vi.fn().mockResolvedValue({ code: 0, output: 'deleted' })
    const host = { request }

    await deleteFullProfile(host, 'researcher')
    await updateFullDescription(host, 'researcher', 'Researches the hard parts')

    expect(request).toHaveBeenNthCalledWith(1, 'cli.exec', {
      argv: ['profile', 'delete', '-y', 'researcher']
    })
    expect(request).toHaveBeenNthCalledWith(2, 'cli.exec', {
      argv: ['profile', 'describe', 'researcher', '--text', 'Researches the hard parts']
    })
  })

  it('keeps CLI failure handling in the full client', async () => {
    const host = {
      request: vi.fn().mockResolvedValue({ code: 1, output: 'delete refused' })
    }

    await expect(deleteFullProfile(host, 'researcher')).rejects.toThrow('delete refused')
  })

  it('uses only typed profile RPCs in the Mini client', async () => {
    const request = vi.fn().mockResolvedValue({})
    const host = { request }

    await deleteMiniProfile(host, 'researcher')
    await updateMiniDescription(host, 'researcher', 'Researches the hard parts')

    expect(request).toHaveBeenNthCalledWith(1, 'profiles.delete', { name: 'researcher' })
    expect(request).toHaveBeenNthCalledWith(2, 'profiles.configure', {
      description: 'Researches the hard parts',
      name: 'researcher'
    })
  })
})

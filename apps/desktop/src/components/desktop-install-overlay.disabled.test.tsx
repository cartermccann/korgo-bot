// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DesktopInstallOverlay } from './desktop-install-overlay.disabled'

beforeEach(() => vi.restoreAllMocks())

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'hermesDesktop')
})

describe('SSH-only DesktopInstallOverlay', () => {
  function installDesktopMock() {
    const desktop = {
      getConnectionConfig: vi.fn().mockResolvedValue({ mode: 'local' }),
      testConnectionConfig: vi.fn().mockResolvedValue({
        reachable: true,
        sshError: null,
        host: 'cjm@100.100.10.20',
        remotePlatform: 'Linux/x86_64'
      }),
      saveConnectionConfig: vi.fn().mockResolvedValue({ mode: 'ssh' }),
      applyConnectionConfig: vi.fn().mockResolvedValue({ mode: 'ssh' })
    }

    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: desktop })

    return desktop
  }

  async function verifyAndSave() {
    fireEvent.change(screen.getByLabelText('Mini Tailscale IP'), { target: { value: '100.100.10.20' } })
    fireEvent.change(screen.getByLabelText('SSH user'), { target: { value: 'cjm' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify SSH connection' }))
    await screen.findByText(/Verified cjm@100.100.10.20/)
    fireEvent.click(screen.getByRole('button', { name: 'Save and connect' }))
  }

  it('dismisses after the verified SSH connection is saved and applied', async () => {
    const desktop = installDesktopMock()
    render(<DesktopInstallOverlay />)

    expect(await screen.findByText('Connect existing Hermes over SSH')).toBeTruthy()
    await verifyAndSave()

    await waitFor(() => expect(desktop.applyConnectionConfig).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByText('Connect existing Hermes over SSH')).toBeNull())
  })

  it('keeps the form visible when applying the saved connection fails', async () => {
    const desktop = installDesktopMock()
    desktop.applyConnectionConfig.mockRejectedValueOnce(new Error('SSH apply failed'))
    render(<DesktopInstallOverlay />)

    expect(await screen.findByText('Connect existing Hermes over SSH')).toBeTruthy()
    await verifyAndSave()

    expect((await screen.findByRole('alert')).textContent).toContain('SSH apply failed')
    expect(screen.getByText('Connect existing Hermes over SSH')).toBeTruthy()
  })
})

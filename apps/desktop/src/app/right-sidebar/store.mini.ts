import { atom } from 'nanostores'

import { persistBoolean, storedBoolean } from '@/lib/storage'

const OPEN_KEY = 'korgo.miniComputer.open.v1'

export const $orgoDesktopOpen = atom(storedBoolean(OPEN_KEY, true))

$orgoDesktopOpen.subscribe(active => persistBoolean(OPEN_KEY, active))

export const setOrgoDesktopOpen = (active: boolean) => $orgoDesktopOpen.set(active)
export const $orgoDesktopSettingsRequest = atom(false)
export const requestOrgoDesktopSettings = () => setOrgoDesktopOpen(true)
export const clearOrgoDesktopSettingsRequest = () => $orgoDesktopSettingsRequest.set(false)

import { describe, expect, it } from 'vitest'
import { isMotdAlert } from './mintProbeDisplay'

describe('isMotdAlert', () => {
  it('flags migration and maintenance MOTDs', () => {
    expect(isMotdAlert('migrated')).toBe(true)
    expect(isMotdAlert('Scheduled maintenance Friday')).toBe(true)
    expect(isMotdAlert('Mint paused')).toBe(true)
    expect(isMotdAlert('moved to https://new.example')).toBe(true)
  })

  it('leaves greetings and empty as quiet', () => {
    expect(isMotdAlert('welcome')).toBe(false)
    expect(isMotdAlert('gm')).toBe(false)
    expect(isMotdAlert('')).toBe(false)
    expect(isMotdAlert(null)).toBe(false)
    expect(isMotdAlert(undefined)).toBe(false)
  })

  it('does not treat common disclaimers as alerts', () => {
    expect(isMotdAlert('Do not use with large amounts of ecash.')).toBe(false)
    expect(isMotdAlert('use at your own risk')).toBe(false)
  })
})

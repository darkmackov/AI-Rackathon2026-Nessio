import { DEFAULT_THEME, getPrimaryShade, mergeMantineTheme } from '@mantine/core'
import { describe, expect, it } from 'vitest'
import { theme } from '../theme'

/** WCAG relative luminance for the opaque sRGB theme colors. */
function luminance(hex: string) {
  const digits = hex.length === 4 ? [...hex.slice(1)].map((value) => value + value).join('') : hex.slice(1)
  const channels = digits.match(/../g)!.map((value) => {
    const channel = parseInt(value, 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(first: string, second: string) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

const resolved = mergeMantineTheme(DEFAULT_THEME, theme)
const palette = resolved.colors[resolved.primaryColor]
const shade = getPrimaryShade(resolved, 'light')
const surfaces = [resolved.white, palette[0], palette[1], palette[2], resolved.colors.gray[0], resolved.colors.gray[2]]

describe('clinical theme contrast', () => {
  it('keeps white button labels readable in the default and hover states', () => {
    for (const background of [palette[shade], palette[shade === 9 ? 8 : shade + 1]]) {
      expect(contrast(resolved.white, background)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(surfaces)('keeps body text, muted labels and keyboard focus visible on %s', (background) => {
    expect(contrast(resolved.black, background)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(resolved.colors.gray[6], background)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(palette[shade], background)).toBeGreaterThanOrEqual(3)
  })
})

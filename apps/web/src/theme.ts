import { Checkbox, CloseButton, Input, Menu, NumberInput, SegmentedControl, createTheme } from '@mantine/core'
import pendingClasses from './components/PendingControl.module.css'

export const theme = createTheme({
  primaryColor: 'nessie',
  primaryShade: 9,
  black: '#23342B',
  // Mantine's default dimmed gray is too light for small clinical text (A11Y-3).
  colors: {
    nessie: ['#F4F7F2', '#E9F0E1', '#DAE6C4', '#B7C98B', '#A1B676', '#8EAA6B', '#769857', '#548357', '#387456', '#25634B'],
    gray: ['#f8f9fa', '#f1f3f5', '#e9ecef', '#dee2e6', '#ced4da', '#adb5bd', '#59636b', '#495057', '#343a40', '#212529'],
  },
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  defaultRadius: 'md',
  headings: { fontWeight: '650' },
  respectReducedMotion: true,
  components: {
    CloseButton: CloseButton.extend({ classNames: { root: pendingClasses.close } }),
    Menu: Menu.extend({ classNames: { item: pendingClasses.menuItem } }),
    Input: Input.extend({ classNames: { input: pendingClasses.input } }),
    Checkbox: Checkbox.extend({ classNames: { root: pendingClasses.checkboxRoot, input: pendingClasses.checkbox, icon: pendingClasses.checkboxIcon, label: pendingClasses.checkboxLabel } }),
    SegmentedControl: SegmentedControl.extend({ classNames: { root: pendingClasses.segmented, label: pendingClasses.segmentLabel } }),
    NumberInput: NumberInput.extend({ classNames: { root: pendingClasses.numberRoot, control: pendingClasses.numberControl } }),
  },
})

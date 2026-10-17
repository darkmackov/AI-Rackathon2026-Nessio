import { Checkbox, CloseButton, Input, Menu, NumberInput, SegmentedControl, createTheme } from '@mantine/core'
import pendingClasses from './components/PendingControl.module.css'

export const theme = createTheme({
  primaryColor: 'blue',
  primaryShade: 9,
  // Mantine's default dimmed gray is too light for small clinical text (A11Y-3).
  colors: {
    gray: ['#f8f9fa', '#f1f3f5', '#e9ecef', '#dee2e6', '#ced4da', '#adb5bd', '#5f6871', '#495057', '#343a40', '#212529'],
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

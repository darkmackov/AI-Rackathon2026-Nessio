import { Button, FileButton, Group, Paper, Stack, Text } from '@mantine/core'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

export default function FhirBundleInput({ file, disabled, error, onChange }: {
  file: File | null; disabled: boolean; error?: string; onChange: (file: File | null, error?: string) => void
}) {
  const { t, i18n } = useTranslation()
  const reset = useRef<() => void>(null)
  function select(files: File[]) {
    if (disabled) return
    const selected = files[0]
    if (files.length !== 1 || !selected || !selected.size ||
      !(selected.name.toLowerCase().endsWith('.json') || ['application/json', 'application/fhir+json'].includes(selected.type))) {
      onChange(null, 'referral.fhir.fileError')
    } else onChange(selected)
    reset.current?.()
  }
  return <Stack gap="xs">
    <Paper withBorder p="md" bg="gray.0" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
      event.preventDefault()
      select(Array.from(event.dataTransfer.files))
    }}><Stack gap="sm">
      <Text fw={600}>{t('referral.fhir.drop')}</Text>
      <Text size="sm" c="dimmed">{t('referral.fhir.help')}</Text>
      <FileButton accept=".json,application/json,application/fhir+json" resetRef={reset} disabled={disabled}
        onChange={(selected) => { if (selected) select([selected]) }} inputProps={{ 'aria-label': t('referral.fhir.choose'), disabled }}>
        {(props) => <Button {...props} variant="outline" disabled={disabled}>{t('referral.fhir.choose')}</Button>}
      </FileButton>
    </Stack></Paper>
    {file && <Group justify="space-between" wrap="wrap">
      <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{file.name} · {new Intl.NumberFormat(i18n.language).format(file.size)} B</Text>
      <Button variant="subtle" size="compact-sm" disabled={disabled} onClick={() => { onChange(null); reset.current?.() }}>{t('referral.fhir.remove')}</Button>
    </Group>}
    {error && <Text size="sm" c="red" role="alert">{t(error)}</Text>}
  </Stack>
}

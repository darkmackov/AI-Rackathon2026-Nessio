import ActionIcon from '../../../components/ActionIconButton'
import { Badge, Button, CloseButton, Group, Loader, Paper, Popover, Stack, Text, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useQuery } from '@tanstack/react-query'
import { IconArrowRight, IconFileText, IconSearch } from '@tabler/icons-react'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../../api'
import { listDocumentsOptions } from '../../../client/@tanstack/react-query.gen'
import { apiMode } from '../../../config'
import { EmptyState, QueryError } from '../../../components/DataState'
import { terminalJob } from '../../../components/documents/document-utils'
import SourcePanel from '../../../components/handover/SourcePanel'
import { useSession } from '../../../session'
import { useAskCase } from './use-ask-case'

function Search({ caseId, actorId }: { caseId: string; actorId: string }) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const resultPanel = useRef<HTMLDivElement>(null)
  const resultId = useId()
  const [opened, setOpened] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [sourceIndex, setSourceIndex] = useState<number | null>(null)
  const form = useForm({ initialValues: { question: '' }, validateInputOnBlur: true, validate: { question: (value) => value.trim() ? null : t('s8.required') } })
  const { create, job, options } = useAskCase(caseId, actorId, jobId)
  const documents = useQuery(listDocumentsOptions({ path: { case_id: caseId }, headers: actorHeaders(actorId) }))
  const current = job.data
  const processing = !!jobId && !job.isError && (!current || !terminalJob(current))
  const busy = create.isPending || processing
  const answer = current?.answer
  const evidence = sourceIndex === null ? undefined : answer?.quotes?.[sourceIndex]
  const document = documents.data?.find((item) => item.id === evidence?.document_id)
  const close = () => { setOpened(false); input.current?.focus() }
  const send = (question: string) => {
    setOpened(true)
    setJobId(null)
    setSourceIndex(null)
    create.mutate({ ...options, body: { question } }, { onSuccess: (value) => setJobId(value.id) })
  }
  const retry = () => {
    const question = answer?.question ?? current?.params?.question ?? create.variables?.body.question
    if (typeof question === 'string') send(question)
  }
  return <>
    <Popover opened={opened} onChange={setOpened} position="bottom-end" width={440} shadow="md" withinPortal zIndex={310} returnFocus={false} withRoles={false}
      preventPositionChangeWhenVisible={false} middlewares={{
        size: {
          padding: 12, apply: ({ availableHeight, elements }) => {
            elements.floating.style.maxHeight = `${Math.max(0, Math.min(446, availableHeight))}px`
          }
        }
      }}>
      <Popover.Target>
        <form noValidate onSubmit={form.onSubmit(({ question }) => { if (!busy) send(question.trim()) })}>
          <TextInput ref={input} label={t('s8.ask')} placeholder={t('s8.placeholder')} size="sm" aria-haspopup="dialog" aria-expanded={opened} aria-controls={opened ? resultId : undefined} aria-keyshortcuts="ArrowDown"
            leftSection={<IconSearch size={16} aria-hidden />} rightSectionWidth={36}
            {...form.getInputProps('question')} onClick={() => { if (jobId || create.isError || create.isPending) setOpened(true) }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') close()
              if (event.key === 'ArrowDown' && opened) { event.preventDefault(); resultPanel.current?.querySelector<HTMLButtonElement>('button')?.focus() }
            }}
            rightSection={<ActionIcon type="submit" variant="subtle" aria-label={t('s8.submit')} pending={busy} size={28}><IconArrowRight size={16} aria-hidden /></ActionIcon>} />
        </form>
      </Popover.Target>
      <Popover.Dropdown ref={resultPanel} id={resultId} role="dialog" aria-label={t('s8.answer')} maw="calc(100vw - 24px)" p="sm" style={{ overflowY: 'auto' }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close() } }}>
        <Stack gap="sm">
          <Group justify="space-between" wrap="nowrap"><Text fw={600} size="sm">{t('s8.answer')}</Text><CloseButton aria-label={t('s8.closeAnswer')} onClick={close} /></Group>
          <Text size="xs" c="dimmed">{t('s8.help')}</Text>
          {apiMode === 'mock' && <Text size="xs" c="dimmed">{t('s8.demo')}</Text>}
          {typeof current?.params?.question === 'string' && <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>{current.params.question}</Text>}
          {busy && <Group gap="xs" role="status"><Loader size="xs" /><Text size="sm">{t(`documents.jobStatus.${current?.status ?? 'queued'}`)}</Text></Group>}
          {create.isError && <QueryError error={create.error} retry={retry} pending={create.isPending} />}
          {jobId && job.isError && <QueryError error={job.error} retry={() => { void job.refetch() }} pending={job.isFetching} />}
          {current?.status === 'failed' && <Button size="compact-sm" variant="outline" onClick={retry}>{t('s8.retryAsk')}</Button>}
          {current?.status === 'done' && (answer?.found === false ? <EmptyState title={t('s8.notFound')} />
            : answer?.found && !!answer.quotes?.length ? <Stack gap="xs" aria-live="polite">
              <Badge variant="light" color="violet" size="sm">{t('caseDetail.ai')}</Badge>
              {answer.quotes.map((quote, index) => {
                const name = documents.data?.find((item) => item.id === quote.document_id)?.title ?? documents.data?.find((item) => item.id === quote.document_id)?.filename ?? t('unavailable')
                return <Paper key={`${quote.document_id}-${index}`} withBorder p="xs"><Stack gap="xs">
                  <Text component="blockquote" m={0} size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{quote.quote}</Text>
                  <Button size="compact-sm" variant="light" leftSection={<IconFileText size={14} aria-hidden />} aria-label={t('s8.showSource', { document: name })}
                    onClick={() => { setOpened(false); setSourceIndex(index) }} styles={{ label: { whiteSpace: 'normal', overflowWrap: 'anywhere' } }}>{name}</Button>
                </Stack></Paper>
              })}
            </Stack> : <Button size="compact-sm" variant="outline" onClick={retry}>{t('s8.retryAsk')}</Button>)}
        </Stack>
      </Popover.Dropdown>
    </Popover>
    {sourceIndex !== null && <SourcePanel forceDrawer document={document} evidence={evidence} close={() => { setSourceIndex(null); input.current?.focus() }}
      fallback={documents.isError ? <QueryError error={documents.error} retry={() => { void documents.refetch() }} /> : documents.isPending ? <Loader size="sm" /> : undefined} />}
  </>
}

export default function AskCaseSearch({ caseId }: { caseId: string }) {
  const { actorId } = useSession()
  return <Search key={`${actorId}:${caseId}`} caseId={caseId} actorId={actorId ?? ''} />
}

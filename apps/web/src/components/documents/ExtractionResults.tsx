import { Accordion, Badge, Button, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError, actorHeaders } from '../../api'
import { getHandoverOptions, listActorsOptions, listFindingsOptions } from '../../client/@tanstack/react-query.gen'
import type { Actor, DocumentMeta, Evidence, Handover, Origin, Stamp } from '../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../DataState'
import { formatDateTime } from '../../time'
import { formatDocumentDate, type SourcedValue, type SourceSelection } from './document-utils'

type SourceProps = { documents: DocumentMeta[]; onSource: (selection: SourceSelection) => void }

function EvidenceLinks({ evidence, documents, onSource }: SourceProps & { evidence?: Evidence[] }) {
  const { t } = useTranslation()
  return <Stack gap="xs">{evidence?.map((item, index) => <div key={`${item.document_id}-${index}`}>
    <Button variant="subtle" size="compact-sm" style={{ height: 'auto', minHeight: 28 }} styles={{ label: { whiteSpace: 'normal', textAlign: 'left', overflowWrap: 'anywhere' } }}
      onClick={() => onSource({ documentId: item.document_id, evidence: item })}>
      {t('documents.source')}: {documents.find((document) => document.id === item.document_id)?.filename ?? item.document_id}
    </Button>
    <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{item.quote}</Text>
  </div>)}</Stack>
}

function Provenance({ origin, entered, actors }: { origin?: Origin; entered?: Stamp | null; actors: Actor[] }) {
  const { t, i18n } = useTranslation()
  return <Group gap="xs">
    <Badge color="gray" variant="outline">{origin ? t(`documents.origins.${origin}`) : t('documents.originUnknown')}</Badge>
    {entered && <Text size="xs">{t('documents.enteredBy', { name: actors.find((actor) => actor.id === entered.by)?.name ?? entered.by, date: formatDateTime(entered.at, i18n.language) })}</Text>}
  </Group>
}

function SourcedField({ label, sourced, date = false, actors, ...sources }: SourceProps & { label: string; sourced?: SourcedValue; date?: boolean; actors: Actor[] }) {
  const { t, i18n } = useTranslation()
  const value = sourced?.value
  const empty = value === '' || (Array.isArray(value) && value.length === 0)
  return <Paper withBorder p="sm">
    <Stack gap="xs">
      <Group justify="space-between"><Text fw={600} size="sm">{label}</Text>
        <Badge variant="light" color={sourced?.status === 'conflict' ? 'yellow' : sourced?.status === 'found' ? 'blue' : 'gray'}>
          {t(`documents.fieldStatus.${sourced?.status ?? 'missing'}`)}
        </Badge>
      </Group>
      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{value == null ? t('documents.missingValue') : empty ? t('documents.emptyValue') : Array.isArray(value) ? value.join('\n') : date && typeof value === 'string' ? formatDocumentDate(value, i18n.language) : String(value)}</Text>
      <Provenance origin={sourced?.origin} entered={sourced?.entered} actors={actors} />
      {sourced?.note && <Text size="sm">{sourced.note}</Text>}
      <EvidenceLinks evidence={sourced?.evidence} {...sources} />
    </Stack>
  </Paper>
}

function HandoverView({ handover, actors, ...sources }: SourceProps & { handover: Handover; actors: Actor[] }) {
  const { t, i18n } = useTranslation()
  const patientFields = ['first_name', 'last_name', 'birth_number', 'birth_date', 'age', 'sex', 'insurance_code', 'address'] satisfies Array<keyof NonNullable<Handover['patient']>>
  const contactFields = ['patient_phone', 'patient_email', 'contact_person', 'contact_person_phone'] satisfies Array<keyof NonNullable<Handover['contacts']>>
  const clinicalFields = ['diagnosis', 'diagnosis_code', 'epicrisis_source', 'epicrisis', 'mdt_question', 'comorbidities', 'medications', 'allergies', 'performance_status', 'weight_kg', 'height_cm', 'symptoms', 'histology', 'other'] satisfies Array<keyof Handover>
  return <Stack>
    <Text size="sm">{t('documents.asOf', { date: formatDocumentDate(handover.as_of, i18n.language) })}</Text>
    {handover.validated_by_referrer && <Text size="sm">{t('documents.validatedBy', { name: actors.find((actor) => actor.id === handover.validated_by_referrer?.by)?.name ?? handover.validated_by_referrer.by, date: formatDateTime(handover.validated_by_referrer.at, i18n.language) })}</Text>}
    {handover.confirmed_by_coordinator && <Text size="sm">{t('documents.confirmedBy', { name: actors.find((actor) => actor.id === handover.confirmed_by_coordinator?.by)?.name ?? handover.confirmed_by_coordinator.by, date: formatDateTime(handover.confirmed_by_coordinator.at, i18n.language) })}</Text>}
    <Accordion multiple>
      <Accordion.Item value="patient"><Accordion.Control>{t('documents.patient')}</Accordion.Control><Accordion.Panel>
        <Stack gap="sm">{patientFields.map((key) => <SourcedField key={key} label={t(`documents.fields.${key}`)} sourced={handover.patient?.[key]} date={key === 'birth_date'} actors={actors} {...sources} />)}</Stack>
      </Accordion.Panel></Accordion.Item>
      <Accordion.Item value="contacts"><Accordion.Control>{t('documents.contacts')}</Accordion.Control><Accordion.Panel>
        <Stack gap="sm">{contactFields.map((key) => <SourcedField key={key} label={t(`documents.fields.${key}`)} sourced={handover.contacts?.[key]} actors={actors} {...sources} />)}</Stack>
      </Accordion.Panel></Accordion.Item>
      <Accordion.Item value="clinical"><Accordion.Control>{t('documents.clinical')}</Accordion.Control><Accordion.Panel>
        <Stack gap="sm">{clinicalFields.map((key) => <SourcedField key={key} label={t(`documents.fields.${key}`)} sourced={handover[key]} actors={actors} {...sources} />)}</Stack>
      </Accordion.Panel></Accordion.Item>
      <Accordion.Item value="examinations"><Accordion.Control>{t('documents.examinations')}</Accordion.Control><Accordion.Panel>
        <Stack gap="sm">{!handover.examinations?.length && <EmptyState title={t('documents.noExaminations')} />}
          {handover.examinations?.map((exam, index) => <Paper withBorder p="sm" key={index}><Stack gap="xs">
            <Text fw={600}>{exam.type} · {formatDocumentDate(exam.date, i18n.language)} · {exam.place}</Text>
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{exam.result_full_text}</Text>
            <Provenance origin={exam.origin} entered={exam.entered} actors={actors} />
            <EvidenceLinks evidence={exam.evidence} {...sources} />
          </Stack></Paper>)}
        </Stack>
      </Accordion.Panel></Accordion.Item>
      <Accordion.Item value="labs"><Accordion.Control>{t('documents.labs')}</Accordion.Control><Accordion.Panel>
        <Stack gap="sm">{!handover.labs?.length && <EmptyState title={t('documents.noLabs')} />}
          {handover.labs?.map((lab, index) => <Paper withBorder p="sm" key={index}><Stack gap="xs">
            <Text fw={600}>{formatDocumentDate(lab.date, i18n.language)} · {lab.place}</Text>
            {lab.values.map((item, itemIndex) => <Text size="sm" key={itemIndex}>{item.name}: {item.value} {item.unit} {item.reference_range && `(${item.reference_range})`} {item.flag}</Text>)}
            <Provenance origin={lab.origin} entered={lab.entered} actors={actors} />
            <EvidenceLinks evidence={lab.evidence} {...sources} />
          </Stack></Paper>)}
        </Stack>
      </Accordion.Panel></Accordion.Item>
    </Accordion>
  </Stack>
}

export default function ExtractionResults({ caseId, actorId, ...sources }: SourceProps & { caseId: string; actorId: string }) {
  const { t } = useTranslation()
  const options = { headers: actorHeaders(actorId), path: { case_id: caseId } }
  const handover = useQuery(getHandoverOptions(options))
  const findings = useQuery(listFindingsOptions(options))
  const actors = useQuery(listActorsOptions())
  const noHandover = handover.error instanceof ApiError && handover.error.status === 404
  return <Stack gap="lg">
    <Stack component="section" gap="sm" aria-label={t('documents.findings')}>
      <Title order={3} size="h4">{t('documents.findings')}</Title>
      {findings.isPending && <LoadingState />}
      {findings.isError && <QueryError error={findings.error} retry={() => { void findings.refetch() }} />}
      {findings.isSuccess && (!findings.data.length ? <EmptyState title={t('documents.noFindings')} /> : findings.data.map((finding) => <Paper withBorder p="sm" key={finding.id}>
        <Stack gap="xs">
          <Group gap="xs"><Badge color={finding.severity === 'blocker' ? 'red' : finding.severity === 'warning' ? 'yellow' : 'blue'} variant="light">
            {finding.severity === 'info' ? 'ⓘ' : '⚠'} {t(`documents.severity.${finding.severity}`)}
          </Badge><Badge color="gray" variant="outline">{t(`documents.findingKind.${finding.kind}`)}</Badge>
            {finding.advisory && <Badge color="gray">{t('documents.advisory')}</Badge>}
            {finding.resolved && <Badge color="green">{t('documents.resolved')}</Badge>}
          </Group>
          <Text size="sm">{finding.message_cs}</Text>
          {finding.resolution?.note && <Text size="sm">{finding.resolution.note}</Text>}
          <EvidenceLinks evidence={finding.evidence} {...sources} />
        </Stack>
      </Paper>))}
    </Stack>
    <Stack component="section" gap="sm" aria-label={t('documents.handover')}>
      <Title order={3} size="h4">{t('documents.handover')}</Title>
      <Text size="sm" c="dimmed">{t('documents.reviewHelp')}</Text>
      {handover.isPending && <LoadingState />}
      {noHandover && <EmptyState title={t('documents.noHandover')} />}
      {handover.isError && !noHandover && <QueryError error={handover.error} retry={() => { void handover.refetch() }} />}
      {actors.isPending && <LoadingState />}
      {actors.isError && <QueryError error={actors.error} retry={() => { void actors.refetch() }} />}
      {handover.data && <HandoverView handover={handover.data} actors={actors.data ?? []} {...sources} />}
    </Stack>
  </Stack>
}

import { actors, boards, organizations } from './directory'

// Audit detail is Czech product data, like notes, rather than UI translation keys. It mirrors the
// backend's apps/api/src/onko_api/audit_text.py, so the audit tab reads the same in mock and real mode (Q-W15).
const states: Record<string, string> = {
  koncept: 'Koncept', odeslano: 'Odesláno', v_triage: 'V triage', ceka_na_podklady: 'Čeká na podklady', kompletni: 'Kompletní',
  pripraveno_k_mdt: 'Připraveno k MDT', zaver_mdt: 'Závěr KOC / MDT', zpetna_vazba_odeslana: 'Zpětná vazba odeslána', uzavreno: 'Uzavřeno', vraceno_lekari: 'Vráceno lékaři',
}
export const resolutions: Record<string, string> = { resolved: 'Doplněno / vyřešeno', overridden: 'Překonáno s poznámkou', dismissed: 'Zamítnuto' }
export const conclusionSources: Record<string, string> = { written: 'Zapsáno v aplikaci', uploaded: 'Nahraný závěr' }

// Case, milestone and task fields, in the order the backend's request bodies declare them.
export const labels: Record<string, string> = {
  priority: 'Priorita', coordinator_id: 'Koordinátor', mdt_board_id: 'MDT tým', mdt_date: 'Plánované MDT',
  symptom_onset: 'Začátek obtíží', treatment_start: 'Zahájení léčby',
  title: 'Název', status: 'Stav', location: 'Místo', due: 'Termín', depends_on: 'Předchozí úkoly', external: 'Mimo KOC',
  result_document_id: 'Výsledný dokument', owner: 'Odpovědnost',
}
export const documentLabels: Record<string, string> = {
  title: 'Název dokumentu', doc_type: 'Typ dokumentu', document_date: 'Datum dokumentu', facility: 'Pracoviště',
  department: 'Oddělení', author: 'Autor', ordered_by: 'Indikující / odesílající lékař',
}
export const mdtRecordLabels: Record<string, string> = {
  members: 'Členové MDT', results: 'Výsledky stávajících vyšetření', mdt_question: 'Otázka na MDT',
  diagnosis_name: 'Název diagnózy', diagnosis_code: 'Kód diagnózy (MKN-10)', comorbidities: 'Komorbidity',
}
export const handoverLabels: Record<string, string> = {
  'patient.first_name': 'Jméno', 'patient.last_name': 'Příjmení', 'patient.birth_number': 'Rodné číslo', 'patient.birth_date': 'Datum narození',
  'patient.age': 'Věk', 'patient.sex': 'Pohlaví', 'patient.insurance_code': 'Zdravotní pojišťovna', 'patient.address': 'Adresa',
  'contacts.patient_phone': 'Telefon pacienta', 'contacts.patient_email': 'E-mail pacienta', 'contacts.contact_person': 'Kontaktní osoba',
  'contacts.contact_person_phone': 'Telefon kontaktní osoby', diagnosis: 'Diagnóza', diagnosis_code: 'MKN-10',
  epicrisis_source: 'Epikríza odesílajícího lékaře', epicrisis: 'Souhrn epikrízy', mdt_question: 'Otázka na MDT', comorbidities: 'Komorbidity (OA)',
  medications: 'Léková anamnéza (FA)', allergies: 'Alergie (AA)', performance_status: 'Stav výkonnosti', weight_kg: 'Hmotnost (kg)',
  height_cm: 'Výška (cm)', symptoms: 'Příznaky a jejich počátek', histology: 'Histologie', other: 'Další sdělení',
}
const values: Record<string, Record<string, string>> = {
  priority: { normal: 'Běžná', high: 'Vysoká', urgent: 'Urgentní' },
  status: { planned: 'Plánováno', booked: 'Objednáno', done: 'Dokončeno', cancelled: 'Zrušeno' },
  doc_type: { referral: 'Žádanka', epicrisis: 'Epikríza', outpatient_report: 'Ambulantní zpráva', lab: 'Laboratorní výsledek', imaging: 'Zobrazovací vyšetření',
    procedure: 'Výkon', histology: 'Histologie', mdt_record: 'Zápis MDT', mdt_conclusion: 'Závěr MDT', other: 'Jiný dokument' },
}
// Fields holding directory, task or document ids, shown by name.
const idFields = ['coordinator_id', 'mdt_board_id', 'owner', 'depends_on', 'result_document_id']
const unchanged = 'beze změny'

/** People, organizations and MDT boards by id, plus whatever the caller adds (a case's tasks and documents). */
export function directoryNames(extra: Record<string, string> = {}): Record<string, string> {
  return { ...Object.fromEntries([...organizations, ...boards, ...actors].map((item) => [item.id, item.name])), ...extra }
}

/** `22. 10. 2026`, or `24. 10. 2026 10:00` for a local datetime. */
export function auditDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value)
  if (!match) return value
  const [, year, month, day, hour, minute] = match
  const text = `${Number(day)}. ${Number(month)}. ${year}`
  return hour === undefined ? text : `${text} ${Number(hour)}:${minute}`
}

/** `Kompletní → Připraveno k MDT`. */
export function transition(before: string | null | undefined, after: string | null | undefined): string {
  const state = (value: string | null | undefined) => value ? states[value] ?? value : 'neuvedeno'
  return `${state(before)} → ${state(after)}`
}

export const withNote = (text: string, note: string | null | undefined) => note ? `${text}: ${note}` : text
export const quoted = (text: string) => `„${text}“`

/** `Priorita: Vysoká, Plánované MDT: 22. 10. 2026` for the given fields, in the given order. */
export function changed(changes: Record<string, unknown>, order: readonly string[], names: Record<string, string> = {}, table = labels): string {
  return order.filter((key) => key in changes).map((key) => `${table[key] ?? key}: ${value(key, changes[key], names)}`).join(', ') || unchanged
}

/** The changed fields' labels: `Členové MDT, Komorbidity`. */
export function fields(keys: readonly string[], table: Record<string, string>): string {
  return keys.map((key) => table[key] ?? key).join(', ') || unchanged
}

function value(key: string, item: unknown, names: Record<string, string>): string {
  if (item == null) return 'neuvedeno'
  if (typeof item === 'boolean') return item ? 'Ano' : 'Ne'
  if (Array.isArray(item)) return item.map((entry) => value(key, entry, names)).join(', ') || 'žádné'
  const text = String(item)
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return auditDate(text)
  if (idFields.includes(key)) return names[text] ?? text
  return values[key]?.[text] ?? text
}

import { useQuery } from '@tanstack/react-query'

import { listCasesOptions } from '../client/@tanstack/react-query.gen'
import type { Case, QueueColumn } from '../client/types.gen'

// Placeholder coordinator dashboard (slide 9): proves web -> api wiring with the seeded reference case.
// Data comes from the generated TanStack Query options, typed with the API's models.

const COLUMNS: { key: QueueColumn; label: string }[] = [
  { key: 'novy', label: 'Nový pacient' },
  { key: 'aktivni', label: 'Aktivní pacient' },
  { key: 'odlozeny', label: 'Odložený pacient' },
]

function CaseCard({ item }: { item: Case }) {
  return (
    <article style={{ background: '#fff', borderRadius: 8, padding: 12 }}>
      <strong>{item.patient_name}</strong>
      <div>{item.diagnosis_label}</div>
      <div>Stav: {item.state}</div>
      <div>
        Další krok: {item.next_step} ({item.on_move}
        {item.next_due ? `, do ${new Date(item.next_due).toLocaleDateString('cs-CZ')}` : ''})
      </div>
    </article>
  )
}

export default function CoordinatorDashboard() {
  const cases = useQuery(listCasesOptions())

  return (
    <main style={{ padding: 24 }}>
      <h1>Pracovní fronta koordinátora</h1>
      {cases.isPending && <p role="status">Načítám…</p>}
      {cases.isError && <p role="alert">API nedostupné: {String(cases.error)}</p>}
      {cases.isSuccess && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {COLUMNS.map((col) => (
            <section key={col.key} aria-labelledby={`col-${col.key}`}>
              <h2 id={`col-${col.key}`}>{col.label}</h2>
              {cases.data
                .filter((c) => c.queue === col.key)
                .map((c) => (
                  <CaseCard key={c.id} item={c} />
                ))}
            </section>
          ))}
        </div>
      )}
    </main>
  )
}

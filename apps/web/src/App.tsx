import { useEffect, useState } from 'react'

import { client } from './client/client.gen'
import { listCases } from './client/sdk.gen'
import type { Case, QueueColumn } from './client/types.gen'

// Placeholder coordinator dashboard (slide 9): proves web -> api wiring with the seeded reference case.
// Types and calls come from the generated client (npm run gen:api). Vite proxies /api to FastAPI.
client.setConfig({ baseUrl: '/api' })

const COLUMNS: { key: QueueColumn; label: string }[] = [
  { key: 'novy', label: 'Nový pacient' },
  { key: 'aktivni', label: 'Aktivní pacient' },
  { key: 'odlozeny', label: 'Odložený pacient' },
]

export default function App() {
  const [cases, setCases] = useState<Case[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listCases().then(({ data, error }) => (data ? setCases(data) : setError(String(error ?? 'unknown'))))
  }, [])

  return (
    <main style={{ padding: 24 }}>
      <h1>Pracovní fronta koordinátora</h1>
      {error && <p role="alert">API nedostupné: {error}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {COLUMNS.map((col) => (
          <section key={col.key}>
            <h2>{col.label}</h2>
            {cases
              .filter((c) => c.queue === col.key)
              .map((c) => (
                <article key={c.id} style={{ background: '#fff', borderRadius: 8, padding: 12 }}>
                  <strong>{c.patient_name}</strong>
                  <div>{c.diagnosis_label}</div>
                  <div>Stav: {c.state}</div>
                  <div>
                    Další krok: {c.next_step} ({c.on_move}
                    {c.next_due ? `, do ${new Date(c.next_due).toLocaleDateString('cs-CZ')}` : ''})
                  </div>
                </article>
              ))}
          </section>
        ))}
      </div>
    </main>
  )
}

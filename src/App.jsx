import { useState } from 'react'
import Stepper from './components/Stepper'
import StepConnect from './components/StepConnect'
import StepMap from './components/StepMap'
import StepReview from './components/StepReview'
import StepCommit from './components/StepCommit'
import { TABLE_ORDER } from './lib/sync'

function emptyTable(name) {
  return {
    name,
    enabled: true,
    tableId: '',
    fields: [],
    primaryFieldId: '',
    linkedTableInfo: {},
    slots: {},
    autoCreate: { unit: true, position: true, contact: false },
    connected: false,
  }
}

function initialPlan() {
  return {
    tables: {
      contacts: emptyTable('Contacts'),
      units: emptyTable('Units'),
      positions: emptyTable('Positions'),
      assignments: emptyTable('Contact Assignments'),
    },
  }
}

export default function App() {
  const [step, setStep] = useState(1)
  const [token, setToken] = useState('')
  const [plan, setPlan] = useState(initialPlan)

  const [csvHeaders, setCsvHeaders] = useState([])
  const [csvRows, setCsvRows] = useState([])
  const [roleByHeader, setRoleByHeader] = useState({})

  const [diffs, setDiffs] = useState(null)

  const updateTable = (tableKey, changes) => {
    setPlan((prev) => ({
      ...prev,
      tables: { ...prev.tables, [tableKey]: { ...prev.tables[tableKey], ...changes } },
    }))
  }

  const activeTableKeys = TABLE_ORDER.filter((k) => plan.tables[k].enabled && plan.tables[k].tableId)
  const connectedKeys = activeTableKeys.filter((k) => plan.tables[k].connected)

  const canStep2 = connectedKeys.length > 0
  const keySlotsReady = connectedKeys.every((k) => {
    if (k === 'assignments') {
      const s = plan.tables[k].slots
      return s.contact && s.position
    }
    return Boolean(plan.tables[k].slots.name || plan.tables[k].slots.email)
  })
  const canStep3 = csvHeaders.length > 0 && keySlotsReady
  const canStep4 = Boolean(diffs)

  const nextDisabled =
    (step === 1 && !canStep2) || (step === 2 && !canStep3) || (step === 3 && !canStep4)

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">MergeRow</h1>
        <p className="text-sm text-gray-500 mb-6">
          Reconcile one denormalized roster CSV into your Baserow Contacts, Units, Positions and
          Assignments.
        </p>

        <div className="rounded-lg bg-white shadow-sm border border-gray-200 p-6">
          <Stepper currentStep={step} />

          {step === 1 && (
            <StepConnect
              token={token}
              setToken={setToken}
              plan={plan}
              updateTable={updateTable}
              roleByHeader={roleByHeader}
              setRoleByHeader={setRoleByHeader}
            />
          )}

          {step === 2 && (
            <StepMap
              plan={plan}
              updateTable={updateTable}
              csvHeaders={csvHeaders}
              csvRows={csvRows}
              roleByHeader={roleByHeader}
              onCsv={({ headers, rows, roles }) => {
                setCsvHeaders(headers)
                setCsvRows(rows)
                setRoleByHeader(roles)
              }}
              setRoleByHeader={setRoleByHeader}
            />
          )}

          {step === 3 && (
            <StepReview
              token={token}
              plan={plan}
              csvRows={csvRows}
              roleByHeader={roleByHeader}
              diffs={diffs}
              setDiffs={setDiffs}
            />
          )}

          {step === 4 && <StepCommit token={token} plan={plan} diffs={diffs} />}

          <div className="mt-8 flex justify-between border-t border-gray-100 pt-4">
            <button
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
              className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40"
            >
              Back
            </button>
            {step < 4 && (
              <button
                onClick={() => setStep((s) => Math.min(4, s + 1))}
                disabled={nextDisabled}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

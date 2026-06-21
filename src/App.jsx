import { useState } from 'react'
import Stepper from './components/Stepper'
import StepConnect from './components/StepConnect'
import StepUploadMap from './components/StepUploadMap'
import StepDiff from './components/StepDiff'
import StepCommit from './components/StepCommit'

export default function App() {
  const [step, setStep] = useState(1)

  // Step 1
  const [token, setToken] = useState('')
  const [tableId, setTableId] = useState('')
  const [fields, setFields] = useState([])
  const [linkedTableInfo, setLinkedTableInfo] = useState({})

  // Step 2
  const [csvHeaders, setCsvHeaders] = useState([])
  const [csvRows, setCsvRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [matchKeyFieldId, setMatchKeyFieldId] = useState('')

  // Step 3
  const [diffRows, setDiffRows] = useState([])

  const canGoToStep2 = fields.length > 0
  const canGoToStep3 = csvHeaders.length > 0 && Boolean(matchKeyFieldId)
  const canGoToStep4 = diffRows.length > 0

  const goNext = () => setStep((s) => Math.min(4, s + 1))
  const goBack = () => setStep((s) => Math.max(1, s - 1))

  const nextDisabled =
    (step === 1 && !canGoToStep2) || (step === 2 && !canGoToStep3) || (step === 3 && !canGoToStep4)

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">MergeRow</h1>
        <p className="text-sm text-gray-500 mb-6">Sync a CSV file into a Baserow table.</p>

        <div className="rounded-lg bg-white shadow-sm border border-gray-200 p-6">
          <Stepper currentStep={step} />

          {step === 1 && (
            <StepConnect
              token={token}
              tableId={tableId}
              onChange={(changes) => {
                if ('token' in changes) setToken(changes.token)
                if ('tableId' in changes) setTableId(changes.tableId)
              }}
              onConnected={({ fields: fieldList, linkedTableInfo: info }) => {
                setFields(fieldList)
                setLinkedTableInfo(info || {})
              }}
            />
          )}

          {step === 2 && (
            <StepUploadMap
              fields={fields}
              linkedTableInfo={linkedTableInfo}
              csvHeaders={csvHeaders}
              csvRows={csvRows}
              mapping={mapping}
              matchKeyFieldId={matchKeyFieldId}
              onChange={(changes) => {
                if ('csvHeaders' in changes) setCsvHeaders(changes.csvHeaders)
                if ('csvRows' in changes) setCsvRows(changes.csvRows)
                if ('mapping' in changes) setMapping(changes.mapping)
                if ('matchKeyFieldId' in changes) setMatchKeyFieldId(changes.matchKeyFieldId)
              }}
            />
          )}

          {step === 3 && (
            <StepDiff
              token={token}
              tableId={tableId}
              fields={fields}
              mapping={mapping}
              matchKeyFieldId={matchKeyFieldId}
              csvRows={csvRows}
              diffRows={diffRows}
              setDiffRows={setDiffRows}
            />
          )}

          {step === 4 && (
            <StepCommit token={token} tableId={tableId} diffRows={diffRows} />
          )}

          <div className="mt-8 flex justify-between border-t border-gray-100 pt-4">
            <button
              onClick={goBack}
              disabled={step === 1}
              className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40"
            >
              Back
            </button>
            {step < 4 && (
              <button
                onClick={goNext}
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

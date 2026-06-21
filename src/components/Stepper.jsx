const STEPS = ['Connect', 'Map', 'Review', 'Commit']

export default function Stepper({ currentStep }) {
  return (
    <ol className="flex items-center w-full mb-8">
      {STEPS.map((label, index) => {
        const stepNumber = index + 1
        const isActive = stepNumber === currentStep
        const isDone = stepNumber < currentStep
        return (
          <li key={label} className="flex-1 flex items-center">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  isDone
                    ? 'bg-emerald-600 text-white'
                    : isActive
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-500'
                }`}
              >
                {stepNumber}
              </span>
              <span className={`text-sm font-medium ${isActive ? 'text-gray-900' : 'text-gray-500'}`}>
                {label}
              </span>
            </div>
            {stepNumber !== STEPS.length && <div className="mx-3 h-px flex-1 bg-gray-200" />}
          </li>
        )
      })}
    </ol>
  )
}

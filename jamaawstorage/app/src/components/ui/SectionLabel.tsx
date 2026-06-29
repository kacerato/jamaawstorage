import { InfoTip } from './InfoTip'

interface SectionLabelProps {
  label: string
  info?: string
  className?: string
}

export function SectionLabel({ label, info, className = '' }: SectionLabelProps) {
  return (
    <div className={`mb-2 flex min-h-6 items-center gap-1.5 ${className}`}>
      <span className="text-sm font-medium leading-none text-gray-300">{label}</span>
      {info ? <InfoTip text={info} /> : null}
    </div>
  )
}

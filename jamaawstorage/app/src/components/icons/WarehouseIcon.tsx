interface IconProps {
  size?: number
  className?: string
}

export function WarehouseIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M2 10L12 3L22 10V21H2V10Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M6 21V14H18V21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 14V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M15 14V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M2 10H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 21V17.5C10 16.5 10.5 16 12 16C13.5 16 14 16.5 14 17.5V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

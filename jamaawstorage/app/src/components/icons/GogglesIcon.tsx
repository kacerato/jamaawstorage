interface IconProps {
  size?: number
  className?: string
}

export function GogglesIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M2 10C2 8 3 7 5 7H19C21 7 22 8 22 10V14C22 16 21 17 19 17H16C14.5 17 14 16 12 16C10 16 9.5 17 8 17H5C3 17 2 16 2 14V10Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 9.5C8 8.5 8.5 8 10 8H14C15.5 8 16 8.5 16 9.5V14.5C16 15.5 15.5 16 14 16H10C8.5 16 8 15.5 8 14.5V9.5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 10V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M21 10V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

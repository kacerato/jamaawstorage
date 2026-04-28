interface IconProps {
  size?: number
  className?: string
}

export function LogoIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M2 10L12 3L22 10V21H2V10Z" fill="#f97316" stroke="#030712" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6 21V13H18V21" fill="#f97316" stroke="#030712" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M2 10H22" stroke="#030712" strokeWidth="1.5" />
      <path d="M9.2 17.5V14.5H10L11.2 16.3L12.4 14.5H13.2V17.5H12.5V15.5L11.5 17H10.9L9.9 15.5V17.5H9.2Z" fill="#030712" />
      <path d="M14 17.5V14.5H14.7V16.8H16.2V14.5H16.9V17.5H14Z" fill="#030712" />
      <path d="M10 21V18.5H14V21" stroke="#030712" strokeWidth="1" />
    </svg>
  )
}

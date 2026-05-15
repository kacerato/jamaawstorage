import React from 'react'

interface IconProps {
  size?: number
  className?: string
}

export function DamagedConditionIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M8 22L11 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 3" />
      <path d="M4 20L10 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M11 9L15 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 10L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      
      <path d="M16 16L18 19L17 21L21 23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

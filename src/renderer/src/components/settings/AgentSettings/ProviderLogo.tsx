interface ProviderLogoProps {
  vendor: string
  size?: 'sm' | 'md' | 'lg'
}

const VENDOR_EMOJI: Record<string, string> = {
  Anthropic: '🅰',
  OpenAI: '🅾',
  Google: '🅖',
  Meta: 'Ⓜ️',
  Mistral: 'Ⓜ️',
  Cohere: 'Ⓒ',
  DeepSeek: 'Ⓓ',
}

export function ProviderLogo({ vendor, size = 'sm' }: ProviderLogoProps) {
  const emoji = VENDOR_EMOJI[vendor] ?? vendor.charAt(0).toUpperCase()
  const sizeClass = size === 'lg' ? 'w-6 h-6 text-sm' : size === 'md' ? 'w-5 h-5 text-xs' : 'w-4 h-4 text-[10px]'

  return (
    <span
      className={`inline-flex items-center justify-center rounded bg-secondary border border-border text-muted-foreground font-medium ${sizeClass}`}
      title={vendor}
    >
      {emoji}
    </span>
  )
}

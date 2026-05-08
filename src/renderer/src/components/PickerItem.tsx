interface PickerItemProps {
  icon: string
  name: string
  subtitle: string
  selected?: boolean
  variant?: 'agent' | 'team'
  onClick?: () => void
}

const VARIANT_STYLES = {
  agent: {
    selectedBorder: 'border-blue-500',
    dotColor: 'bg-blue-500'
  },
  team: {
    selectedBorder: 'border-amber-500',
    dotColor: 'bg-amber-500'
  }
} as const

export function PickerItem({
  icon,
  name,
  subtitle,
  selected = false,
  variant = 'agent',
  onClick
}: PickerItemProps) {
  const variantStyle = VARIANT_STYLES[variant]

  return (
    <button
      onClick={onClick}
      className={`
        group relative flex items-center h-12 overflow-hidden
        rounded-[14px] border bg-card cursor-pointer
        transition-all duration-300
        w-12 hover:w-[180px]
        ${selected ? variantStyle.selectedBorder : 'border-border hover:border-border'}
      `}
      style={{ transitionTimingFunction: 'cubic-bezier(.4,0,.2,1)' }}
    >
      <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center text-lg">
        {icon}
      </div>

      <div
        className={`
          flex flex-col items-start justify-center min-w-0 pr-3
          opacity-0 translate-x-2
          group-hover:opacity-100 group-hover:translate-x-0
          transition-all duration-300
        `}
        style={{ transitionTimingFunction: 'cubic-bezier(.4,0,.2,1)' }}
      >
        <span className="text-xs font-medium text-foreground truncate w-full text-left">
          {name}
        </span>
        <span className="text-[10px] text-muted-foreground truncate w-full text-left">
          {subtitle}
        </span>
      </div>

      {selected && (
        <span
          className={`absolute top-1 right-1 w-2 h-2 rounded-full ${variantStyle.dotColor}`}
        />
      )}
    </button>
  )
}

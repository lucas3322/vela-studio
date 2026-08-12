import type { SVGProps } from 'react'

/**
 * Ícones desenhados na grade de 16px com traço de 1.5.
 * Inline em vez de biblioteca: são poucos, e assim herdam `currentColor`
 * sem uma dependência de 400kB no bundle.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 16, children, ...props }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export const IconDatabase = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <ellipse cx="8" cy="3.5" rx="5.5" ry="2" />
    <path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9" />
    <path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
  </Icon>
)

export const IconTable = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M2 6h12M6.5 6v7.5" />
  </Icon>
)

/** Chevrons de código — marca a aba de query, como no editor. */
export const IconCode = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
  </Icon>
)

/**
 * Engrenagem de 8 dentes.
 *
 * O contorno é gerado por cálculo, não desenhado no olho: a primeira versão
 * era um círculo com raios saindo dele e ficava idêntica ao ícone de tema —
 * dois sóis lado a lado na barra de título.
 */
export const IconSettings = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M6.47 2.93L6.76 1.21L9.24 1.21L9.53 2.93L10.50 3.33L11.92 2.32L13.68 4.08L12.67 5.50L13.07 6.47L14.79 6.76L14.79 9.24L13.07 9.53L12.67 10.50L13.68 11.92L11.92 13.68L10.50 12.67L9.53 13.07L9.24 14.79L6.76 14.79L6.47 13.07L5.50 12.67L4.08 13.68L2.32 11.92L3.33 10.50L2.93 9.53L1.21 9.24L1.21 6.76L2.93 6.47L3.33 5.50L2.32 4.08L4.08 2.32L5.50 3.33Z" />
    <circle cx="8" cy="8" r="2.5" />
  </Icon>
)

export const IconView = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="1.8" />
  </Icon>
)

export const IconColumn = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M4 3v10M8 3v10M12 3v10" />
  </Icon>
)

export const IconKey = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="5" cy="10.5" r="2.5" />
    <path d="M6.8 8.7 12.5 3M10.5 5l1.5 1.5M12.5 3l1.5 1.5" />
  </Icon>
)

export const IconLink = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-1 1" />
    <path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l1-1" />
  </Icon>
)

export const IconPlay = (p: IconProps): React.JSX.Element => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="M4.5 3.2v9.6a.5.5 0 0 0 .77.42l7.3-4.8a.5.5 0 0 0 0-.84l-7.3-4.8a.5.5 0 0 0-.77.42Z" />
  </Icon>
)

export const IconStop = (p: IconProps): React.JSX.Element => (
  <Icon {...p} fill="currentColor" stroke="none">
    <rect x="4" y="4" width="8" height="8" rx="1.5" />
  </Icon>
)

export const IconPlus = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
)

export const IconClose = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
)

export const IconChevronRight = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </Icon>
)

export const IconChevronDown = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M3.5 6 8 10.5 12.5 6" />
  </Icon>
)

export const IconSearch = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14" />
  </Icon>
)

export const IconRefresh = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
    <path d="M13.5 2v3.2h-3.2" />
  </Icon>
)

export const IconSidebar = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M6.5 3v10" />
  </Icon>
)

export const IconHelp = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.3" />
    <circle cx="8" cy="11.6" r=".6" fill="currentColor" stroke="none" />
  </Icon>
)

export const IconHistory = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M2.6 8a5.4 5.4 0 1 0 1.7-3.9" />
    <path d="M2.5 2.4v3.2h3.2" />
    <path d="M8 5.2V8l2 1.4" />
  </Icon>
)

export const IconSun = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
  </Icon>
)

export const IconMoon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M13.2 9.3A5.6 5.6 0 0 1 6.7 2.8a5.6 5.6 0 1 0 6.5 6.5Z" />
  </Icon>
)

export const IconDownload = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M8 2.5v7.5M5 7.5 8 10.5l3-3" />
    <path d="M2.5 11v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V11" />
  </Icon>
)

export const IconWarning = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M7.1 2.6 1.7 12a1 1 0 0 0 .9 1.5h10.8a1 1 0 0 0 .9-1.5L8.9 2.6a1 1 0 0 0-1.8 0Z" />
    <path d="M8 6v3" />
    <circle cx="8" cy="11.2" r=".6" fill="currentColor" stroke="none" />
  </Icon>
)

export const IconCheck = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M3 8.5 6.2 11.7 13 5" />
  </Icon>
)

export const IconSparkle = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4Z" />
    <path d="M12.5 11.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5Z" />
  </Icon>
)

export const IconStructure = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="2" y="2.5" width="5" height="4" rx="1" />
    <rect x="9" y="9.5" width="5" height="4" rx="1" />
    <path d="M4.5 6.5v4a1 1 0 0 0 1 1H9" />
  </Icon>
)

export const IconTrash = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M2.5 4h11M6 4V2.8a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8V4" />
    <path d="M4 4v8.2a1.3 1.3 0 0 0 1.3 1.3h5.4A1.3 1.3 0 0 0 12 12.2V4" />
  </Icon>
)

export const IconEdit = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3L5.4 12.7l-3 .7.7-3Z" />
  </Icon>
)

export const IconLeaf = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M13.5 2.5c0 6-3.5 9.5-8 9.5-1.4 0-2.5-.4-2.5-.4s.4-6.4 5-8.2c2.2-.9 5.5-.9 5.5-.9Z" />
    <path d="M2.5 13.5c1.5-3 4-5 6.5-6" />
  </Icon>
)

export const IconCopy = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-1a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5V9a1.5 1.5 0 0 0 1.5 1.5h1" />
  </Icon>
)

export const IconEject = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M8 2.5 13 9H3l5-6.5Z" />
    <path d="M3 12.5h10" />
  </Icon>
)

/**
 * A marca do Vela: o mesmo veleiro do ícone do app, simplificado para 16px.
 * Sem o mastro e sem as linhas d'água — a esse tamanho viram sujeira.
 */
export const IconSail = (p: IconProps): React.JSX.Element => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="M8.6 1.6c1.9 3 2.8 5.7 2.8 8.2H8.6V1.6Z" />
    <path d="M7.4 3.6v6.2H4.9c.7-2 1.5-4 2.5-6.2Z" opacity="0.65" />
    <path d="M2.6 11.2h10.8c-.8 1.9-2.4 2.9-5.4 2.9s-4.6-1-5.4-2.9Z" />
  </Icon>
)

/** Olho fechado — par do IconView, para revelar/ocultar senha. */
export const IconViewOff = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M2.5 2.5l11 11" />
    <path d="M6.4 6.5a1.8 1.8 0 0 0 2.5 2.5" />
    <path d="M4.3 4.4C2.7 5.5 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.2 0 2.2-.3 3.1-.8" />
    <path d="M13.1 10c.9-1 1.4-2 1.4-2S12 3.5 8 3.5c-.6 0-1.1.1-1.6.2" />
  </Icon>
)

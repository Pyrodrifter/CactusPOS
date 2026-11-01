import type { ReactNode, SVGProps } from 'react';

const shapes = {
  monitor: <><rect x="3" y="3" width="18" height="13" rx="2" /><path d="M12 16v5M8 21h8" /></>,
  backspace: <><path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-7-7 7-7Z" /><path d="m12 9 6 6m0-6-6 6" /></>,
  sliders: <><path d="M4 7h5m4 0h7M4 17h9m4 0h3" /><circle cx="11" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></>,
  expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
  collapse: <path d="M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5" />,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  tabs: <><path d="M7 3h11a2 2 0 0 1 2 2v12M4 7h10a2 2 0 0 1 2 2v12l-3-2-3 2-3-2-3 2V7Z" /><path d="M7 11h6M7 15h4" /></>,
  chart: <><path d="M4 3v18h17M8 16v-5M13 16V7M18 16v-3" /></>,
  book: <><path d="M6 3h14v18H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM3 18a3 3 0 0 1 3-3h14" /><path d="M8 7h8M8 11h5" /></>,
  backup: <><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6M6 10v4M18 10v4" /></>,
  store: <><path d="M4 10v11h16V10M3 3h18l1 7a3 3 0 0 1-5 2 3 3 0 0 1-5 0 3 3 0 0 1-5 0 3 3 0 0 1-5-2l1-7Z" /><path d="M9 21v-6h6v6M7 3l-1 7M17 3l1 7" /></>,
  external: <><path d="M14 3h7v7m0-7L10 14" /><path d="M10 3H3v18h18v-7" /></>,
  sparkles: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4" /></>,
  undo: <path d="m8 4-5 5 5 5M3 9h10a6 6 0 0 1 0 12" />,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  cart: <><path d="m3 3 2 2 2 12h12l2-9H6" /><circle cx="9" cy="21" r="1" /><circle cx="18" cy="21" r="1" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 7h6M9 11h6M9 15h3" /></>,
  kitchen: <><path d="M6 13a4 4 0 1 1 1-7 5 5 0 0 1 10 0 4 4 0 1 1 1 7v7H6v-7Z" /><path d="M6 16h12" /></>,
  pickup: <><path d="M4 9h16l-1 12H5L4 9ZM8 9V7a4 4 0 0 1 8 0v2" /><path d="m9 15 2 2 4-4" /></>,
  settings: <><path d="m9 3-.5 3-2 1.2L4 6l-2 4 2.5 1.7v2.6L2 16l2 4 2.5-1.2 2 1.2.5 3h6l.5-3 2-1.2L20 20l2-4-2.5-1.7v-2.6L22 10l-2-4-2.5 1.2-2-1.2-.5-3H9Z" transform="translate(0 -1)" /><circle cx="12" cy="12" r="3" /></>,
  staff: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v2" /></>,
  tax: <><path d="m6 18 12-12" /><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /></>,
  logout: <><path d="M10 4H4v16h6M10 12h11m-4-4 4 4-4 4" /></>,
  language: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z" /></>,
  box: <><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z" /><path d="m3 8 9 5 9-5M12 13v8" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m4 12 5 5L20 6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  cash: <><rect x="2" y="5" width="20" height="14" rx="3" /><circle cx="12" cy="12" r="3" /><path d="M6 9v6M18 9v6" /></>,
  card: <><rect x="2" y="4" width="20" height="16" rx="3" /><path d="M2 9h20M6 15h4" /></>,
  send: <><path d="m3 10 18-7-7 18-4-7-7-4Z" /><path d="m10 14 11-11" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
  edit: <><path d="m4 16 12-12 4 4L8 20l-5 1 1-5ZM13 7l4 4" /></>,
  'arrow-left': <path d="m11 5-7 7 7 7M4 12h16" />,
  'arrow-right': <path d="m13 5 7 7-7 7M4 12h16" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  wifi: <><path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0" /><circle cx="12" cy="20" r="1" /></>,
  'wifi-off': <><path d="m3 3 18 18M2 8a16 16 0 0 1 5-3M11 4a16 16 0 0 1 11 4M5 12a11 11 0 0 1 6-2M16 10a11 11 0 0 1 3 2M8 16a6 6 0 0 1 8 0" /><circle cx="12" cy="20" r="1" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5M5.5 7a8 8 0 0 1 13-1l1.5 1M18.5 17a8 8 0 0 1-13 1L4 17" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2m-17-7 1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />,
  leaf: <><path d="M19 3C8 2 2 8 5 15c3 7 14 4 14-5V3Z" /><path d="M3 21 16 8" /></>,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  bell: <><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3ZM10 21h4" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  printer: <><path d="M6 8V3h12v5M6 16H3V8h18v8h-3M6 13h12v8H6v-8Z" /><path d="M17 10h1" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" /></>,
  warning: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5M12 17h.01" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
  upload: <><path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5" /></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof shapes;
export function Icon({ name, size = 22, label, className, ...props }: SVGProps<SVGSVGElement> & {
  name: IconName; size?: number; label?: string;
}) {
  return <svg className={`ui-icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true}
    role={label ? 'img' : undefined} aria-label={label} focusable="false" {...props}>{shapes[name]}</svg>;
}

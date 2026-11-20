type IconName = 'plus' | 'search' | 'copy' | 'chev' | 'clip' | 'close' | 'upload' | 'trash' | 'edit';

const PATHS: Record<IconName, string> = {
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 105.2 11.7L21 20',
  copy: 'M9 9h11v11H9zM5 15V5a2 2 0 012-2h10',
  chev: 'M9 6l6 6-6 6',
  clip: 'M4 6h16M4 12h10M4 18h7',
  close: 'M6 6l12 12M18 6L6 18',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3h16v-3',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M14.5 5.5l4 4M4 20l1-5 11-11 4 4-11 11-5 1z',
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

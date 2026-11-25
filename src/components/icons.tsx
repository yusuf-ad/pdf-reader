import type { SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export const CropIcon = () => (
  <Icon>
    <path d="M6 2v14a2 2 0 0 0 2 2h14" />
    <path d="M18 22V8a2 2 0 0 0-2-2H2" />
  </Icon>
);

export const PanelLeftIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M9 4v16" />
  </Icon>
);

export const PanelRightIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M15 4v16" />
  </Icon>
);

export const SplitIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M12 4v16M15.5 12h2.5M16.75 10.75v2.5" />
  </Icon>
);

export const ClosePaneIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="m9.5 9.5 5 5M14.5 9.5l-5 5" />
  </Icon>
);

export const SwapPanesIcon = () => (
  <Icon>
    <path d="M4 8h15M15.5 4.5 19 8l-3.5 3.5M20 16H5M8.5 12.5 5 16l3.5 3.5" />
  </Icon>
);

export const BookmarkIcon =({ filled }: { filled?: boolean }) => (
  <Icon fill={filled ? "currentColor" : "none"}>
    <path d="M6 3.5h12v17l-6-4.5-6 4.5z" />
  </Icon>
);

export const PagePlusIcon = () => (
  <Icon>
    <path d="M14 3H6v18h12V7z" />
    <path d="M14 3v4h4M12 11v6M9 14h6" />
  </Icon>
);

export const ImageIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m21 16-5-5-9 9" />
  </Icon>
);

export const FitWidthIcon = () => (
  <Icon>
    <path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" />
  </Icon>
);

export const FitPageIcon = () => (
  <Icon>
    <rect x="6" y="3" width="12" height="18" rx="1" />
  </Icon>
);

export const ExpandIcon = () => (
  <Icon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Icon>
);

export const KeyboardIcon = () => (
  <Icon>
    <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
  </Icon>
);

export const KeyIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="4.5" />
    <path d="m11.2 11.2 9.3 9.3M16 16l2.5-2.5M18.5 18.5l2.5-2.5" />
  </Icon>
);

export const PenIcon = () => (
  <Icon>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
    <path d="m14.5 5.5 3 3" />
  </Icon>
);

export const MarkerIcon = () => (
  <Icon>
    <path d="m14.5 4.5 5 5-7.5 7.5h-5v-5z" />
    <path d="M7 12 4.5 14.5V17h2.5L9.5 14.5" />
    <path d="M3.5 20.5h17" />
  </Icon>
);

export const TextIcon = () => (
  <Icon>
    <path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />
  </Icon>
);

export const EraserIcon = () => (
  <Icon>
    <path d="m7 20-3.3-3.3a1.5 1.5 0 0 1 0-2.1L13.6 4.7a1.5 1.5 0 0 1 2.1 0l4.6 4.6a1.5 1.5 0 0 1 0 2.1L11.7 20z" />
    <path d="M7 20h13M9 11.5l5.5 5.5" />
  </Icon>
);

export const NoteIcon = () => (
  <Icon>
    <path d="M5 4h14v10l-6 6H5z" />
    <path d="M19 14h-6v6" />
  </Icon>
);

export const ListIcon = () => (
  <Icon>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth="2.4" />
  </Icon>
);

export const NewNoteIcon = () => (
  <Icon>
    <path d="M11 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V13" />
    <path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" />
  </Icon>
);

export const PinIcon = ({ filled }: { filled?: boolean }) => (
  <Icon>
    <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z" fill={filled ? "currentColor" : "none"} />
    <path d="M12 14v6" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M10 7V4.5h4V7M6 7l1 13h10l1-13" />
    <path d="M10 11v5M14 11v5" />
  </Icon>
);

export const UndoIcon = () => (
  <Icon>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);

export const OcrIcon = () => (
  <Icon>
    <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
    <path d="M8 9h8M8 12h8M8 15h5" />
  </Icon>
);

export const SaveIcon = () => (
  <Icon>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4.5 16v2.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V16" />
  </Icon>
);

// Small line icons drawn for Studio 3D (no icon library). Decorative only: every button keeps its text label.
const PATHS = {
  new: "M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M12 11v6M9 14h6",
  open: "M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 11h18",
  save: "M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 3v5h7V3M8 21v-6h8v6",
  export: "M12 3v12M7 8l5-5 5 5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4",
  check: "M5 12.5l4.5 4.5L19 7.5",
  alert: "M12 8v5M12 16.5v.5M10.3 3.9L2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  close: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  pencil: "M4 20l4-1 11-11-3-3L5 16zM14 7l3 3",
  pointer: "M6 3l12 9-5 1 3 6-2 1-3-6-4 3z",
  rectangle: "M4 6h16v12H4z",
  circle: "M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z",
  polygon: "M5 18L8 5l11 4-3 9z",
  ruler: "M3 15l12-12 6 6-12 12zM7 11l2 2M10 8l2 2M13 5l2 2",
  hollow: "M4 6h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM8 6v10h8V6",
  face: "M3 9l7-4 7 4v6l-7 4-7-4zM3 9l7 4 7-4M10 13v6M15 21l1-3 5-5 2 2-5 5z",
  fillet: "M4 20V12a8 8 0 0 1 8-8h8",
  chamfer: "M4 20v-9l7-7h9",
  pattern: "M4 4h5v5H4zM15 4h5v5h-5zM4 15h5v5H4zM15 15h5v5h-5z",
  mirror: "M12 3v18M9 6L4 18h5zM15 6l5 12h-5z",
  box: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  cylinder: "M5 6a7 2.5 0 1 0 14 0a7 2.5 0 1 0-14 0M5 6v12a7 2.5 0 0 0 14 0V6",
  tube: "M5 6a7 2.5 0 1 0 14 0a7 2.5 0 1 0-14 0M9 6a3 1 0 1 0 6 0a3 1 0 1 0-6 0M5 6v12a7 2.5 0 0 0 14 0V6",
  cone: "M12 3L5 18a7 2.5 0 0 0 14 0z",
  sphere: "M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM4 12a8 3 0 0 0 16 0",
  hole: "M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  hexagon: "M7.5 4.2h9L21 12l-4.5 7.8h-9L3 12zM9.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0",
  revolve: "M12 2v20M5 9a7 3 0 0 0 14 0a7 3 0 0 0-10-2.7M9 3.8v2.6l2.6.4M7 12v6l5 2 5-2v-6",
  picture: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 8.5a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 1 0 0-2.4",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6",
  eyeOff: "M2 12s4-7 10-7c2 0 3.7.7 5.1 1.7M22 12s-4 7-10 7c-2 0-3.7-.7-5.1-1.7M4 20L20 4",
  fullScreen: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  exitFullScreen: "M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5",
  focus: "M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M9 12h6",
  sidePanel: "M4 5h16v14H4zM9 5v14",
  printer: "M5 4h14v4H5zM3 8h18v8H3zM7 16h10v4H7zM10 12h4M8 20v-4M16 20v-4",
  chevronUp: "M6 15l6-6 6 6",
  chevronDown: "M6 9l6 6 6-6",
  chevronLeft: "M15 6l-6 6 6 6",
  chevronRight: "M9 6l6 6-6 6",
  swap: "M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4",
  tree: "M5 4h5v4H5zM9 6h3v12h2M12 12h2M14 10h5v4h-5zM14 16h5v4h-5z",
  properties: "M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0M14 4v4M6 10v4M16 16v4",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  reset: "M4 4v6h6M4.5 10A8 8 0 1 1 6 17.5",
  floating: "M4 6h7v12H4zM14 6h6v6h-6z",
  palette:
    "M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 " +
    "5-5c0-4.3-4-7.7-9-7.7zM7.5 12.5h.01M9 8.5h.01M13.5 7h.01M17 10h.01",
  cube: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  command: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM7 9l3 3-3 3M12 15h5",
  edge: "M4 18L18 4M4 18h4M18 4v4",
  key: "M15 4a5 5 0 1 1-4.6 7L4 17.4V20h3v-2h2v-2h2l1.4-1.4A5 5 0 0 1 15 4zM16 8h.01",
  send: "M12 19V5M6 11l6-6 6 6",
  stop: "M8 8h8v8H8z",
  plate: "M6 9h15l-3 8H3zM3 17v1.5h15V17M18 18.5l3-8V9",
  grid: "M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16",
  background: "M4 4h16v16H4zM4 15l5-5 4 4 3-3 4 4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d={PATHS[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

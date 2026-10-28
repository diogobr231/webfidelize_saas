import type { SVGProps } from "react";

const paths = {
  camera: "M3 7h4l2-3h6l2 3h4v14H3V7Zm13 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  calendar:
    "M8 3v4m8-4v4M4 10h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM8 14h2m4 0h2m-8 3h2",
  clock: "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  user: "M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  check: "m5 12 4 4L19 6",
  "arrow-right": "M4 12h16m-6-6 6 6-6 6",
  "arrow-up-right": "M6 18 18 6M6 6h12v12",
  "chevron-right": "m9 5 7 7-7 7",
  "chevron-down": "m5 9 7 7 7-7",
  "chevron-left": "m15 5-7 7 7 7",
  building: "M4 21V5l8-3v19m0-14h8v14M2 21h20M7 7v1m0 3v1m0 3v1m9-5v1m0 3v1",
  "map-pin":
    "M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  briefcase:
    "M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M4 6h16a1 1 0 0 1 1 1v13H3V7a1 1 0 0 1 1-1Zm-1 5 9 4 9-4m-9 2v4",
  scissors:
    "m8 8 12 12M8 16 20 4M9 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm0 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  paw: "M9 13c1-3 5-3 6 0l3 4c2 4-3 4-6 2-3 2-8 2-6-2l3-4ZM6 9a2 3 0 1 1-4 0 2 3 0 0 1 4 0Zm7-4a2 3 0 1 1-4 0 2 3 0 0 1 4 0Zm6 1a2 3 0 1 1-4 0 2 3 0 0 1 4 0Zm3 5a2 3 0 1 1-4 0 2 3 0 0 1 4 0Z",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  utensils: "M4 3v5a3 3 0 0 0 6 0V3M7 3v18m12 0V3c-5 3-5 10 0 10",
  truck:
    "M1 4h13v13H1V4Zm13 5h4l4 4v4h-8M8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm12 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  dumbbell: "m6 6 12 12m-14-8 6-6m4 16 6-6M2 8l6-6m8 20 6-6",
  shield: "M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6l-9-4Zm-4 10 3 3 5-6",
  sparkles:
    "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Zm7-1v4m-2-2h4",
  link: "m10 13 4-4m-6 1-2 2a4 4 0 0 0 6 6l2-2m-4-8 2-2a4 4 0 0 1 6 6l-2 2",
  plus: "M12 5v14M5 12h14",
  mail: "M3 5h18v14H3V5Zm0 1 9 7 9-7",
  phone:
    "M5 3h4l2 5-3 2a15 15 0 0 0 6 6l2-3 5 2v4c0 2-2 3-4 2C9 19 5 15 3 7 2 5 3 3 5 3Z",
  settings: "M4 7h16M4 17h16M9 4v6m6 4v6",
  layout: "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z",
  logout: "M9 3H4v18h5m5-5 5-4-5-4m-5 4h12",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "m6 6 12 12M6 18 18 6",
  help: "M9.5 8a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  copy: "M8 8h13v13H8V8ZM4 16H3V3h13v1",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  printer:
    "M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2m-12-4h12v7H6v-7Zm12-2h.01",
} as const;

export type IconName = keyof typeof paths;

/** Decorative icon; the surrounding control supplies the accessible label. */
export function Icon({
  name,
  size = 20,
  className = "",
  ...props
}: {
  name: IconName;
  size?: number;
} & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`ui-icon ${className}`}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}

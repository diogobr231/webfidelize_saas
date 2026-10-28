import type { ReactNode } from "react";

/** New route identity gets a short orientation cue; search/filter interactions stay instant. */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="ui-route">{children}</div>;
}

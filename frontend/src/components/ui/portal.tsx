"use client";

import * as React from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into `document.body`.
 *
 * Overlays must escape the page's stacking context. The dashboard's `<main>`
 * carries `relative z-10`, which creates a stacking context, so anything
 * rendered inside it - a dialog at `z-[150]`, a drawer at `z-[100]` - is
 * confined to that context and still paints *below* the nav dock, which is a
 * sibling of `<main>` at `z-40`. No z-index on the overlay can fix that;
 * it has to leave the subtree.
 *
 * Mounting is deferred to an effect so the server render and the first client
 * render agree (document does not exist during SSR).
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  return createPortal(children, document.body);
}

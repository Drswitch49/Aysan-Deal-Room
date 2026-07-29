import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * Renders overlay content into <body>, outside the page tree.
 *
 * `position: fixed` is only relative to the viewport while no ancestor has a
 * transform, filter or backdrop-filter — any of those make the element a
 * containing block, and a "fixed inset-0" overlay inside one is sized and
 * centred against *that box* instead of the screen. Several pages here wrap
 * their content in `.animate-fade-in-up`, whose final keyframe is
 * `transform: translateY(0)` and which runs with `forwards`, so the transform
 * sticks permanently. That is why the document dialog rendered off-centre and
 * clipped at the top: it was being centred inside the Documents tab panel.
 *
 * Portalling sidesteps the whole class of problem rather than hunting for the
 * offending ancestor each time.
 *
 * Also locks body scroll while open, so the page behind doesn't scroll away
 * under the overlay.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return createPortal(children, document.body);
}

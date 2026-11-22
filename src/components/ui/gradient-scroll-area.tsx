"use client";

import * as React from "react";
import { bindGradientScrollbar } from "@/lib/gradient-scrollbar";
import { cn } from "@/lib/utils";

export interface GradientScrollbarTrackProps {
  target: HTMLElement | null;
  className?: string;
}

/**
 * Floating right-edge gradient progress scrollbar bound to an existing scroll container.
 */
export function GradientScrollbarTrack({ target, className }: GradientScrollbarTrackProps) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const fillRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const track = trackRef.current;
    const fill = fillRef.current;
    if (!target || !track || !fill) return;
    return bindGradientScrollbar({ target, track, fill });
  }, [target]);

  return (
    <div
      ref={trackRef}
      className={cn("gradient-scrollbar gradient-scrollbar-local", className)}
      data-visible="false"
      aria-hidden="true"
    >
      <div ref={fillRef} className="gradient-scrollbar-fill" />
    </div>
  );
}

export interface GradientScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  wrapperClassName?: string;
  trackClassName?: string;
}

/**
 * Scrollable container with hidden native scrollbar and sibling overlay progress bar,
 * keeping internal sticky elements working cleanly.
 */
export const GradientScrollArea = React.forwardRef<HTMLDivElement, GradientScrollAreaProps>(
  ({ className, wrapperClassName, trackClassName, children, ...props }, forwardedRef) => {
    const [viewportEl, setViewportEl] = React.useState<HTMLDivElement | null>(null);

    const mergedRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        setViewportEl(node);
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef],
    );

    return (
      <div className={cn("gradient-scroll-box", wrapperClassName)}>
        <div
          ref={mergedRef}
          className={cn("gradient-scroll-viewport", className)}
          {...props}
        >
          {children}
        </div>
        <GradientScrollbarTrack target={viewportEl} className={trackClassName} />
      </div>
    );
  },
);
GradientScrollArea.displayName = "GradientScrollArea";

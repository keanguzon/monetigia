"use client";

import Link from "next/link";
import { forwardRef, type ComponentProps } from "react";
import { navigationDestination } from "@/lib/navigation";
import { useNavigation } from "./navigation-provider";

type NavigationLinkProps = ComponentProps<typeof Link> & { navigationSource?: "mobile" };

export const NavigationLink = forwardRef<HTMLAnchorElement, NavigationLinkProps>(function NavigationLink({ onClick, navigationSource, ...props }, ref) {
  const { navigate } = useNavigation();
  return <Link {...props} ref={ref} onClick={(event) => {
    onClick?.(event);
    const destination = navigationDestination(event.currentTarget.href, window.location.href, {
      button: event.button, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey,
      defaultPrevented: event.defaultPrevented,
      target: event.currentTarget.target,
      download: event.currentTarget.hasAttribute("download"),
    });
    if (!destination) return;
    event.preventDefault();
    if (navigationSource) navigate(destination, { source: navigationSource });
    else navigate(destination);
  }} />;
});

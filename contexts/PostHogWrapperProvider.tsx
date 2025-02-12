import { createContext, ReactNode } from "react";
import { PostHogProvider } from "posthog-js/react";
import posthog from "posthog-js";

export const PostHogWrapperContext = createContext(undefined);

export function PostHogWrapperProvider({ children }: { children: ReactNode }) {
  const calledOnce = useRef(false);

  useEffect(() => {
    const isProduction = process.env.NODE_ENV === "production";

    if (!isProduction) {
      return;
    }

    if (calledOnce.current) return;
    calledOnce.current = true;

    posthog.init("phc_cnYLzCi1iYgXbHycArgvgabG1VhNEOSjCZpFhJiirH1", {
      api_host: "https://eu.i.posthog.com",
      debug: !isProduction,
      capture_pageleave: false,
      capture_pageview: false,
      autocapture: false,
      person_profiles: "always",
    });
  }, []);

  return (
    <PostHogWrapperContext.Provider value={undefined}>
      <PostHogProvider client={posthog}>{children}</PostHogProvider>
    </PostHogWrapperContext.Provider>
  );
}

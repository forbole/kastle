import { createContext, ReactNode, useEffect, useRef, useState } from "react";
import { PostHog } from "posthog-js-lite";
import { isProduction } from "@/lib/utils.ts";

type PosthogContextType = {
  postHog: PostHog | undefined;
};

export const PostHogWrapperContext = createContext<PosthogContextType>({
  postHog: undefined,
});

export function PostHogWrapperProvider({ children }: { children: ReactNode }) {
  const calledOnce = useRef(false);
  const [postHog, setPostHog] = useState<PostHog>();

  useEffect(() => {
    if (calledOnce.current) return;
    calledOnce.current = true;

    try {
      const postHogInstance = new PostHog(
        "phc_9GNofpiXuB3oDxjJes4K2VaTgM33mwCNt8ZoOoTgyon",
        {
          host: "https://eu.i.posthog.com",
          autocapture: false,
          defaultOptIn: isProduction,
        },
      );

      setPostHog(postHogInstance);
    } catch {
      // Analytics init failure must not affect the app
    }
  }, []);

  return (
    <PostHogWrapperContext.Provider value={{ postHog: postHog }}>
      {children}
    </PostHogWrapperContext.Provider>
  );
}

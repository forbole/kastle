import { createContext, ReactNode, useState } from "react";
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
    if (!isProduction) {
      return;
    }

    if (calledOnce.current) return;
    calledOnce.current = true;

    const postHogInstance = new PostHog(
      "phc_cnYLzCi1iYgXbHycArgvgabG1VhNEOSjCZpFhJiirH1",
      {
        host: "https://eu.i.posthog.com",
        autocapture: false,
      },
    );

    setPostHog(postHogInstance);
  }, []);

  return (
    <PostHogWrapperContext.Provider value={{ postHog: postHog }}>
      {children}
    </PostHogWrapperContext.Provider>
  );
}

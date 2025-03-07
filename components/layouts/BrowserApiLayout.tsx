import PopupLayout from "@/components/layouts/PopupLayout.tsx";
import { useEffect } from "react";

export default function BrowserApiLayout() {
  // Resize the window to the target width and height
  useEffect(() => {
    const targetWidth = 375;
    const targetHeight = 600;
    const widthGap = targetWidth - window.innerWidth;
    const heightGap = targetHeight - window.innerHeight;

    window.resizeBy(widthGap, heightGap);
  }, []);

  return <PopupLayout />;
}

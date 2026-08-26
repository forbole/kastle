import React from "react";
import splashVideo from "@/assets/splash.webm";

// NOTE (asset v2): Splash plays the transparent castle video (WebM / VP9 + alpha,
// so it sits on the app background with no letterbox). Video playback is
// engineering-owned — please review autoplay / muted / loop + perf, and whether
// Splash stays mounted long enough for the clip to play.
const Splash = () => {
  return (
    <div className="flex h-screen min-h-[600px] min-w-[375px] flex-col items-center gap-10 py-12">
      <video
        className="mx-auto aspect-[932/984] w-full max-w-[343px]"
        src={splashVideo}
        autoPlay
        muted
        playsInline
        preload="auto"
      />
      <div className="text-center text-lg text-gray-200">
        Opening the gates...
      </div>
    </div>
  );
};

export default Splash;

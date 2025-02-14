import React from "react";
import castleImage from "@/assets/images/castle.png";

const Splash = () => {
  return (
    <div className="flex h-screen min-h-[600px] min-w-[375px] flex-col items-center gap-10 py-12">
      <img alt="castle" className="h-[229px] w-[229px]" src={castleImage} />
      <div className="text-center text-lg text-gray-200">
        Opening the gates...
      </div>
    </div>
  );
};

export default Splash;

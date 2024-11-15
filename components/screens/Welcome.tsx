import React, { useEffect } from "react";
import { NavLink } from "react-router-dom";
import castleImage from "@/assets/images/castle.png";
import confetti from "canvas-confetti";

export default function Welcome() {
  useEffect(() => {
    confetti({
      particleCount: 50,
      spread: 70,
      gravity: 2,
      origin: { y: 0.7 },
    });
  }, []);

  return (
    <div className="flex h-full w-full flex-col items-center justify-between px-4 py-6">
      <div className="flex flex-col items-center pt-9">
        <img alt="castle" className="h-[229px] w-[229px]" src={castleImage} />
        <div className="flex flex-col items-center pt-10">
          <div className="text-center text-lg text-[#a8a09c]">Success!</div>
          <div className="text-3xl font-semibold text-[#a8a09c]">
            Welcome your Majesty
          </div>
        </div>
      </div>
      <NavLink
        to="/dashboard"
        className="w-full rounded-full bg-icy-blue-400 py-4 text-center text-base font-semibold text-white"
      >
        Explore Kastle
      </NavLink>
    </div>
  );
}

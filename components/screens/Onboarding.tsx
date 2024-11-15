import castleImage from "@/assets/images/castle.png";
import { NavLink } from "react-router-dom";

export default function Onboarding() {
  return (
    <div id="onboarding" className="flex h-full flex-col justify-between">
      <div className="flex flex-col items-center gap-10 pt-12">
        <img alt="castle" className="h-[229px] w-[229px]" src={castleImage} />
        <div className="flex flex-col items-center gap-3">
          <div className="text-center text-lg font-semibold text-[#a8a09c]">
            Welcome to Kastle
          </div>
          <div className="text-3xl font-semibold text-[#a8a09c]">
            Your Gateway to Kaspa
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3 px-4 py-6">
        <NavLink
          id="pass-onboarding"
          to="/setup"
          className="flex justify-center gap-2 rounded-full bg-icy-blue-400 px-6 py-3.5 text-center text-base font-semibold text-white"
        >
          Start your Journey
        </NavLink>

        <div className="px-2 text-xs text-[#a8a09c]">
          By going on, you agree to our{" "}
          <a
            href="https://forbole.com/en/terms-and-conditions"
            target="_blank"
            className="text-icy-blue-400 underline"
            rel="noreferrer"
          >
            Terms of Service
          </a>{" "}
          and{" "}
          <a
            href="https://forbole.com/en/privacy-policy"
            target="_blank"
            className="text-icy-blue-400 underline"
            rel="noreferrer"
          >
            {" "}
            Privacy Policy
          </a>
          .
        </div>
      </div>
    </div>
  );
}

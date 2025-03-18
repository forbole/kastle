import castleImage from "@/assets/images/castle.png";
import { NavLink } from "react-router-dom";
import useAnalytics from "@/hooks/useAnalytics.ts";

export default function Onboarding() {
  const calledOnce = useRef(false);
  const { emitOnboardingComplete } = useAnalytics();

  useEffect(() => {
    if (calledOnce.current) return;
    calledOnce.current = true;

    emitOnboardingComplete();
  }, []);

  return (
    <div id="onboarding" className="flex h-full flex-col justify-between">
      <div className="flex flex-col items-center gap-10 pt-12">
        <img alt="castle" className="h-[229px] w-[229px]" src={castleImage} />
        <div className="flex flex-col items-center gap-3">
          <div className="text-center text-lg font-semibold text-daintree-400">
            Welcome to Kastle
          </div>
          <div className="text-3xl font-semibold text-gray-200">
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
      </div>
    </div>
  );
}

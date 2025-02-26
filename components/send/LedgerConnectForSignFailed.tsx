import { useNavigate, useSearchParams } from "react-router-dom";

export default function LedgerConnectForSignFailed() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect");

  const retry = () => {
    if (redirect) {
      navigate(redirect);
    }
  };

  return (
    <div>
      <div>Please retry</div>
      <button
        onClick={retry}
        className="flex items-center gap-2 rounded-full bg-icy-blue-400 p-5 hover:bg-icy-blue-600"
      >
        Retry
      </button>
    </div>
  );
}

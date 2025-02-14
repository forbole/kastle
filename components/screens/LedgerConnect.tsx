import useLedgerTransport from "@/hooks/useLedgerTransport";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function LedgerConnect() {
  const { transport, connect } = useLedgerTransport();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const redirect = searchParams.get("redirect");

  const connectDevice = async () => {
    if (!redirect) {
      return;
    }

    if (transport) {
      navigate(redirect);
      return;
    }

    try {
      await connect();
      navigate(redirect);
    } catch (error) {
      setError((error as Error).message);
    }
  };

  return (
    <div className="flex h-full w-full flex-col items-stretch gap-4 rounded-3xl p-4 pb-6">
      <div>Waiting connect</div>

      {error && <div className="text-red-500">{error}</div>}

      <button
        onClick={connectDevice}
        className="flex items-center gap-2 rounded-full bg-icy-blue-400 p-5 hover:bg-[#125F78]"
      >
        Connect
      </button>
    </div>
  );
}

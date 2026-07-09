import { useNavigate } from "react-router-dom";
import igraIcon from "@/assets/images/network-logos/igra.svg";

type INSItemProps = {
  name: string;
};

export default function INSItem({ name }: INSItemProps) {
  const navigate = useNavigate();

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 hover:border-white"
      onClick={() => navigate(`/ins/${name}`)}
    >
      <img alt="ins" className="h-[40px] w-[40px]" src={igraIcon} />
      <div className="flex flex-grow flex-col gap-1">
        <div className="flex items-center justify-between text-base text-white">
          <span>{name}</span>
        </div>
      </div>
    </div>
  );
}

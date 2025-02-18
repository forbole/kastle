import Header from "@/components/GeneralHeader";
import successImage from "@/assets/images/success.png";

export default function AccountsImported() {
  const onClick = () => {
    browser.action.openPopup();
  };

  return (
    <div className="flex h-[35rem] w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="flex h-full flex-col px-10 pb-12 pt-4 text-white">
        <Header
          title="Accounts Imported"
          showPrevious={false}
          showClose={false}
        />
        <div className="mt-16 flex flex-grow flex-col justify-between">
          <div className="space-y-4">
            <img src={successImage} alt="Success" className="mx-auto" />
            <div className="items-center space-y-2">
              <h3 className="text-center text-xl font-semibold text-teal-500">
                Success
              </h3>
              <h5 className="text-center text-sm text-gray-400">
                Your account has been successfully imported!
              </h5>
            </div>
          </div>
          <button
            className="rounded-full bg-icy-blue-400 py-5 text-base font-semibold hover:bg-icy-blue-600"
            onClick={onClick}
          >
            Back to extension
          </button>
        </div>
      </div>
    </div>
  );
}

import { twMerge } from "tailwind-merge";
import React from "react";
import toast from "react-hot-toast";

const internalToast = {
  success: (msg: string) =>
    toast.custom(
      <ToastMessage
        status="success"
        message={msg}
        className="border-teal-900 bg-[#062b27] text-teal-500"
      />,
      {
        duration: 500,
      },
    ),
  error: (msg: string) =>
    toast.custom(
      <ToastMessage
        status="error"
        message={msg}
        className="border-red-900 bg-[#2b0606] text-red-500"
      />,
      {
        duration: 500,
      },
    ),
};

type ToastProps = {
  status: "success" | "error";
  message: string;
} & React.HTMLAttributes<HTMLDivElement>;

function ToastMessage({ status, message, className }: ToastProps) {
  return (
    <div className={twMerge("flex gap-5 rounded-xl border p-4", className)}>
      {status === "success" && <i className="hn hn-check-circle text-base" />}
      {status === "error" && (
        <i className="hn hn-exclamation-triangle text-base" />
      )}
      <h3 className="flex-1 text-base font-semibold">{message}</h3>
    </div>
  );
}

export default internalToast;

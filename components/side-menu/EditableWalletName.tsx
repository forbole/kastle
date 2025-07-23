import { WalletInfo } from "@/contexts/WalletManagerContext.tsx";
import React, { useState, useRef, useEffect } from "react";
import useWalletManager from "@/hooks/useWalletManager";

type WalletHeaderProps = {
  wallet: WalletInfo;
};

export default function EditableWalletName({ wallet }: WalletHeaderProps) {
  const { renameWallet } = useWalletManager();

  const [isEditing, setIsEditing] = useState(false);
  const [tempTitle, setTempTitle] = useState(wallet.name);
  const containerRef = useRef<HTMLInputElement>(null);

  const handleEditClick = () => {
    setTempTitle(wallet.name);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setTempTitle(wallet.name);
    setIsEditing(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      renameWallet(wallet.id, tempTitle);
      setIsEditing(false);
    }
    if (e.key === "Escape") {
      setTempTitle(wallet.name);
      setIsEditing(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isEditing &&
        containerRef.current &&
        event.target &&
        !containerRef.current.contains(event.target as Node)
      ) {
        handleCancel();
      }
    };

    if (isEditing) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isEditing]);

  return (
    <div className="mr-auto flex items-center leading-none">
      {!wallet.backed && (
        <i className="hn hn-exclamation-triangle-solid text-[#EAB308]" />
      )}

      {isEditing ? (
        <input
          maxLength={20}
          ref={containerRef}
          type="text"
          value={tempTitle}
          onChange={(e) => setTempTitle(e.target.value)}
          onKeyDown={handleKeyPress}
          className="min-w-32 bg-transparent px-2 py-1 focus:border-0 focus:border-b-2 focus:border-cyan-400 focus:outline-none focus:ring-0"
          autoFocus
        />
      ) : (
        <span className="mr-auto px-2 text-sm font-semibold">
          {wallet.name}
        </span>
      )}

      {!isEditing && (
        <i
          className="hn hn-pencil cursor-pointer text-white"
          onClick={handleEditClick}
        ></i>
      )}
    </div>
  );
}

import { sendMessage } from "@/lib/utils.ts";
import { Method } from "@/lib/service/extension-service.ts";
import {
  EvmGetPublicKeyRequest,
  EvmGetPublicKeyResponse,
} from "@/lib/service/handlers/evm/evm-get-public-key";
import {
  EvmSignTypedDataRequest,
  EvmSignTypedDataResponse,
} from "@/lib/service/handlers/evm/evm-sign-typed-data";
import {
  EvmSignMessageRequest,
  EvmSignMessageResponse,
} from "@/lib/service/handlers/evm/evm-sign-message";
import {
  EvmSignTransactionRequest,
  EvmSignTransactionResponse,
} from "@/lib/service/handlers/evm/evm-sign-transaction";
import { ErrorMessage } from "@/lib/service/handlers/message";

export default function useEvmBackgroundSigner() {
  return {
    signTransaction: async (request: EvmSignTransactionRequest) => {
      const response = await sendMessage<
        EvmSignTransactionResponse | ErrorMessage
      >(Method.EVM_SIGN_TRANSACTION, request);

      if (response && "error" in response) {
        throw new Error(response.error);
      }

      return response;
    },

    signMessage: async (request: EvmSignMessageRequest) => {
      const response = await sendMessage<EvmSignMessageResponse | ErrorMessage>(
        Method.EVM_SIGN_MESSAGE,
        request,
      );

      if (response && "error" in response) {
        throw new Error(response.error);
      }

      return response;
    },

    signTypedData: async (request: EvmSignTypedDataRequest) => {
      const response = await sendMessage<
        EvmSignTypedDataResponse | ErrorMessage
      >(Method.EVM_SIGN_TYPED_DATA, request);

      if (response && "error" in response) {
        throw new Error(response.error);
      }

      return response;
    },

    getPublicKey: async (request: EvmGetPublicKeyRequest) => {
      const response = await sendMessage<
        EvmGetPublicKeyResponse | ErrorMessage
      >(Method.EVM_GET_PUBLIC_KEY, request);

      if (response && "error" in response) {
        throw new Error(response.error);
      }

      return response;
    },
  };
}

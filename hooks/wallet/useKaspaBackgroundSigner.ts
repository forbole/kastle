import { sendMessage } from "@/lib/utils.ts";
import { Method } from "@/lib/service/extension-service.ts";
import {
  KaspaGetPublicKeysRequest,
  KaspaGetPublicKeysResponse,
} from "@/lib/service/handlers/kaspa/kaspa-get-public-keys";
import {
  KaspaSignMessageRequest,
  KaspaSignMessageResponse,
} from "@/lib/service/handlers/kaspa/kaspa-sign-message";
import {
  KaspaSignTransactionRequest,
  KaspaSignTransactionResponse,
} from "@/lib/service/handlers/kaspa/kaspa-sign-transaction";
import { ErrorMessage } from "@/lib/service/handlers/message";

export default function useKaspaBackgroundSigner() {
  return {
    signTransaction: async (request: KaspaSignTransactionRequest) => {
      const response = await sendMessage<
        KaspaSignTransactionResponse | ErrorMessage
      >(Method.KASPA_SIGN_TRANSACTION, request);

      if (response && "error" in response) {
        throw new Error(response.error);
      }

      return response;
    },

    signMessage: async (request: KaspaSignMessageRequest) => {
      const response = await sendMessage<
        KaspaSignMessageResponse | ErrorMessage
      >(Method.KASPA_SIGN_MESSAGE, request);

      if (response && "error" in response) {
        throw new Error(response.error);
      }

      return response;
    },

    getPublicKeys: async (request: KaspaGetPublicKeysRequest) => {
      const response = await sendMessage<
        KaspaGetPublicKeysResponse | ErrorMessage
      >(Method.KASPA_GET_PUBLIC_KEYS, request);

      if (response && "error" in response) {
        throw new Error(response.error);
      }

      return response;
    },
  };
}

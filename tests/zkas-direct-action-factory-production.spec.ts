import { expect, test } from "@playwright/test";
import { transform } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("private production coordinator replays and seals only after popup approval, then sends both daemon credentials", async () => {
  const source = readFileSync(
    resolve("lib/zkas/direct-action-factory.ts"),
    "utf8",
  );
  const body = source.slice(source.indexOf("export class DirectActionFactory"));
  const prelude = `
    const events = globalThis.__factoryEvents;
    const withWalletSettingsLock = async (operation) => operation();
    const withSettingsLock = async (operation) => operation();
    const WALLET_SETTINGS = 'local:wallet-settings';
    const storage = {getItem:async(key)=>key===WALLET_SETTINGS?{selectedWalletId:globalThis.__factoryOtherAccount?'other':'wallet',selectedAccountIndex:0,wallets:[{id:'wallet',accounts:[{index:0,address:'zkas:'+'a'.repeat(80)}]}]}:null};
    const card = Uint8Array.from({length:184}, (_,i)=>i===0?3:7);
    const cardHex = Array.from(card,b=>b.toString(16).padStart(2,'0')).join('');
    const birth = {birthHash:'22'.repeat(32), sessionId:'33'.repeat(16)};
    const profile = {accountAddress:'zkas:'+'a'.repeat(80),peerId:'11'.repeat(16),publicCard:cardHex};
    const review = id => ({token:new Uint8Array(16).fill(1), actionId:id,kind:'invite',ownerPeerId:profile.peerId,recipientPeerId:'44'.repeat(16),recipientCard:card,
      addresses:{sender:'zkas:sender',peer:'zkas:peer',cache:'zkas:cache',archive:'zkas:archive',collector:'zkas:collector'},
      rawAddresses:Object.fromEntries(['sender','peer','cache','archive','collector'].map((role,i)=>[role,new Uint8Array(43).fill(i+1)])),
      explicitTotalSompi:'10000003',maxNetworkFeeSompi:'5000000',maximumTotalSompi:'15000003',
      selectedReviewTipHash:'55'.repeat(32),selectedReviewTipDaa:100n,sourceGeneration:7n,
      birthHash:birth.birthHash,sessionId:birth.sessionId,referenceActionId:null,decision:null,text:'hello'});
    let actorCounter = 0;
    const makeActor = () => ({address:profile.accountAddress,selection:{walletId:'wallet',accountIndex:0,network:'mainnet'},
      directReviewInvite:()=>{ events.push('review'); return review((++actorCounter).toString(16).padStart(2,'0').repeat(16)); },
      directApproveAndSeal:(original)=>{events.push('seal');return {actionId:original.actionId,approvedCard:card,idempotencyKey:'66'.repeat(32),commitment:'77'.repeat(32),fanoutDigest:'88'.repeat(32),exactDigest:'99'.repeat(32),explicitTotalSompi:'10000003',maxNetworkFeeSompi:'5000000',maximumTotalSompi:'15000003',
        outputs:['peer','cache','archive','collector'].map((role,i)=>({role,recipient:globalThis.__factoryWrongRecipient&&i===0?'zkas:wrong':'zkas:'+role,rawAddress:new Uint8Array(43).fill(i+2),amountSompi:i===3?'10000000':'1',memo:i===3?new Uint8Array(512):Uint8Array.from([77,74,51,58,...new Uint8Array(508)])}))};},
      publicCard:()=>card,
      directReceiveSnapshot:()=>new Uint8Array(0),
    });
    class DirectReceiveRegistry {constructor(){this.actor=makeActor();this.lease={actor:this.actor,birth,sourceGeneration:7n,context:{daemonUrl:'https://daemon.example',indexUrl:'https://index.example'},revision:'grant-one',connectionGeneration:1n,grantSession:1,assertCurrent:async()=>{},assertImmediate:()=>{}};}
      async read(){events.push('replay');this.actor=makeActor();this.lease.actor=this.actor;return {view:{history:'session-from-birth'},assertCurrent:async()=>{},assertImmediate:()=>{}};}
      async withRetainedReady(_origin,operation){return operation(this.lease);}
      async witnessRetainedReview(){events.push('witness');}
      close(){events.push('close');}
    }
    const directReceiveRegistry = new DirectReceiveRegistry();
    const zkasKeyService = {publicMessagingProfile:async()=>globalThis.__factoryOtherAccount?{...profile,accountAddress:'zkas:other'}:profile,publicAccount:async()=>({walletId:globalThis.__factoryOtherAccount||globalThis.__factoryOtherWalletSameAddress?'other':'wallet',accountIndex:0,network:'mainnet',address:globalThis.__factoryOtherAccount?'zkas:other':profile.accountAddress}),credentials:async()=>({address:profile.accountAddress,daemonUrl:'https://daemon.example',walletToken:'aa'.repeat(16),keyringVersion:1}),checkSelection:async()=>{}};
    const HISTORY_GRANTS_KEY='grants',DIRECT_PINS_KEY='pins';
    const keyring={isUnlocked:()=>true,getSessionVersion:()=>1,getMutationGeneration:key=>key===DIRECT_PINS_KEY?(globalThis.__factoryPinGeneration??0):key===DAEMON_BEARERS_KEY?(globalThis.__generation??0):0};
    const ExtensionService={getInstance:()=>({getKeyring:()=>keyring})};
    const DAEMON_BEARERS_KEY='bearers';
    class DirectPinStore {constructor(){} async recordNativeApproved(){events.push('pin');globalThis.__factoryPinGeneration=(globalThis.__factoryPinGeneration??0)+1;} async read(){return [card];}}
    class DaemonBearerStore {constructor(){} async withBearer(_origin,_assert,operation){return operation('bb'.repeat(32));}}
    const browser={permissions:{contains:async()=>true}};
    const historyIndexHostPattern=()=> 'https://daemon.example/*';
    const ZKAS_MAINNET_GENESIS='b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f';
    const decodeNativeDirectView=()=>({birthHash:birth.birthHash,sessionId:birth.sessionId,sourceGeneration:7n,tipHash:'55'.repeat(32),tipDaa:100n});
    const assertBatchOrigin=()=>{};
    const journal={hasReservation:async()=>false,pendingDirectFor:async()=>null,unresolvedForAccount:async()=>null,findDirectAction:async()=>globalThis.__factoryRecord,assertNoUnresolvedAccountAction:async()=>{}};
    const getZKasBatchJournal=async()=>journal;
    class ZKasBatchClient {constructor(config){this.identity=config.baseUrl;this.config=config;} async grant(){const headers=new Headers({'X-Wallet-Token':this.config.token});await this.config.fetch(this.identity+'/api/wallet/prepare-many/capability',{method:'POST',headers});return {logicalId:'66'.repeat(32),capability:'cc'.repeat(32),expiresAtUnix:2000000000};}}
    class ZKasBatchPayment {constructor(client){this.client=client;} async beginDirectFirstUse(intent,approval,ready){events.push('journal');globalThis.__factoryRecord={intent,directApproval:approval,status:'preparing'};await ready();events.push('grant');return this.client.grant(intent);}
      async completeDirectFromJournal(){events.push('complete-original');return {status:'unknown'};}
      async recover(){events.push('recover-original');return {status:'unknown'};}}
    const fetch=async(_url,init)=>{events.push('fetch');globalThis.__factoryHeaders=Object.fromEntries(new Headers(init.headers));return new Response('{}',{status:200});};
  `;
  const output = await transform(prelude + body, {
    loader: "ts",
    format: "iife",
    globalName: "FactoryProduction",
    target: "es2022",
  });
  (globalThis as unknown as { __factoryEvents: string[] }).__factoryEvents = [];
  (
    globalThis as unknown as { __factoryPinGeneration: number }
  ).__factoryPinGeneration = 0;
  const { directActionFactory } = new Function(
    output.code + "\nreturn FactoryProduction;",
  )() as {
    directActionFactory: {
      startReview(
        origin: string,
        input: unknown,
      ): Promise<{ approvalId: string; facts: { actionId: string } }>;
      acceptApproval(
        id: string,
        binding: { assertCurrent(): void },
      ): Promise<{ state: string }>;
    };
  };
  const started = await directActionFactory.startReview(
    "https://messages.example",
    { kind: "invite", publicCard: "03" + "07".repeat(183), note: "hello" },
  );
  expect(
    (globalThis as unknown as { __factoryEvents: string[] }).__factoryEvents,
  ).toEqual(["replay", "review"]);
  const result = await directActionFactory.acceptApproval(started.approvalId, {
    assertCurrent: () => {},
  });
  expect(result.state).toBe("pending");
  const events = (globalThis as unknown as { __factoryEvents: string[] })
    .__factoryEvents;
  expect(events.indexOf("witness")).toBeLessThan(events.indexOf("seal"));
  expect(events.indexOf("seal")).toBeLessThan(events.indexOf("pin"));
  expect(events.indexOf("pin")).toBeLessThan(events.indexOf("journal"));
  expect(events.indexOf("journal")).toBeLessThan(events.indexOf("grant"));
  expect(events.indexOf("grant")).toBeLessThan(events.indexOf("fetch"));
  const headers = (
    globalThis as unknown as { __factoryHeaders: Record<string, string> }
  ).__factoryHeaders;
  expect(headers.authorization).toBe("Bearer " + "bb".repeat(32));
  expect(headers["x-wallet-token"]).toBe("aa".repeat(16));
  (
    globalThis as unknown as { __factoryOtherAccount: boolean }
  ).__factoryOtherAccount = true;
  expect(
    await (
      directActionFactory as unknown as {
        pending(origin: string): Promise<unknown>;
      }
    ).pending("https://messages.example"),
  ).toBeNull();
  (
    globalThis as unknown as { __factoryOtherAccount: boolean }
  ).__factoryOtherAccount = false;
  const original = (
    globalThis as unknown as { __factoryRecord: Record<string, unknown> }
  ).__factoryRecord;
  original.directPrepared = { session: "original" };
  events.length = 0;
  expect(
    await (
      directActionFactory as unknown as {
        resume(origin: string, actionId: string): Promise<{ state: string }>;
      }
    ).resume("https://messages.example", started.facts.actionId),
  ).toEqual({ actionId: started.facts.actionId, state: "unknown" });
  expect(events).toContain("complete-original");
  original.signedTicket = { value: "original" };
  events.length = 0;
  expect(
    await (
      directActionFactory as unknown as {
        resume(origin: string, actionId: string): Promise<{ state: string }>;
      }
    ).resume("https://messages.example", started.facts.actionId),
  ).toEqual({ actionId: started.facts.actionId, state: "unknown" });
  expect(events).toContain("recover-original");
  original.status = "settled";
  (
    globalThis as unknown as { __factoryOtherAccount: boolean }
  ).__factoryOtherAccount = true;
  expect(
    await (
      directActionFactory as unknown as {
        status(origin: string, actionId: string): Promise<{ state: string }>;
      }
    ).status("https://messages.example", started.facts.actionId),
  ).toEqual({ actionId: started.facts.actionId, state: "unknown" });
  (
    globalThis as unknown as { __factoryOtherAccount: boolean }
  ).__factoryOtherAccount = false;
  (
    globalThis as unknown as { __factoryOtherWalletSameAddress: boolean }
  ).__factoryOtherWalletSameAddress = true;
  expect(
    await (
      directActionFactory as unknown as {
        status(origin: string, actionId: string): Promise<{ state: string }>;
      }
    ).status("https://messages.example", started.facts.actionId),
  ).toEqual({ actionId: started.facts.actionId, state: "unknown" });
  (
    globalThis as unknown as { __factoryOtherWalletSameAddress: boolean }
  ).__factoryOtherWalletSameAddress = false;

  (
    globalThis as unknown as { __factoryWrongRecipient: boolean }
  ).__factoryWrongRecipient = true;
  (globalThis as unknown as { __factoryEvents: string[] }).__factoryEvents = [];
  (
    globalThis as unknown as { __factoryPinGeneration: number }
  ).__factoryPinGeneration = 0;
  const changed = new Function(
    output.code + "\nreturn FactoryProduction;",
  )() as typeof import("../lib/zkas/direct-action-factory");
  const changedStart = await changed.directActionFactory.startReview(
    "https://messages.example",
    { kind: "invite", publicCard: "03" + "07".repeat(183), note: "hello" },
  );
  expect(
    (
      await changed.directActionFactory.acceptApproval(
        changedStart.approvalId,
        { assertCurrent: () => {} },
      )
    ).state,
  ).toBe("unknown");
  expect(
    (globalThis as unknown as { __factoryEvents: string[] }).__factoryEvents,
  ).not.toContain("pin");
});

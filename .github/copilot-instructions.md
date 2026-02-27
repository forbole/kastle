# Kastle Browser Extension - AI Agent Instructions

## Project Overview

Kastle is a browser extension wallet for the Kaspa cryptocurrency network built with WXT (Web Extension Toolkit), React, TypeScript, and Tailwind CSS. It supports Kaspa L1/L2, KRC20/KRC721 tokens, KNS (Kaspa Name Service), ERC20, and EIP-6963 Ethereum provider injection.

## Architecture

### Multi-Context Design

The extension operates across three isolated contexts that communicate via message passing:

1. **Background Script** (`entrypoints/background.ts`): Service worker managing wallet state, keyring, RPC connections, and API requests
2. **Injected Script** (`entrypoints/injected.ts`): Injected into web pages, exposes `window.kastle` and Ethereum provider APIs
3. **Popup UI** (`entrypoints/popup/`): React SPA for wallet management with hash-based routing

### Message Flow Architecture

- **Browser → Background**: `KastleBrowserAPI` (`api/browser.ts`) sends `ApiRequest` via `window.postMessage` → content script forwards to background
- **Background handlers**: Located in `api/background/handlers/{kaspa,ethereum}/` - each exports a `Handler` function that processes requests and sends `ApiResponse`
- **Internal messages**: `ExtensionService` (`lib/service/extension-service.ts`) handles keyring/signing operations via `browser.runtime.sendMessage` with `Method` enum

### WASM Integration

- Kaspa core cryptography runs via WebAssembly module initialized at startup
- **Critical**: `init(kaspaModule)` must be called in background script and popup before using crypto functions
- WASM module location: `wasm/core/kaspa` with TypeScript bindings
- Used for: transaction signing, address generation, UTXO management via `RpcClient`, `Generator`, `Address` classes

### State Management

- **Keyring**: `lib/keyring-manager.ts` - Encrypted storage using AES-GCM with Argon2id key derivation. Never store plain secrets in regular storage
- **Wallet secrets**: Stored encrypted in `storage.local` via keyring, keyed by wallet ID
- **Settings/state**: Use `storage.local` (cross-context persistent) or `storage.session` (temporary)
- **React contexts**: `WalletManagerContext`, `RpcClientContext`, `SettingsContext` provide global state in popup

## Development Conventions

### File Organization Patterns

- Background handlers: One file per action in `api/background/handlers/{kaspa,ethereum}/`, export Zod schema + handler function
- React components: Group by feature in `components/{feature}/`, shared components at top level
- Hooks: Prefixed with `use`, located in `hooks/` or `hooks/{feature}/` for feature-specific
- Types: Prefer inline or colocated types; shared types in `types/`

### Code Style Standards

- Use Zod for all API payloads/validation - see `api/message.ts` for `RpcRequestSchema`, `ApiRequestSchema` patterns
- React: Functional components with hooks, no prop-types (TypeScript handles this)
- Error handling: Use `RPC_ERRORS` constants from `api/message.ts` for standardized errors
- Path aliases: Use `@/` for absolute imports (maps to project root via `tsconfig.json`)

### React/UI Patterns

- **Forms**: Use `react-hook-form` for all form handling
- **Data fetching**: Use `useSWR` or `useSWRInfinite` for API calls (see `hooks/kasplex/`, `hooks/kns/`)
- **Styling**: Tailwind classes only, use `tailwind-merge` for conditional class merging
- **UI components**: Preline components for dropdowns/accordions - call `HSAccordion.autoInit()` or similar after mount
- **Toasts**: Use `internalToast` from `components/Toast.tsx`, not react-hot-toast directly

### Storage Best Practices

- Prefix keys: `local:` for persistent, no prefix for session
- **Never** store sensitive data unencrypted - always use keyring for secrets
- Use `useStorageState` hook for reactive storage access in components
- Migration pattern: Add version handler to `lib/migrations/migration.ts` for breaking changes

## Development Workflow

### Build & Run Commands

```bash
npm run dev                 # Chrome development mode
npm run dev:firefox         # Firefox development mode
npm run build              # Production build (Chrome)
npm run build:firefox      # Production build (Firefox)
npm run compile            # TypeScript type checking only
npm run lint               # ESLint check
npm run lint:fix           # Auto-fix lint issues
npm run prettier:write     # Format code
npm run e2e                # Playwright tests
```

### Testing Strategy

- E2E tests: Playwright in `tests/` directory
- Test extension with `npm run dev` and load `.output/chrome-mv3` in Chrome extensions
- Use test fixtures from `tests/fixtures.ts` for wallet setup

### Common Pitfalls

1. **WASM not initialized**: Always ensure WASM module is initialized before crypto operations
2. **Context isolation**: Cannot directly access background state from popup - use message passing
3. **Storage timing**: Use `await` for all storage operations, they're async
4. **React hooks exhaustive-deps**: Disabled in this project - manage dependencies manually to avoid infinite loops
5. **Ledger support**: Uses WebHID via `@ledgerhq/hw-transport-webhid` - requires user gesture to connect

## Extension-Specific Patterns

### Adding New Background Handlers

1. Create handler file in `api/background/handlers/{kaspa|ethereum}/newFeature.ts`
2. Export Zod payload schema and handler function: `export const myHandler: Handler = async (tabId, request, sendResponse) => {...}`
3. Add action to `Action` enum in `api/message.ts`
4. Register in `BackgroundService.getHandler()` in `api/background/background-service.ts`

### Adding New Browser API Methods

1. Add method to `KastleBrowserAPI` class in `api/browser.ts`
2. Create payload schema with Zod
3. Send `ApiRequest` via `window.postMessage`, await response via promise/event listener pattern
4. Implement corresponding background handler

### Crypto Operations

- Use WASM bindings from `@/wasm/core/kaspa` for all Kaspa operations
- For Ethereum: Use `viem` library (already imported)
- Transaction signing: Always occurs in background context via `ExtensionService` methods
- Public key derivation: Use `Generator` class from WASM for Kaspa, `evmGetPublicKeyHandler` for EVM

## Key Files Reference

- Entry points: `entrypoints/{background.ts,injected.ts,popup/main.tsx}`
- API surface: `api/{browser.ts,ethereum.ts,message.ts}`
- Background service: `api/background/background-service.ts`
- Keyring: `lib/keyring-manager.ts`
- Router: `entrypoints/popup/router.tsx` (uses `createHashRouter` from react-router-dom)
- RPC client: `contexts/RpcClientContext.tsx` (WASM RpcClient wrapper)
- Settings: `contexts/SettingsContext.tsx` (network config, RPC URLs)

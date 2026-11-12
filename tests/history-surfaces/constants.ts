// Plain values shared by the harness and the spec. The spec runs in Playwright's
// Node loader, so this module must import nothing: no SVG, no repo module, no
// window/location reads.
export const OWNER = "kaspa:qowner";
export const EVM_OWNER = "0x1111111111111111111111111111111111111111";
// Kasplex mainnet (202555), whose chain badge is network-logos/kasplex.svg.
export const EVM_CHAIN = "0x3173b";
export const EVM_TOKEN = "0x4444444444444444444444444444444444444444";
export const EVM_TOKEN_LOGO = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

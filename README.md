# FiberBrief

FiberBrief is a browser-only pay-to-unlock research brief demo on CKB Testnet. A seller publishes a free preview and an encrypted full brief. The app uses the AES-256-GCM key as the preimage of a 1 CKB Fiber invoice. After the buyer pays, Fiber reveals the preimage and the app verifies it before decrypting the brief.

Tutorial reference: https://www.fiber.world/docs/build/encrypted-data-payment

## What changed from the starter

- Replaced the generic report UI with a research-desk experience for **The Liquidity Layer**.
- Added title, byline, free preview, and full-brief authoring fields.
- Added `lib/brief.ts` with a versioned `fiberbrief` offer format, metadata validation, word counts, content hashing, and Markdown export.
- Added buyer-side preview and a locked-content state before payment.
- Added SHA-256 verification for the revealed invoice preimage and the encrypted content hash before rendering.
- Added a settled receipt with amount, routing fee, total, and payment hash.
- Added a downloadable Markdown copy of the unlocked brief.
- Added separate FiberBrief browser-node storage keys so the demo does not reuse the tutorial's saved identities.

## Completed Testnet flow

The demo was run end to end on Fiber Testnet. The buyer paid 1 CKB, the route fee was 0.001 CKB, and the brief unlocked only after both cryptographic checks passed:

- The revealed preimage matched the invoice payment hash.
- The decrypted bytes matched the sealed content hash.

Payment hash from the completed run:

`0x29a6ed610a3db52624df9efae6a8ffcb06e2fdb96f8dc47418a5501d123303ae`

## Run locally

Use Node.js 22.18 or newer and npm:

```sh
npm install
npm run dev
```

Open http://localhost:3001. The Fiber WASM runtime needs a secure context, `SharedArrayBuffer`, Web Locks, and cross-origin isolation. `next.config.mjs` supplies the isolation headers. Use Testnet funds only.

## Use the demo

1. Start Buyer A and Seller C.
2. Fund each displayed address from the CKB Testnet Faucet with enough for a 500 CKB channel plus fees.
3. Open both channels with Bottle and wait for `CHANNEL_READY`.
4. Optionally send the 5 CKB liquidity transfer if the route needs more inbound liquidity.
5. On the seller panel, edit the brief and select **Seal brief & issue 1 CKB invoice**.
6. Copy the public offer JSON into the buyer panel and inspect it.
7. Try to read without paying; the AES-GCM operation is rejected.
8. Pay 1 Testnet CKB, verify the receipt, then select **Verify key & read brief**.

The offer contains only public metadata, preview text, ciphertext, IV, content hash, invoice, and routing hint. The AES key and decrypted body are not stored in application progress or included in the offer.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

The test suite covers invoice validation, durable payment-attempt handling, retries, expiry, and uncertain payment outcomes.

## Evidence and reflections

- [Advanced payment receipt](submission/05-fiberbrief-receipt.png)
- [Advanced unlocked result](submission/06-fiberbrief-unlocked.png)
- [Basic reflection](submission/reflection.md)
- [Advanced reflection](submission/reflection-advanced.md)
- [Full submission evidence index](submission/README.md)

## Safety notes

- Use CKB Testnet only; never paste private keys, seed phrases, passwords, or browser-storage contents into a submission.
- Keep one active browser tab per saved FiberBrief node.
- If a payment is pending or its outcome is uncertain, use **Check payment status** rather than submitting another payment.
- The cryptographic proof verifies that the key matches the invoice and that the encrypted bytes match the sealed content hash; it does not prove that the research is factually correct.

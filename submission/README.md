# FiberBrief submission materials

## Basic evidence

- `01-setup-channel-ready.png` — Buyer A and Seller C channels are open and the route is funded.
- `02-before-payment.png` — the buyer has the encrypted offer and AES-GCM rejects decryption without the key.
- `03-payment-receipt.png` — 1 CKB received, 0.001 CKB routing fee, 1.001 CKB total, and the payment hash.
- `04-decrypted-result.png` — the buyer reads the original report after the payment reveals the preimage.
- `reflection-draft.md` — short reflection covering the required question and additional questions. Personalize the wording before submitting.

## Advanced demo

The repository root contains FiberBrief, a research-brief use case adapted from the starter. The seller provides a title, byline, and free preview, then seals the full brief into an AES-256-GCM offer. The buyer can inspect the offer and preview, but the full body remains locked until the 1 CKB Fiber invoice settles.

After payment, FiberBrief checks both proofs before displaying the body:

1. SHA-256 of the revealed preimage matches the invoice payment hash.
2. SHA-256 of the encrypted bytes matches the sealed content hash.

The unlocked brief can be downloaded as Markdown with its payment hash and verification details.

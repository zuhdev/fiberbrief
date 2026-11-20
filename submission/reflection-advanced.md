# Quest 2 Advanced reflection

For the Advanced project, I changed the starter flow into FiberBrief, a paid research-brief product with a free preview and an encrypted full report. The most important design choice was keeping the AES key out of the public offer and using the Fiber invoice preimage as the key revealed by payment.

The implementation taught me that a successful payment is not enough on its own. The buyer must verify that the preimage matches the invoice payment hash and that the decrypted bytes match the sealed content hash before displaying the brief. This made the unlock flow easier to reason about and gave the demo a clear security boundary.

The hardest part was making the UI handle real Fiber states, especially waiting for both channels to become `CHANNEL_READY` and preserving payment progress safely. If I continued the project, I would add seller reputation and dispute handling because cryptographic verification proves delivery and integrity, but not the factual quality of the research.

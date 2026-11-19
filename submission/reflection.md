# Basic quest reflection

- **What helped:** The explanations placed beside each interactive step were more useful than a separate walkthrough because I could learn about channels, invoices, and preimages without leaving the control I was using. The progress tracker also made the next action clear.

- **What I learned:** Payment reveals the invoice preimage; in this flow, that preimage is the AES key. I also learned why both channels must be `CHANNEL_READY`: total capacity is not enough ,the route needs directional liquidity on A–B and B–C.

- **What I would build:** A marketplace for paid research briefs. A buyer could read a free preview, pay 1 CKB, and receive a cryptographically verified full brief. I would add author reputation because Fiber proves the correct content was unlocked, not that the research is accurate.

- **One improvement:** Show the A–B and B–C directional balances beside the payment receipt. That would make the relationship between route readiness, liquidity, and settlement immediately clear.

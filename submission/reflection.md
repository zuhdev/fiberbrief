# Basic quest reflection

The explanations beside each interactive step made the tutorial easy to follow. I could read about a node, channel, invoice, or preimage while I was looking at that exact part of the flow. I preferred this format to a live demo at the top with a separate walkthrough below because I did not have to keep switching between the explanation and the controls. The progress steps also helped me understand what was complete and what still needed attention.

What stood out to me was that the payment did not directly reveal the report. The report stayed encrypted, and the successful Fiber payment revealed the preimage that served as the AES key. That made the payment and the unlock feel like one connected process instead of two separate actions.

I was unsure at first why both channels had to reach `CHANNEL_READY` before the invoice could be paid. The liquidity explanation made this clearer: the buyer needs outbound liquidity on A–B, while Bottle needs the right balance on B–C to forward the payment. Seeing the directional balances helped me understand why a channel can have capacity but still not support a payment in the direction I need.

I would like to build a marketplace for short research briefs and on-demand analysis using this pattern. A public preview could help buyers decide whether a brief is useful, while the full analysis would remain sealed until payment. I would also add reputation and dispute features because the cryptographic proof shows that the correct content was unlocked, but it does not prove that the claims inside the report are accurate.

One change I would make is to keep the route balances and payment receipt visible together during settlement. The tutorial explains their relationship, but showing both in the same view would make the connection even clearer for someone learning Fiber for the first time.

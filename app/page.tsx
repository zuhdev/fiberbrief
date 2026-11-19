'use client';

import { useEffect, useRef, useState } from 'react';
import { scriptToAddress, type Channel, type FiberBrowserNode, type GetPaymentResult } from '@fiber-pay/sdk/browser';
import { channelFundingGuidance } from '../lib/channel-funding';
import { briefToMarkdown, countWords, createBriefOffer, parseBriefOffer, type BriefOffer } from '../lib/brief';
import { decryptResult, fromHex, sha256Hex, toHex } from '../lib/crypto';
import { bottle, channelFundingCkb, connectAndOpenChannel, readChannel, ready, startRole } from '../lib/fiber';
import { payForOffer, validateOffer } from '../lib/payment';
import { createBrowserNodeSession } from '../lib/node-session';
import {
  encryptedBuyerProfile,
  encryptedSellerProfile,
  encryptedSessionKey,
  readEncryptedProgress,
  savedNodeIdentifier,
  type EncryptedLessonProgress,
} from '../lib/progress';

type Role = 'buyer' | 'seller';
const ckb = (value: string | undefined) => value ? `${Number(BigInt(value)) / 100_000_000}` : '0';

const SAMPLE = {
  title: 'The Liquidity Layer',
  byline: 'FiberBrief Research · Testnet Edition',
  preview:
    'Fiber can move CKB in seconds, but the real product is liquidity. This brief explains why directional balances — not headline channel capacity — decide whether a payment settles, and what builders should measure before launching a paid flow.',
  body: `## Capacity is not liquidity

A 500 CKB channel sounds like 500 CKB of payment capability. It is not. Every channel has two sides, and a payment can only travel in the direction where the sender's side holds spendable balance. The number that matters is not how much CKB is locked in total, but how much sits on the side the payment needs.

This distinction is easy to miss in a demo where both parties fund at the same time. It becomes impossible to ignore in production, when a merchant wants to receive more than its own outbound balance can support.

## A route is a chain of promises

Buyer A pays through Bottle B to reach Seller C. The A–B channel needs outbound capacity from A. The B–C channel needs outbound capacity from B. The smaller of those two directions sets the ceiling for the whole route.

In the encrypted-data tutorial, fresh channels put 400 CKB on A's side of A–B and only 150 CKB on Bottle's side of B–C. The purchase is limited by the second number, even though the first looks larger. Moving 5 CKB from Seller C to Bottle is a small rebalancing act: it buys inbound capacity for the seller by spending outbound capacity it already has.

## Why the first payment is the hardest

A new channel is usually one-sided. The opener funds it; the counterparty contributes nothing. That is enough for the opener to send, but not for the opener to receive. A merchant with ten fresh channels may still be unable to accept its first payment.

The practical fixes are straightforward, but each has a cost. Ask the counterparty to contribute liquidity. Open a second channel and rebalance. Route through a well-connected node that already has balance on both sides. Or pay a liquidity provider to shift capital where it is needed. None of these are free, which is why liquidity is the product rather than a background detail.

## Fees are a signal

A routing fee is not just revenue. It tells the network where capital is scarce. A cheap route usually has enough balance in the right direction; an expensive route is compensating someone for locking capital or for taking on rebalancing risk.

For a pay-to-unlock flow, the fee is small next to the price of the content. That makes it tempting to ignore. Builders should not. A payment that fails because a route ran dry is a worse user experience than a payment that costs a few extra shannons.

## What to measure

- **Settle rate.** The share of submitted invoices that reach Success without a manual retry.
- **Time to first payment.** How long a newly funded node needs before it can receive.
- **Rebalance cost.** What it costs to keep inbound capacity available at peak demand.
- **Locked capital.** CKB sitting idle in channels that are not producing payments.
- **Failure reason.** Route not found, insufficient balance, timeout, or invoice error. These are different problems with different fixes.

## A builder's checklist

1. Fund both sides of the route, or plan a rebalance before launch.
2. Test with the smallest useful channel, then grow only where demand appears.
3. Show payment status before offering a retry. A pending payment is not a failed one.
4. Treat the payment preimage as the key it is: keep it out of logs, analytics, and screenshots.
5. Give the buyer a receipt they can verify independently.

The last point matters more than it looks. A pay-to-unlock product is a trust product. The cryptography can prove that the key matches the invoice; it cannot prove that the report is accurate. Previews, reputation, and a clear refund policy still do the rest.`,
};

const short = (value: string, head = 10, tail = 8) =>
  value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;

export default function Page() {
  const nodes = useRef<Partial<Record<Role, FiberBrowserNode>>>({});
  const sessions = useRef<Partial<Record<Role, ReturnType<typeof createBrowserNodeSession>>>>({});
  const progress = useRef<EncryptedLessonProgress | null>(null);
  const locked = useRef(false);

  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addresses, setAddresses] = useState<Partial<Record<Role, string>>>({});
  const [connected, setConnected] = useState<Partial<Record<Role, boolean>>>({});
  const [channels, setChannels] = useState<Partial<Record<Role, Channel>>>({});
  const [setupOpen, setSetupOpen] = useState(true);
  const [draft, setDraft] = useState(SAMPLE);
  const [generated, setGenerated] = useState('');
  const [sealedAt, setSealedAt] = useState('');
  const [received, setReceived] = useState('');
  const [offer, setOffer] = useState<BriefOffer | null>(null);
  const [attempt, setAttempt] = useState('');
  const [tested, setTested] = useState(false);
  const [payment, setPayment] = useState<GetPaymentResult | null>(null);
  const [key, setKey] = useState('');
  const [verified, setVerified] = useState(false);
  const [digestOk, setDigestOk] = useState(false);
  const [decrypted, setDecrypted] = useState('');
  const [unlockedAt, setUnlockedAt] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    const saved = readEncryptedProgress(sessionStorage, localStorage);
    progress.current = saved;
    if (saved) {
      setGenerated(saved.generatedOffer);
      setReceived(saved.buyerOfferText);
      setAttempt(saved.attemptedPaymentHash);
      setTested(saved.triedWithoutKey);
    }
    setLoaded(true);
    const owned = sessions.current;
    const stop = () => { for (const session of Object.values(owned)) void session.stop().catch(() => {}); };
    window.addEventListener('pagehide', stop);
    return () => { window.removeEventListener('pagehide', stop); stop(); nodes.current = {}; sessions.current = {}; };
  }, []);

  function save(update: Partial<EncryptedLessonProgress>) {
    const buyerId = savedNodeIdentifier(localStorage, encryptedBuyerProfile);
    const sellerId = savedNodeIdentifier(localStorage, encryptedSellerProfile);
    if (!buyerId || !sellerId) throw new Error('Start both saved nodes before continuing.');
    const next = {
      version: 1 as const, buyerId, sellerId,
      generatedOffer: '', buyerOfferText: '', attemptedPaymentHash: '', triedWithoutKey: false,
      ...progress.current, ...update,
    };
    sessionStorage.setItem(encryptedSessionKey, JSON.stringify(next));
    progress.current = next;
  }

  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Action failed. Check status before retrying a transfer.');
    } finally {
      locked.current = false; setBusy(false);
    }
  }

  async function refresh(role: Role) {
    const node = nodes.current[role];
    if (!node) return;
    const channel = await readChannel(node);
    const { peers } = await node.listPeers();
    setConnected((previous) => ({
      ...previous,
      [role]: peers.some((peer) => peer.pubkey.replace(/^0x/i, '').toLowerCase() === bottle.pubkey.slice(2)),
    }));
    setChannels((previous) => ({ ...previous, [role]: channel }));
  }

  async function start(role: Role) {
    if (nodes.current[role]) return;
    const session = sessions.current[role] ??= createBrowserNodeSession();
    let started: FiberBrowserNode | undefined;
    await session.start(role === 'buyer' ? encryptedBuyerProfile : encryptedSellerProfile, async (track) => {
      started = await startRole(role, track);
    });
    if (!started) return;
    nodes.current[role] = started;
    const info = await started.nodeInfo();
    setAddresses((previous) => ({ ...previous, [role]: scriptToAddress(info.default_funding_lock_script, 'testnet') }));
    if (await readChannel(started)) await started.connectPeer(bottle);
    await refresh(role);
    setStatus(`${role === 'buyer' ? 'Buyer A' : 'Seller C'} is running on Testnet.`);
  }

  async function open(role: Role) {
    const node = nodes.current[role];
    if (!node) return;
    const channel = await connectAndOpenChannel(node);
    setChannels((previous) => ({ ...previous, [role]: channel }));
    await refresh(role);
    setStatus(channel && ready(channel)
      ? `${role === 'buyer' ? 'A–B' : 'B–C'} channel is ready.`
      : 'Channel opening submitted. Check status after the funding transaction confirms.');
  }

  async function moveLiquidity() {
    const node = nodes.current.seller;
    if (!node) return;
    const id = savedNodeIdentifier(localStorage, encryptedSellerProfile);
    const storageKey = `fiberbrief:inbound:${id}`;
    const existing = sessionStorage.getItem(storageKey);
    if (existing === 'submitting') throw new Error('Transfer outcome unknown. Review payment history before sending again.');
    let result: GetPaymentResult;
    if (existing) result = await node.getPayment({ payment_hash: existing as `0x${string}` });
    else {
      sessionStorage.setItem(storageKey, 'submitting');
      result = await node.sendPayment({ target_pubkey: bottle.pubkey, amount: '0x1dcd65000', keysend: true });
      sessionStorage.setItem(storageKey, result.payment_hash);
    }
    if (!['Success', 'Failed'].includes(result.status)) {
      result = await node.waitForPayment(result.payment_hash, { timeout: 60_000, interval: 1_000 });
    }
    if (result.status === 'Failed') sessionStorage.removeItem(storageKey);
    setStatus(`Liquidity transfer: ${result.status}`);
    await refresh('seller');
  }

  async function seal() {
    if (!nodes.current.seller || !channels.seller || !routeReady || generated || attempt) return;
    if (!draft.title.trim() || !draft.byline.trim() || !draft.body.trim()) {
      throw new Error('Add a title, byline, and full brief before sealing.');
    }
    const value = await createBriefOffer(nodes.current.seller, channels.seller, draft);
    save({ generatedOffer: value });
    setGenerated(value);
    setSealedAt(new Date().toISOString());
    setStatus('Brief sealed. Invoice issued and offer ready for the buyer.');
  }

  async function inspect() {
    if (!nodes.current.buyer) throw new Error('Start Buyer A before inspecting an offer.');
    const parsed = parseBriefOffer(received);
    await validateOffer(nodes.current.buyer, parsed);
    if (attempt && parsed.paymentHash.toLowerCase() !== attempt.toLowerCase()) {
      throw new Error('Restore the offer that matches the previous payment attempt.');
    }
    save({ buyerOfferText: received });
    setOffer(parsed); setTested(false); setPayment(null); setKey(''); setDecrypted(''); setVerified(false);
    setStatus('Offer verified: 1 CKB Fiber invoice and AES-256-GCM payload.');
  }

  async function testLock() {
    if (!offer) return;
    try {
      await decryptResult(offer, toHex(crypto.getRandomValues(new Uint8Array(32))));
      throw new Error('Unexpected: the payload opened without the preimage.');
    } catch (failure) {
      if (failure instanceof Error && failure.message.startsWith('Unexpected')) throw failure;
      save({ triedWithoutKey: true });
      setTested(true);
      setStatus('Decryption rejected without the key, as expected.');
    }
  }

  async function pay() {
    if (!nodes.current.buyer || !offer || !tested || !routeReady) return;
    const result = await payForOffer(nodes.current.buyer, offer, attempt, (hash) => {
      save({ attemptedPaymentHash: hash }); setAttempt(hash);
    }, payment?.status === 'Failed');
    acceptPayment(result);
    await Promise.all([refresh('buyer'), refresh('seller')]);
  }

  function acceptPayment(result: GetPaymentResult) {
    setPayment(result); setStatus(`Payment: ${result.status}`);
    if (result.status === 'Failed') setError(result.failed_error ?? 'Payment failed. Check channel liquidity before retrying.');
    if (result.status === 'Success' && result.payment_preimage) setKey(result.payment_preimage);
  }

  async function checkPayment() {
    if (!nodes.current.buyer || !offer || !attempt) return;
    await validateOffer(nodes.current.buyer, offer);
    acceptPayment(await nodes.current.buyer.getPayment({ payment_hash: attempt as `0x${string}` }));
  }

  async function unlock() {
    if (!offer || !key) return;
    const fingerprint = await sha256Hex(fromHex(key));
    if (fingerprint.toLowerCase() !== offer.paymentHash.toLowerCase()) {
      throw new Error('The revealed preimage does not match the invoice payment hash.');
    }
    setVerified(true);
    const body = await decryptResult(offer, key);
    const digest = await sha256Hex(offer.ciphertext);
    if (digest.toLowerCase() !== offer.contentHash.toLowerCase()) {
      throw new Error('The decrypted content does not match the sealed content hash.');
    }
    setDigestOk(true);
    setDecrypted(body);
    setUnlockedAt(new Date().toISOString());
    setStatus('Key verified. The sealed brief is now readable.');
  }

  function download() {
    if (!offer || !decrypted) return;
    const markdown = briefToMarkdown(offer.brief, decrypted, offer.paymentHash);
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${offer.brief.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fiberbrief'}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    if (busy || (attempt && payment?.status !== 'Failed')) return;
    save({ generatedOffer: '', buyerOfferText: '', attemptedPaymentHash: '', triedWithoutKey: false, completedSteps: [] });
    setGenerated(''); setReceived(''); setOffer(null); setAttempt(''); setTested(false);
    setPayment(null); setKey(''); setDecrypted(''); setVerified(false); setDigestOk(false);
    setUnlockedAt(''); setSealedAt(''); setError(''); setStatus('The desk is clear. Seal a new brief when ready.');
  }

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setStatus(`${label} copied.`);
  }

  const routeReady = Boolean(
    connected.buyer && connected.seller
    && channels.buyer && ready(channels.buyer) && BigInt(channels.buyer.local_balance) >= 100_000_000n
    && channels.seller && ready(channels.seller) && BigInt(channels.seller.remote_balance) >= 100_000_000n,
  );
  const canSubmit = Boolean(offer && tested && routeReady && !key && (!attempt || payment?.status === 'Failed'));
  const bothRunning = Boolean(addresses.buyer && addresses.seller);
  const bothReady = Boolean(channels.buyer && ready(channels.buyer) && channels.seller && ready(channels.seller));
  const stage = decrypted ? 4 : key ? 3 : offer ? 2 : generated ? 1 : 0;

  return <>
    <header className="topbar">
      <a className="brand" href="#top" aria-label="FiberBrief home">
        <span className="brandMark">F</span>
        <span>FiberBrief</span>
      </a>
      <nav className="topnav" aria-label="Page sections">
        <a href="#how">How it works</a>
        <a href="#desk">Demo desk</a>
        <a href="#setup">Testnet setup</a>
      </nav>
      <span className={`network ${bothReady ? 'networkLive' : ''}`}>
        <span className="networkDot" /> {bothReady ? 'Fiber Testnet · route ready' : 'Fiber Testnet'}
      </span>
    </header>

    <main id="top">
      <section className="hero">
        <p className="eyebrow">Pay-per-unlock research · CKB Testnet</p>
        <h1>Knowledge that unlocks<br /><em>on payment.</em></h1>
        <p className="heroCopy">
          A seller seals a research brief inside an AES-256-GCM envelope and issues a Fiber invoice.
          The payment preimage is the decryption key. No subscription, no account, no trusted middleman —
          the buyer pays 1 CKB and the report opens.
        </p>
        <div className="heroMeta">
          <span><strong>1 CKB</strong> fixed price</span>
          <span><strong>AES-256-GCM</strong> sealed content</span>
          <span><strong>SHA-256</strong> verified key</span>
        </div>
        <a className="primary heroCta" href="#desk">Open the demo desk <span>↓</span></a>
      </section>

      <section id="how" className="how">
        <div className="sectionHead">
          <p className="eyebrow">The mechanism</p>
          <h2>Four moves, one atomic promise</h2>
        </div>
        <ol className="steps">
          {[
            ['01', 'Seal', 'The seller encrypts the full brief. The AES key never leaves the seller node — it becomes the invoice preimage.'],
            ['02', 'Publish', 'The encrypted offer carries the ciphertext, IV, invoice, and a last-hop hint. The free preview stays public.'],
            ['03', 'Pay', 'The buyer pays 1 CKB over Fiber. HTLCs hold the payment until the seller reveals the preimage to settle.'],
            ['04', 'Unlock', 'The revealed preimage decrypts the brief. SHA-256 proves the key matches the invoice; the content hash proves the file.'],
          ].map(([number, title, copy]) => (
            <li key={number} className={stage >= Number(number) ? 'stepActive' : ''}>
              <span className="stepNumber">{number}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="setup" className="setupCard">
        <div className="setupHead">
          <div>
            <p className="eyebrow">Testnet setup</p>
            <h2>Two browser nodes, one route</h2>
            <p className="muted">Fund each node, open a 500 CKB channel with Bottle, and wait for <code>CHANNEL_READY</code>. {channelFundingGuidance}</p>
          </div>
          <button className="ghost" onClick={() => setSetupOpen((value) => !value)} aria-expanded={setupOpen}>
            {setupOpen ? 'Hide setup' : 'Show setup'}
          </button>
        </div>

        {setupOpen && <>
          <div className="nodeGrid">
            {(['buyer', 'seller'] as const).map((role) => {
              const channel = channels[role];
              const isReady = Boolean(channel && ready(channel));
              return <article className="nodeCard" key={role}>
                <div className="nodeTop">
                  <div>
                    <p className="nodeLabel">{role === 'buyer' ? 'Buyer A' : 'Seller C'}</p>
                    <p className="nodeSub">{role === 'buyer' ? 'pays the invoice' : 'seals the brief'}</p>
                  </div>
                  <span className={`nodeState ${isReady ? 'ok' : addresses[role] ? 'warn' : ''}`}>
                    {isReady ? 'CHANNEL_READY' : addresses[role] ? 'Starting' : 'Not started'}
                  </span>
                </div>

                {!addresses[role] && <button disabled={!loaded || busy} onClick={() => void run(() => start(role))}>
                  Start {role === 'buyer' ? 'Buyer A' : 'Seller C'}
                </button>}

                {addresses[role] && <>
                  <div className="addressRow">
                    <code title={addresses[role]}>{short(addresses[role]!, 16, 10)}</code>
                    <button className="mini" onClick={() => void run(() => copy(addresses[role]!, `${role === 'buyer' ? 'Buyer' : 'Seller'} funding address`))}>Copy</button>
                  </div>
                  <div className="linkRow">
                    <a href="https://faucet.nervos.org" target="_blank" rel="noreferrer">Get Testnet CKB ↗</a>
                    <button className="mini" disabled={busy} onClick={() => void run(() => refresh(role))}>Refresh balance</button>
                  </div>
                  <button className="ghost" disabled={busy} onClick={() => void run(() => open(role))}>
                    {channel ? 'Reconnect / check channel' : `Open ${channelFundingCkb} CKB channel`}
                  </button>
                </>}

                {channel && <div className="balanceRow">
                  <span>Node side <strong>{ckb(channel.local_balance)} CKB</strong></span>
                  <span>Bottle side <strong>{ckb(channel.remote_balance)} CKB</strong></span>
                </div>}
              </article>;
            })}
          </div>
          <div className="setupFoot">
            <span className={`routePill ${bothReady ? 'routeReady' : ''}`}>
              {bothReady ? 'Route ready · A → Bottle → C' : bothRunning ? 'Waiting for both channels' : 'Start both nodes to begin'}
            </span>
            <button className="ghost" disabled={busy || !channels.seller || !ready(channels.seller) || BigInt(channels.seller.local_balance) < 500_000_000n} onClick={() => void run(moveLiquidity)}>
              Send / check 5 CKB liquidity transfer
            </button>
            <span className="muted small">{bottle.pubkey.slice(0, 14)}…{bottle.pubkey.slice(-8)} · Bottle B</span>
          </div>
        </>}
      </section>

      {(status || error) && <div className={`banner ${error ? 'bannerError' : ''}`} role={error ? 'alert' : 'status'}>
        <span>{error ? '!' : '●'}</span>
        <p>{error || status}</p>
      </div>}

      <section id="desk" className="desk">
        <div className="sectionHead deskHead">
          <div>
            <p className="eyebrow">The demo desk</p>
            <h2>Seal on one side. Pay on the other.</h2>
          </div>
          <p className="muted deskNote">Both panels run in this tab on separate Fiber nodes. The seller hands the public offer JSON to the buyer; the brief body stays encrypted in transit.</p>
        </div>

        <div className="deskGrid">
          <article className="panel sellerPanel">
            <div className="panelHead">
              <span className="panelTag">Seller · Node C</span>
              <span className={`pill ${generated ? 'pillDone' : ''}`}>{generated ? 'Sealed' : 'Draft'}</span>
            </div>
            <h3>Seal a research brief</h3>

            {!generated ? <>
              <label>Title<input value={draft.title} maxLength={120} disabled={busy} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
              <label>Byline<input value={draft.byline} maxLength={80} disabled={busy} onChange={(event) => setDraft({ ...draft, byline: event.target.value })} /></label>
              <label>Free preview <span className="labelNote">public, unencrypted</span>
                <textarea className="previewInput" value={draft.preview} maxLength={900} disabled={busy} onChange={(event) => setDraft({ ...draft, preview: event.target.value })} />
              </label>
              <label>Full brief <span className="labelNote">encrypted before it leaves</span>
                <textarea className="bodyInput" value={draft.body} maxLength={40_000} disabled={busy} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
              </label>
              <div className="sealMeta">
                <span>{countWords(draft.body).toLocaleString()} words</span>
                <span>1 CKB</span>
                <span>AES-256-GCM</span>
              </div>
              <button className="primary" disabled={busy || !routeReady || !draft.title.trim() || !draft.byline.trim() || !draft.body.trim() || Boolean(attempt)} onClick={() => void run(seal)}>
                {routeReady ? 'Seal brief & issue 1 CKB invoice' : 'Waiting for both channels…'}
              </button>
              <p className="finePrint">The AES key becomes the invoice preimage. Only the ciphertext, IV, hash, and public preview enter the offer.</p>
            </> : <>
              <div className="sealedBrief">
                <p className="eyebrow">Sealed publication</p>
                <h4>{draft.title}</h4>
                <p>{draft.byline}</p>
                <div className="sealMeta">
                  <span>{countWords(draft.body).toLocaleString()} words sealed</span>
                  <span>{sealedAt ? new Date(sealedAt).toLocaleDateString() : 'Just now'}</span>
                </div>
              </div>
              <details className="offerDetails">
                <summary>View public offer JSON</summary>
                <textarea readOnly value={generated} aria-label="Public offer JSON" />
              </details>
              <button className="primary" onClick={() => void run(() => copy(generated, 'Public offer'))}>Copy offer for buyer</button>
              <p className="finePrint">Share this JSON however you like. It contains no key and no plaintext. Only this seller node holds the preimage.</p>
              {(!attempt || payment?.status === 'Failed') && <button className="ghost" disabled={busy} onClick={() => void run(async () => reset())}>Create another brief</button>}
            </>}
          </article>

          <article className="panel buyerPanel">
            <div className="panelHead">
              <span className="panelTag">Buyer · Node A</span>
              <span className={`pill ${key ? 'pillDone' : ''}`}>{key ? 'Key received' : offer ? 'Inspecting' : 'Reader'}</span>
            </div>
            <h3>Open a sealed brief</h3>

            {!offer && <>
              <label>Offer JSON from the seller
                <textarea className="offerInput" value={received} disabled={busy || Boolean(attempt)} placeholder="Paste the seller's public offer JSON here…" onChange={(event) => { setReceived(event.target.value); setTested(false); }} />
              </label>
              <button className="primary" disabled={busy || !received.trim() || !addresses.buyer} onClick={() => void run(inspect)}>Inspect offer</button>
              <p className="finePrint">Inspection parses the invoice locally, checks network and amount, and verifies the payment hash. No payment is sent.</p>
            </>}

            {offer && <>
              <div className="previewCard">
                <span className="previewBadge">Free preview</span>
                <h4>{offer.brief.title}</h4>
                <p className="byline">{offer.brief.byline}</p>
                <p>{offer.brief.preview || 'No preview provided.'}</p>
                <div className="lockedBody">
                  <span className="lockGlyph">▮▮</span>
                  <div>
                    <strong>The full brief is sealed</strong>
                    <p>{offer.brief.wordCount.toLocaleString()} words · unlock for 1 CKB</p>
                  </div>
                </div>
              </div>

              <div className="invoiceLine">
                <span>Invoice</span>
                <code>{short(offer.invoice, 18, 10)}</code>
              </div>

              {!tested && <button className="ghost" disabled={busy} onClick={() => void run(testLock)}>Try to read without paying</button>}
              {tested && !decrypted && <p className="rejected"><span>✕</span> Decryption rejected. The AES key is not in the public offer — it is the invoice preimage, revealed only when the payment settles.</p>}

              {canSubmit && <button className="primary payButton" disabled={busy} onClick={() => void run(pay)}>
                {attempt ? 'Retry failed payment' : 'Pay 1 CKB to unlock'}
              </button>}
              {attempt && !key && <button className="ghost" disabled={busy || !offer || !addresses.buyer} onClick={() => void run(checkPayment)}>Check payment status</button>}
              {key && !decrypted && <button className="primary" disabled={busy} onClick={() => void run(unlock)}>Verify key & read brief</button>}

              {payment?.status === 'Success' && <div className="receipt">
                <div className="receiptHead"><span>Payment receipt</span><span className="receiptStatus">SETTLED</span></div>
                <dl>
                  <div><dt>Amount</dt><dd>1 CKB</dd></div>
                  <div><dt>Routing fee</dt><dd>{ckb(payment.fee)} CKB</dd></div>
                  <div><dt>Total paid</dt><dd>{ckb(`0x${(100_000_000n + BigInt(payment.fee ?? '0x0')).toString(16)}`)} CKB</dd></div>
                </dl>
                <code title={payment.payment_hash}>{payment.payment_hash}</code>
                <p className="finePrint">Payment hash is also the SHA-256 fingerprint of the key that just unlocked the brief.</p>
              </div>}

              {!key && payment?.status !== 'Success' && <p className="finePrint">The key is returned by the Fiber payment, not by this app. Until the invoice settles, the ciphertext is unreadable.</p>}
            </>}
          </article>
        </div>
      </section>

      {decrypted && offer && <article className="reader" id="reader">
        <div className="readerHead">
          <div>
            <p className="eyebrow">Unlocked · Buyer's copy</p>
            <h2>{offer.brief.title}</h2>
            <p className="byline">{offer.brief.byline}</p>
          </div>
          <div className="unlockSeal"><span>UNLOCKED</span><small>{new Date(unlockedAt).toLocaleTimeString()}</small></div>
        </div>

        <div className="prose">{renderBrief(decrypted)}</div>

        <div className="proofGrid">
          <div className="proofCard">
            <p className="eyebrow">Key proof</p>
            <p className={verified ? 'proofOk' : 'proofBad'}>{verified ? '✓ SHA-256(preimage) matches the invoice payment hash' : 'Key not verified'}</p>
            <code>{offer.paymentHash}</code>
          </div>
          <div className="proofCard">
            <p className="eyebrow">Content proof</p>
            <p className={digestOk ? 'proofOk' : 'proofBad'}>{digestOk ? '✓ Decrypted bytes match the sealed content hash' : 'Digest not checked'}</p>
            <code>{offer.contentHash}</code>
          </div>
          <div className="proofCard">
            <p className="eyebrow">Receipt</p>
            <p>1 CKB settled · fee {ckb(payment?.fee)} CKB</p>
            <code>{payment?.payment_hash ?? offer.paymentHash}</code>
          </div>
        </div>

        <div className="readerActions">
          <button className="primary" onClick={download}>Download brief as Markdown</button>
          <button className="ghost" onClick={() => void run(() => copy(offer.paymentHash, 'Payment hash'))}>Copy payment hash</button>
          {(!attempt || payment?.status === 'Failed') && <button className="ghost" onClick={() => void run(async () => reset())}>Start another brief</button>}
        </div>
        <p className="finePrint readerNote">The decrypted body lives only in this tab. It is never written to application storage or sent back to the seller node.</p>
      </article>}

      <section className="notes">
        <div>
          <p className="eyebrow">What this demo adds</p>
          <h2>Beyond the starter</h2>
        </div>
        <div className="noteGrid">
          <article><h3>Free preview, sealed body</h3><p>Only the full brief is encrypted. The preview is a deliberate, public part of the offer so a buyer can judge the work before paying.</p></article>
          <article><h3>Proof, not just access</h3><p>The app recomputes both hashes after payment: the preimage against the invoice, and the ciphertext against the sealed content hash.</p></article>
          <article><h3>Portable receipt</h3><p>The buyer can download the unlocked brief as Markdown, carrying the payment hash and verification details with it.</p></article>
        </div>
      </section>

      <footer>
        <span>FiberBrief · a pay-to-unlock demo on CKB Testnet</span>
        <span>No mainnet funds. No custody. No plaintext in the offer.</span>
      </footer>
    </main>
  </>;
}

function renderBrief(body: string) {
  const blocks = body.trim().split(/\n{2,}/);
  return blocks.map((block, index) => {
    const trimmed = block.trim();
    if (trimmed.startsWith('## ')) return <h3 key={index}>{trimmed.slice(3)}</h3>;
    if (trimmed.split('\n').every((line) => line.trim().startsWith('- '))) {
      return <ul key={index}>{trimmed.split('\n').map((line, item) => <li key={item}>{line.trim().slice(2)}</li>)}</ul>;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      return <ol key={index}>{trimmed.split('\n').map((line, item) => <li key={item}>{line.replace(/^\d+\.\s*/, '')}</li>)}</ol>;
    }
    return <p key={index}>{trimmed}</p>;
  });
}

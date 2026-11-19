import { bottle } from './fiber';
import type { Channel, FiberBrowserNode } from '@fiber-pay/sdk/browser';
import { encryptResult, sha256Hex, type EncryptedPayload } from './crypto';

export const BRIEF_PRICE_CKB = 1;
export const BRIEF_PRICE_HEX = '0x5f5e100' as const;

export type BriefMeta = {
  title: string;
  byline: string;
  preview: string;
  wordCount: number;
  sealedAt: string;
};

export type BriefOffer = EncryptedPayload & {
  version: 2;
  kind: 'fiberbrief';
  cipher: 'AES-256-GCM';
  brief: BriefMeta;
  priceCkb: 1;
  contentHash: `0x${string}`;
  invoice: string;
  paymentHash: `0x${string}`;
  lastHop: {
    pubkey: `0x${string}`;
    channel_outpoint: `0x${string}`;
    fee_rate: `0x${string}`;
    tlc_expiry_delta: `0x${string}`;
  };
};

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeHexBytes(value: unknown, label: string, bytes?: number) {
  if (typeof value !== 'string') throw new Error(`${label} is missing.`);
  const body = value.trim().replace(/^0x/i, '');
  if (!body || body.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(body)) {
    throw new Error(`${label} must be hexadecimal bytes.`);
  }
  if (bytes !== undefined && body.length !== bytes * 2) {
    throw new Error(`${label} must be ${bytes} bytes.`);
  }
  return `0x${body.toLowerCase()}` as `0x${string}`;
}

function normalizeHexQuantity(value: unknown, label: string) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return `0x${value.toString(16)}` as `0x${string}`;
  }
  if (typeof value !== 'string') throw new Error(`${label} is missing.`);
  const normalized = value.trim();
  if (/^0x[0-9a-f]+$/i.test(normalized)) {
    return `0x${BigInt(normalized).toString(16)}` as `0x${string}`;
  }
  if (/^\d+$/.test(normalized)) {
    return `0x${BigInt(normalized).toString(16)}` as `0x${string}`;
  }
  throw new Error(`${label} must be a non-negative integer.`);
}

function packOutpoint(txHash: `0x${string}`, index: `0x${string}`) {
  const indexValue = BigInt(index);
  if (indexValue > 0xffff_ffffn) throw new Error('Last-hop output index exceeds u32.');
  const indexBytes = indexValue
    .toString(16)
    .padStart(8, '0')
    .match(/../g)
    ?.reverse()
    .join('');
  return `0x${txHash.slice(2)}${indexBytes}` as `0x${string}`;
}

function normalizeOutpoint(value: unknown): BriefOffer['lastHop']['channel_outpoint'] {
  if (isJsonObject(value)) {
    return packOutpoint(
      normalizeHexBytes(value.tx_hash ?? value.txHash, 'Last-hop transaction hash', 32),
      normalizeHexQuantity(value.index, 'Last-hop output index'),
    );
  }
  if (typeof value === 'string' && /^0x[0-9a-f]{72}$/i.test(value.trim())) {
    return value.trim().toLowerCase() as `0x${string}`;
  }
  throw new Error('Last-hop channel outpoint is missing or malformed.');
}

function normalizeLastHop(value: unknown): BriefOffer['lastHop'] {
  if (!isJsonObject(value)) throw new Error('Last-hop hint is missing.');
  if (normalizeHexBytes(value.pubkey, 'Last-hop public key', 33) !== bottle.pubkey) {
    throw new Error('Last-hop hint must identify Bottle.');
  }
  return {
    pubkey: normalizeHexBytes(value.pubkey, 'Last-hop public key', 33),
    channel_outpoint: normalizeOutpoint(value.channel_outpoint ?? value.channelOutpoint),
    fee_rate: normalizeHexQuantity(value.fee_rate ?? value.feeRate, 'Last-hop fee rate'),
    tlc_expiry_delta: normalizeHexQuantity(
      value.tlc_expiry_delta ?? value.tlcExpiryDelta,
      'Last-hop expiry delta',
    ),
  };
}

function normalizeText(value: unknown, label: string, maxLength: number, required = true) {
  if (typeof value !== 'string') throw new Error(`${label} is missing.`);
  const text = value.trim();
  if (required && !text) throw new Error(`${label} is empty.`);
  if (text.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return text;
}

function normalizeBrief(value: unknown): BriefMeta {
  if (!isJsonObject(value)) throw new Error('Brief metadata is missing.');
  const wordCount = Number(value.wordCount);
  if (!Number.isSafeInteger(wordCount) || wordCount < 1 || wordCount > 100_000) {
    throw new Error('Brief word count is invalid.');
  }
  const sealedAt = normalizeText(value.sealedAt, 'Sealed timestamp', 40);
  if (Number.isNaN(Date.parse(sealedAt))) throw new Error('Sealed timestamp is invalid.');
  return {
    title: normalizeText(value.title, 'Brief title', 120),
    byline: normalizeText(value.byline, 'Byline', 80),
    preview: normalizeText(value.preview, 'Free preview', 900, false),
    wordCount,
    sealedAt,
  };
}

export function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

export async function createBriefOffer(
  seller: FiberBrowserNode,
  sellerChannel: Channel,
  brief: { title: string; byline: string; preview: string; body: string },
) {
  if (!sellerChannel.channel_outpoint) {
    throw new Error('Seller channel does not have a confirmed outpoint.');
  }
  const title = normalizeText(brief.title, 'Brief title', 120);
  const byline = normalizeText(brief.byline, 'Byline', 80);
  const preview = normalizeText(brief.preview, 'Free preview', 900, false);
  const body = normalizeText(brief.body, 'Full brief', 40_000);
  const encrypted = await encryptResult(body);
  const contentHash = await sha256Hex(encrypted.payload.ciphertext);
  const invoice = await seller.newInvoice({
    amount: BRIEF_PRICE_HEX,
    currency: 'Fibt',
    payment_preimage: encrypted.key,
    hash_algorithm: 'sha256',
    allow_trampoline_routing: true,
    description: `FiberBrief: ${title.slice(0, 64)}`,
    expiry: '0xe10',
  });
  const offer: BriefOffer = {
    version: 2,
    kind: 'fiberbrief',
    cipher: 'AES-256-GCM',
    brief: {
      title,
      byline,
      preview,
      wordCount: countWords(body),
      sealedAt: new Date().toISOString(),
    },
    priceCkb: 1,
    contentHash,
    ...encrypted.payload,
    invoice: invoice.invoice_address,
    paymentHash: invoice.invoice.data.payment_hash,
    lastHop: {
      pubkey: sellerChannel.pubkey,
      channel_outpoint: normalizeOutpoint(sellerChannel.channel_outpoint),
      fee_rate: normalizeHexQuantity(
        sellerChannel.tlc_fee_proportional_millionths,
        'Last-hop fee rate',
      ),
      tlc_expiry_delta: normalizeHexQuantity(
        sellerChannel.tlc_expiry_delta,
        'Last-hop expiry delta',
      ),
    },
  };
  return JSON.stringify(offer, null, 2);
}

export function parseBriefOffer(value: string): BriefOffer {
  const offer: unknown = JSON.parse(value);
  if (!isJsonObject(offer) || offer.version !== 2 || offer.kind !== 'fiberbrief'
    || offer.cipher !== 'AES-256-GCM') {
    throw new Error('This is not a FiberBrief version 2 encrypted offer.');
  }
  if (offer.priceCkb !== BRIEF_PRICE_CKB) throw new Error('This offer is not priced at 1 CKB.');
  if (typeof offer.invoice !== 'string' || !offer.invoice.toLowerCase().startsWith('fibt')) {
    throw new Error('Offer is missing a Fiber testnet invoice.');
  }
  return {
    version: 2,
    kind: 'fiberbrief',
    cipher: 'AES-256-GCM',
    brief: normalizeBrief(offer.brief),
    priceCkb: 1,
    contentHash: normalizeHexBytes(offer.contentHash, 'Content hash', 32),
    ciphertext: normalizeHexBytes(offer.ciphertext, 'Ciphertext'),
    iv: normalizeHexBytes(offer.iv, 'AES-GCM IV', 12),
    invoice: offer.invoice,
    paymentHash: normalizeHexBytes(offer.paymentHash, 'Invoice payment hash', 32),
    lastHop: normalizeLastHop(offer.lastHop),
  };
}

export function briefToMarkdown(brief: BriefMeta, body: string, paymentHash: string) {
  return [
    `# ${brief.title}`,
    '',
    `*${brief.byline}*`,
    '',
    `Unlocked with Fiber. Payment hash: \`${paymentHash}\``,
    '',
    body.trim(),
    '',
    '---',
    `Sealed ${brief.sealedAt} · ${brief.wordCount} words · Fiber Testnet`,
    '',
  ].join('\n');
}

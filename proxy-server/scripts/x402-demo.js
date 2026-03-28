"use strict";

const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");

const RPC_URL = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const API_BASE = process.env.X402_API_BASE || "http://localhost:3001";
const BUYER_IP = process.env.AGENT_IP || "127.0.0.1";
const LISTING_ID = process.env.HOTSPOT_LISTING_ID || "local-hotspot";
const MINUTES = Number(process.env.MINUTES || 10);
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

function getKeypair() {
  const raw = process.env.SOLANA_SECRET_KEY;
  if (!raw) {
    throw new Error("Set SOLANA_SECRET_KEY to a JSON array exported from a devnet wallet.");
  }

  const bytes = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(bytes);
}

async function requestChallenge(buyerWallet) {
  const res = await fetch(`${API_BASE}/x402/sessions/purchase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ip: BUYER_IP,
      listingId: LISTING_ID,
      minutes: MINUTES,
      buyerWallet,
      tier: "priority",
    }),
  });

  const body = await res.json();
  if (res.status !== 402) {
    throw new Error(`Expected HTTP 402, received ${res.status}: ${JSON.stringify(body)}`);
  }

  return body.accepts[0];
}

async function payChallenge({ payTo, amount, extra, memo }, payer) {
  const connection = new Connection(RPC_URL, "confirmed");
  const reference = new PublicKey(extra.reference);
  const recipient = new PublicKey(payTo);
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({
    feePayer: payer.publicKey,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports: Number(amount),
    }),
    new TransactionInstruction({
      keys: [{ pubkey: reference, isSigner: false, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memo || `netra:${extra.reference}`),
    })
  );

  return sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });
}

async function finalizePurchase({ signature, reference, buyerWallet }) {
  const res = await fetch(`${API_BASE}/x402/sessions/purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Payment-Signature": signature,
    },
    body: JSON.stringify({
      ip: BUYER_IP,
      listingId: LISTING_ID,
      minutes: MINUTES,
      buyerWallet,
      reference,
      tier: "priority",
    }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Payment finalize failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  const payer = getKeypair();
  const buyerWallet = payer.publicKey.toBase58();
  const challenge = await requestChallenge(buyerWallet);
  const signature = await payChallenge(challenge, payer);
  const result = await finalizePurchase({
    signature,
    reference: challenge.extra.reference,
    buyerWallet,
  });

  console.log(JSON.stringify({ challenge, signature, result }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

"use strict";

const crypto = require("crypto");
const {
  Connection,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

function getSolanaRpcUrl() {
  return process.env.SOLANA_RPC || clusterApiUrl("devnet");
}

function normalizeWallet(wallet) {
  if (!wallet) return null;
  try {
    return new PublicKey(wallet).toBase58();
  } catch {
    return null;
  }
}

function generateReference() {
  return new PublicKey(crypto.randomBytes(32)).toBase58();
}

function formatSol(amountLamports) {
  return Number(amountLamports) / LAMPORTS_PER_SOL;
}

function explorerUrl(signature) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

async function verifySolanaPayment({
  signature,
  reference,
  destination,
  amountLamports,
  rpcUrl = getSolanaRpcUrl(),
}) {
  if (!signature) {
    throw new Error("Missing Solana transaction signature");
  }

  if (!reference) {
    throw new Error("Missing payment reference");
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const parsed = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  if (!parsed) {
    throw new Error("Transaction not found on Solana devnet");
  }

  if (parsed.meta?.err) {
    throw new Error("Transaction failed on-chain");
  }

  const accountKeys = parsed.transaction.message.accountKeys.map((entry) => ({
    pubkey:
      entry && typeof entry === "object" && "pubkey" in entry
        ? entry.pubkey.toBase58()
        : String(entry),
    signer: Boolean(entry && typeof entry === "object" && "signer" in entry && entry.signer),
  }));

  const includesReference = accountKeys.some((entry) => entry.pubkey === reference);
  if (!includesReference) {
    throw new Error("Transaction is missing the required x402 payment reference");
  }

  const expectedDestination = normalizeWallet(destination);
  if (!expectedDestination) {
    throw new Error("Destination wallet is not configured");
  }

  const transfer = parsed.transaction.message.instructions.find((instruction) => {
    if (!("parsed" in instruction) || instruction.program !== "system") return false;
    if (instruction.parsed?.type !== "transfer") return false;
    const info = instruction.parsed.info || {};
    return (
      info.destination === expectedDestination &&
      Number(info.lamports || 0) >= Number(amountLamports || 0)
    );
  });

  if (!transfer) {
    throw new Error("Transaction does not pay the required hotspot amount");
  }

  const buyerWallet =
    accountKeys.find((entry) => entry.signer)?.pubkey || null;

  const memoPresent = parsed.transaction.message.instructions.some((instruction) => {
    if (!("programId" in instruction)) return false;
    return instruction.programId?.toBase58?.() === MEMO_PROGRAM_ID.toBase58();
  });

  return {
    signature,
    slot: parsed.slot,
    buyerWallet,
    transferredLamports: Number(transfer.parsed.info.lamports || 0),
    memoPresent,
    explorerUrl: explorerUrl(signature),
  };
}

module.exports = {
  LAMPORTS_PER_SOL,
  explorerUrl,
  formatSol,
  generateReference,
  getSolanaRpcUrl,
  normalizeWallet,
  verifySolanaPayment,
};

"use strict";

const crypto = require("crypto");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
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

function parseSecretKey(value, envName) {
  if (!value) return null;

  // Try JSON array first (e.g. [1,2,3,...])
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return Uint8Array.from(parsed);
    }
  } catch (_) {
    // not JSON — fall through to base58
  }

  // Try base58 (e.g. the DEMO_BUYER_PRIVKEY burner key)
  try {
    const bs58 = require("bs58");
    const decoded = bs58.decode(value);
    if (decoded.length === 64) return decoded;
  } catch (_) {
    // not valid base58
  }

  throw new Error(`${envName} must be a JSON array or base58 Solana secret key`);
}

function createNetraDemoRefundKeypair() {
  const seed = crypto
    .createHash("sha256")
    .update("netra-demo-refund-treasury-v1")
    .digest()
    .subarray(0, 32);

  return Keypair.fromSeed(seed);
}

function getRefundKeypair(rpcUrl = getSolanaRpcUrl()) {
  if (process.env.SOLANA_REFUND_SECRET_KEY) {
    return Keypair.fromSecretKey(
      parseSecretKey(process.env.SOLANA_REFUND_SECRET_KEY, "SOLANA_REFUND_SECRET_KEY")
    );
  }

  if (String(rpcUrl).includes("devnet")) {
    return createNetraDemoRefundKeypair();
  }

  return null;
}

async function ensureRefundBalance(connection, keypair, minimumLamports) {
  const currentBalance = await connection.getBalance(keypair.publicKey, "confirmed");
  if (currentBalance >= minimumLamports) {
    return { currentBalance, airdropSignature: null };
  }

  if (!String(connection.rpcEndpoint || "").includes("devnet")) {
    throw new Error("Refund wallet is underfunded and automatic top-ups are only enabled on devnet");
  }

  const topUpLamports = Math.max(
    LAMPORTS_PER_SOL,
    minimumLamports - currentBalance + Math.round(0.05 * LAMPORTS_PER_SOL)
  );

  const airdropSignature = await connection.requestAirdrop(keypair.publicKey, topUpLamports);
  const blockhash = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      signature: airdropSignature,
      blockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
    },
    "confirmed"
  );

  return { currentBalance, airdropSignature };
}

async function sendSolanaRefund({
  destination,
  amountLamports,
  memo,
  rpcUrl = getSolanaRpcUrl(),
}) {
  const lamports = Number(amountLamports || 0);
  if (!lamports) {
    return { status: "not_needed" };
  }

  const normalizedDestination = normalizeWallet(destination);
  if (!normalizedDestination) {
    return { status: "unavailable", error: "Missing buyer wallet for refund" };
  }

  const refundKeypair = getRefundKeypair(rpcUrl);
  if (!refundKeypair) {
    return { status: "pending_config", error: "Refund signer is not configured" };
  }

  const refundSource = refundKeypair.publicKey.toBase58();
  // Note: same-wallet self-transfers are valid on Solana and produce a real tx hash.
  // In demo mode the burner is both buyer and refund source — we let it go through.

  const connection = new Connection(rpcUrl, "confirmed");
  await ensureRefundBalance(connection, refundKeypair, lamports + 10_000);

  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: refundKeypair.publicKey,
    recentBlockhash: latest.blockhash,
  });

  transaction.add(
    SystemProgram.transfer({
      fromPubkey: refundKeypair.publicKey,
      toPubkey: new PublicKey(normalizedDestination),
      lamports,
    })
  );

  if (memo) {
    transaction.add(new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(String(memo), "utf8"),
    }));
  }

  const signature = await connection.sendTransaction(transaction, [refundKeypair], {
    maxRetries: 3,
    preflightCommitment: "confirmed",
  });

  await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed"
  );

  return {
    status: "sent",
    signature,
    explorerUrl: explorerUrl(signature),
    sourceWallet: refundSource,
  };
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
  sendSolanaRefund,
  verifySolanaPayment,
};

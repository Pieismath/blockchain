"use strict";

const fs = require("fs");
const path = require("path");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

async function createDeterministicCid(payload) {
  const [{ CID }, raw, { sha256 }] = await Promise.all([
    import("multiformats/cid"),
    import("multiformats/codecs/raw"),
    import("multiformats/hashes/sha2"),
  ]);

  const bytes = Buffer.from(JSON.stringify(payload));
  const hash = await sha256.digest(bytes);
  return CID.createV1(raw.code, hash).toString();
}

async function maybeUploadWithSynapse({ bytes, metadata }) {
  const privateKey = process.env.FILECOIN_PRIVATE_KEY;
  if (!privateKey) {
    return {
      enabled: false,
      uploaded: false,
      reason: "FILECOIN_PRIVATE_KEY not set",
    };
  }

  try {
    const [{ Synapse, calibration, mainnet, devnet }, { http }, { privateKeyToAccount }] =
      await Promise.all([
        import("@filoz/synapse-sdk"),
        import("viem"),
        import("viem/accounts"),
      ]);

    const network = process.env.FILECOIN_NETWORK || "calibration";
    const chainMap = { calibration, mainnet, devnet };
    const chain = chainMap[network] || calibration;
    const transport = http(
      process.env.FILECOIN_RPC_URL ||
        chain.rpcUrls.default.http[0]
    );

    const synapse = Synapse.create({
      account: privateKeyToAccount(privateKey),
      chain,
      transport,
      withCDN: process.env.FILECOIN_WITH_CDN === "true",
      source: process.env.FILECOIN_SOURCE || "netra",
    });

    const result = await synapse.storage.upload(new Blob([bytes]), {
      pieceMetadata: metadata,
    });

    return {
      enabled: true,
      uploaded: true,
      network,
      pieceCid: String(result.pieceCid),
      copies: result.copies?.length || 0,
    };
  } catch (error) {
    return {
      enabled: true,
      uploaded: false,
      reason: error instanceof Error ? error.message : "Synapse upload failed",
    };
  }
}

function createArtifactStore({ dataDir }) {
  const artifactsDir = path.join(dataDir, "artifacts");
  ensureDir(artifactsDir);

  return {
    dataDir,
    readJson,
    writeJson,
    async persist(kind, payload, metadata = {}) {
      const cid = await createDeterministicCid(payload);
      const filePath = path.join(artifactsDir, `${cid}.json`);
      const bytes = Buffer.from(JSON.stringify(payload, null, 2));
      fs.writeFileSync(filePath, bytes);

      const synapse = await maybeUploadWithSynapse({
        bytes,
        metadata: Object.fromEntries(
          Object.entries({
            artifactKind: kind,
            cid,
            ...metadata,
          }).map(([key, value]) => [key, String(value ?? "")])
        ),
      });

      return {
        kind,
        cid,
        createdAt: new Date().toISOString(),
        localPath: filePath,
        synapse,
      };
    },
  };
}

module.exports = {
  createArtifactStore,
  ensureDir,
  readJson,
  writeJson,
};

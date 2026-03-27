/**
 * Hardhat deploy script for HotspotEscrow.
 *
 * Usage (from /contracts directory):
 *   Terminal 1:  npm run node          # starts local Hardhat node on port 8545
 *   Terminal 2:  npm run deploy        # deploys and prints contract address
 */

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("\n─────────────────────────────────────────");
  console.log("  HotspotEscrow Deployment");
  console.log("─────────────────────────────────────────");
  console.log(`Deployer : ${deployer.address}`);
  console.log(
    `Balance  : ${hre.ethers.formatEther(
      await hre.ethers.provider.getBalance(deployer.address)
    )} ETH`
  );

  // Deploy
  const HotspotEscrow = await hre.ethers.getContractFactory("HotspotEscrow");
  const contract = await HotspotEscrow.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();

  console.log(`\nContract : ${address}`);
  console.log("─────────────────────────────────────────\n");
  console.log("Copy the contract address above into your frontend .env.local:");
  console.log(`  NEXT_PUBLIC_ESCROW_ADDRESS=${address}`);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

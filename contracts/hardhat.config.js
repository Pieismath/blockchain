require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Local Hardhat node — run `npm run node` first, then `npm run deploy`
    localhost: {
      url: "http://127.0.0.1:8545",
    },
  },
};

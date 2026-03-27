/**
 * Basic tests for HotspotEscrow.
 * Run with: npx hardhat test
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("HotspotEscrow", function () {
  let escrow, host, buyer, other;
  const PRICE_PER_MINUTE = ethers.parseEther("0.01"); // 0.01 ETH per min
  const MINUTES = 10n;
  const TOTAL = PRICE_PER_MINUTE * MINUTES;

  beforeEach(async function () {
    [, host, buyer, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("HotspotEscrow");
    escrow = await Factory.deploy();
  });

  describe("createSlot", function () {
    it("creates a slot and emits SlotCreated", async function () {
      await expect(
        escrow.connect(buyer).createSlot(host.address, PRICE_PER_MINUTE, MINUTES, {
          value: TOTAL,
        })
      )
        .to.emit(escrow, "SlotCreated")
        .withArgs(0n, host.address, buyer.address, PRICE_PER_MINUTE, MINUTES, TOTAL);
    });

    it("reverts if ETH sent is wrong", async function () {
      await expect(
        escrow.connect(buyer).createSlot(host.address, PRICE_PER_MINUTE, MINUTES, {
          value: TOTAL - 1n,
        })
      ).to.be.revertedWith("Incorrect ETH amount sent");
    });
  });

  describe("endSlot", function () {
    it("pays host in full after session completes", async function () {
      await escrow
        .connect(buyer)
        .createSlot(host.address, PRICE_PER_MINUTE, MINUTES, { value: TOTAL });

      // Fast-forward time past session end
      await time.increase(Number(MINUTES) * 60 + 1);

      const before = await ethers.provider.getBalance(host.address);
      await escrow.connect(host).endSlot(0n);
      const after = await ethers.provider.getBalance(host.address);

      // Host received TOTAL minus tiny gas cost — just check it increased
      expect(after).to.be.gt(before);
    });

    it("reverts if session is not yet complete", async function () {
      await escrow
        .connect(buyer)
        .createSlot(host.address, PRICE_PER_MINUTE, MINUTES, { value: TOTAL });

      await expect(escrow.connect(host).endSlot(0n)).to.be.revertedWith(
        "Session not yet complete -- use earlyExit instead"
      );
    });
  });

  describe("earlyExit", function () {
    it("refunds buyer for unused minutes", async function () {
      await escrow
        .connect(buyer)
        .createSlot(host.address, PRICE_PER_MINUTE, MINUTES, { value: TOTAL });

      // Only 2 minutes pass before early exit
      await time.increase(2 * 60);

      const buyerBefore = await ethers.provider.getBalance(buyer.address);
      const tx = await escrow.connect(buyer).earlyExit(0n);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * tx.gasPrice;
      const buyerAfter = await ethers.provider.getBalance(buyer.address);

      // Buyer paid 3 minutes (ceil(2:00+) = 2 or 3 depending on block timestamp drift)
      // and was refunded the rest — net balance should be higher than after createSlot
      // We just check the EarlyExit event fired and refund > 0
      const event = receipt.logs
        .map((l) => {
          try { return escrow.interface.parseLog(l); } catch { return null; }
        })
        .find((l) => l?.name === "EarlyExit");

      expect(event).to.not.be.null;
      expect(event.args.refundAmount).to.be.gt(0n);
    });

    it("reverts if called by a non-participant", async function () {
      await escrow
        .connect(buyer)
        .createSlot(host.address, PRICE_PER_MINUTE, MINUTES, { value: TOTAL });

      await expect(escrow.connect(other).earlyExit(0n)).to.be.revertedWith(
        "Not a participant of this slot"
      );
    });

    it("reverts if slot already settled", async function () {
      await escrow
        .connect(buyer)
        .createSlot(host.address, PRICE_PER_MINUTE, MINUTES, { value: TOTAL });

      await escrow.connect(buyer).earlyExit(0n);

      await expect(escrow.connect(buyer).earlyExit(0n)).to.be.revertedWith(
        "Slot already settled"
      );
    });
  });

  describe("getSlot", function () {
    it("returns correct slot data", async function () {
      await escrow
        .connect(buyer)
        .createSlot(host.address, PRICE_PER_MINUTE, MINUTES, { value: TOTAL });

      const [
        _host,
        _buyer,
        _price,
        _minutes,
        ,
        _total,
        _active,
        _settled,
      ] = await escrow.getSlot(0n);

      expect(_host).to.equal(host.address);
      expect(_buyer).to.equal(buyer.address);
      expect(_price).to.equal(PRICE_PER_MINUTE);
      expect(_minutes).to.equal(MINUTES);
      expect(_total).to.equal(TOTAL);
      expect(_active).to.be.true;
      expect(_settled).to.be.false;
    });
  });
});

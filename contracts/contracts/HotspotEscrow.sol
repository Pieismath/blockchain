// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  HotspotEscrow
 * @notice Escrow contract for the Netra peer-to-peer WiFi marketplace.
 *
 * Flow
 * ----
 * 1. Buyer calls createSlot() with ETH = pricePerMinute * numMinutes.
 *    Funds are held in the contract.
 *
 * 2. The proxy server grants internet access for the requested duration.
 *
 * 3a. Full session completed  => endSlot()   - all funds to host.
 * 3b. Buyer leaves early      => earlyExit() - host paid for time used,
 *                                               buyer refunded the rest.
 *
 * Security
 * --------
 * - Re-entrancy prevented via checks-effects-interactions pattern.
 * - Only host or buyer of a slot can settle it.
 * - Solidity 0.8 built-in overflow protection.
 */
contract HotspotEscrow {

    // -------------------------------------------------------------------------
    //  Data structures
    // -------------------------------------------------------------------------

    struct Slot {
        address payable host;          // receives ETH for time used
        address payable buyer;         // receives refund on early exit
        uint256 pricePerMinute;        // wei per minute
        uint256 numMinutes;            // total minutes purchased
        uint256 startTime;             // unix timestamp of slot creation
        uint256 totalDeposited;        // wei held in escrow
        bool    active;                // true once created, false after settled
        bool    settled;               // true after endSlot or earlyExit
    }

    // -------------------------------------------------------------------------
    //  State
    // -------------------------------------------------------------------------

    uint256 public nextSlotId;
    mapping(uint256 => Slot) public slots;

    // -------------------------------------------------------------------------
    //  Events
    // -------------------------------------------------------------------------

    event SlotCreated(
        uint256 indexed slotId,
        address indexed host,
        address indexed buyer,
        uint256 pricePerMinute,
        uint256 numMinutes,
        uint256 totalDeposited
    );

    event SlotEnded(
        uint256 indexed slotId,
        address indexed host,
        uint256 amountPaid
    );

    event EarlyExit(
        uint256 indexed slotId,
        uint256 minutesUsed,
        uint256 refundAmount,
        uint256 hostAmount
    );

    // -------------------------------------------------------------------------
    //  Modifiers
    // -------------------------------------------------------------------------

    modifier slotExists(uint256 slotId) {
        require(slotId < nextSlotId, "Slot does not exist");
        _;
    }

    modifier onlyParticipant(uint256 slotId) {
        require(
            msg.sender == slots[slotId].host || msg.sender == slots[slotId].buyer,
            "Not a participant of this slot"
        );
        _;
    }

    modifier notSettled(uint256 slotId) {
        require(!slots[slotId].settled, "Slot already settled");
        _;
    }

    // -------------------------------------------------------------------------
    //  Functions
    // -------------------------------------------------------------------------

    /**
     * @notice Create a new escrow slot.
     * @param host           Address of the hotspot host.
     * @param pricePerMinute Cost per minute in wei.
     * @param numMinutes     Number of minutes to purchase.
     * @return slotId        The ID of the newly created slot.
     */
    function createSlot(
        address payable host,
        uint256 pricePerMinute,
        uint256 numMinutes
    ) external payable returns (uint256 slotId) {
        require(host != address(0), "Invalid host address");
        require(pricePerMinute > 0, "Price must be > 0");
        require(numMinutes > 0, "Must purchase at least 1 minute");

        uint256 required = pricePerMinute * numMinutes;
        require(msg.value == required, "Incorrect ETH amount sent");

        slotId = nextSlotId++;

        slots[slotId] = Slot({
            host:           host,
            buyer:          payable(msg.sender),
            pricePerMinute: pricePerMinute,
            numMinutes:     numMinutes,
            startTime:      block.timestamp,
            totalDeposited: msg.value,
            active:         true,
            settled:        false
        });

        emit SlotCreated(slotId, host, msg.sender, pricePerMinute, numMinutes, msg.value);
    }

    /**
     * @notice End a fully-completed session. Pays host in full.
     *         Requires that the session duration has elapsed on-chain.
     * @param slotId The slot to settle.
     */
    function endSlot(uint256 slotId)
        external
        slotExists(slotId)
        onlyParticipant(slotId)
        notSettled(slotId)
    {
        Slot storage slot = slots[slotId];

        uint256 sessionEnd = slot.startTime + slot.numMinutes * 60;
        require(
            block.timestamp >= sessionEnd,
            "Session not yet complete -- use earlyExit instead"
        );

        uint256 amount = slot.totalDeposited;

        // Checks-Effects-Interactions
        slot.active  = false;
        slot.settled = true;

        slot.host.transfer(amount);

        emit SlotEnded(slotId, slot.host, amount);
    }

    /**
     * @notice Early exit: pays host for time used (rounded up), refunds buyer
     *         for unused time.
     * @param slotId The slot to exit early.
     */
    function earlyExit(uint256 slotId)
        external
        slotExists(slotId)
        onlyParticipant(slotId)
        notSettled(slotId)
    {
        Slot storage slot = slots[slotId];

        uint256 elapsed     = block.timestamp - slot.startTime;
        uint256 minutesUsed = (elapsed + 59) / 60; // ceiling division

        // Cap at purchased amount (handles calls made after natural expiry)
        if (minutesUsed > slot.numMinutes) {
            minutesUsed = slot.numMinutes;
        }

        uint256 minutesRemaining = slot.numMinutes - minutesUsed;
        uint256 hostAmount       = minutesUsed * slot.pricePerMinute;
        uint256 refundAmount     = minutesRemaining * slot.pricePerMinute;

        assert(hostAmount + refundAmount == slot.totalDeposited);

        // Checks-Effects-Interactions
        slot.active  = false;
        slot.settled = true;

        if (hostAmount > 0)   slot.host.transfer(hostAmount);
        if (refundAmount > 0) slot.buyer.transfer(refundAmount);

        emit EarlyExit(slotId, minutesUsed, refundAmount, hostAmount);
    }

    /**
     * @notice Returns all fields of a slot.
     * @param slotId Slot to query.
     */
    function getSlot(uint256 slotId)
        external
        view
        slotExists(slotId)
        returns (
            address host,
            address buyer,
            uint256 pricePerMinute,
            uint256 numMinutes,
            uint256 startTime,
            uint256 totalDeposited,
            bool    active,
            bool    settled
        )
    {
        Slot storage s = slots[slotId];
        return (
            s.host,
            s.buyer,
            s.pricePerMinute,
            s.numMinutes,
            s.startTime,
            s.totalDeposited,
            s.active,
            s.settled
        );
    }
}

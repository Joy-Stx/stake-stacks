
import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const validator1 = accounts.get("wallet_3")!;
const validator2 = accounts.get("wallet_4")!;

const contractName = "stake-stacks";

describe("Stake-Stacks Protocol Tests", () => {
  beforeEach(() => {
    simnet.setEpoch("3.0");
  });

  describe("Contract Initialization and Constants", () => {
    it("should have correct initial protocol stats", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-protocol-stats",
        [],
        deployer
      );
      expect(result).toBeOk(
        Cl.tuple({
          "total-staked": Cl.uint(0),
          "total-liquid-tokens": Cl.uint(0),
          "exchange-rate": Cl.uint(1000000),
          "protocol-fees": Cl.uint(0),
          "current-cycle": Cl.uint(0),
        })
      );
    });

    it("should have correct minimum stake amount", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(999999)], // Below minimum
        wallet1
      );
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });
  });

  describe("Validator Registration", () => {
    it("should allow validator registration with valid commission", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)], // 10% commission
        validator1
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify validator is registered
      const pool = simnet.callReadOnlyFn(
        contractName,
        "get-staking-pool",
        [Cl.principal(validator1)],
        deployer
      );
      expect(pool.result).toBeSome(
        Cl.tuple({
          "total-delegated": Cl.uint(0),
          "liquid-tokens-issued": Cl.uint(0),
          "active": Cl.bool(true),
          "commission-rate": Cl.uint(1000),
          "validator-rewards": Cl.uint(0),
          "last-reward-cycle": Cl.uint(0),
        })
      );
    });

    it("should reject validator registration with high commission", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(2001)], // Above 20% limit
        validator1
      );
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });

    it("should prevent duplicate validator registration", () => {
      // Register first time
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)],
        validator1
      );

      // Try to register again
      const { result } = simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1500)],
        validator1
      );
      expect(result).toBeErr(Cl.uint(105)); // err-already-staking
    });

    it("should allow validator to update commission", () => {
      // Register validator
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)],
        validator1
      );

      // Update commission
      const { result } = simnet.callPublicFn(
        contractName,
        "update-validator-commission",
        [Cl.uint(1500)],
        validator1
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify commission updated
      const pool = simnet.callReadOnlyFn(
        contractName,
        "get-staking-pool",
        [Cl.principal(validator1)],
        deployer
      );
      expect(pool.result).toBeSome(
        Cl.tuple({
          "total-delegated": Cl.uint(0),
          "liquid-tokens-issued": Cl.uint(0),
          "active": Cl.bool(true),
          "commission-rate": Cl.uint(1500),
          "validator-rewards": Cl.uint(0),
          "last-reward-cycle": Cl.uint(0),
        })
      );
    });

    it("should allow validator to deactivate", () => {
      // Register validator
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)],
        validator1
      );

      // Deactivate validator
      const { result } = simnet.callPublicFn(
        contractName,
        "deactivate-validator",
        [],
        validator1
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify validator is deactivated
      const pool = simnet.callReadOnlyFn(
        contractName,
        "get-staking-pool",
        [Cl.principal(validator1)],
        deployer
      );
      expect(pool.result).toBeSome(
        Cl.tuple({
          "total-delegated": Cl.uint(0),
          "liquid-tokens-issued": Cl.uint(0),
          "active": Cl.bool(false),
          "commission-rate": Cl.uint(1000),
          "validator-rewards": Cl.uint(0),
          "last-reward-cycle": Cl.uint(0),
        })
      );
    });
  });

  describe("Basic Staking Functionality", () => {
    beforeEach(() => {
      // Register validator before each staking test
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)],
        validator1
      );
    });

    it("should allow users to stake STX and receive liquid tokens", () => {
      const stakeAmount = 5000000; // 5 STX
      const expectedLiquidTokens = 5000000; // 1:1 initially
      const protocolFee = 5000; // 1% of 5 STX

      const { result } = simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(stakeAmount)],
        wallet1
      );
      expect(result).toBeOk(Cl.uint(expectedLiquidTokens));

      // Verify user stake
      const userStake = simnet.callReadOnlyFn(
        contractName,
        "get-user-stake",
        [Cl.principal(wallet1), Cl.principal(validator1)],
        deployer
      );
      expect(userStake.result).toBeSome(
        Cl.tuple({
          "stx-amount": Cl.uint(stakeAmount - protocolFee),
          "liquid-tokens": Cl.uint(expectedLiquidTokens),
          "stake-height": Cl.uint(simnet.blockHeight),
          "unstaking-height": Cl.none(),
          "rewards-claimed": Cl.uint(0),
        })
      );

      // Verify liquid token balance
      const balance = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(balance.result).toBeTuple({
        "balance": Cl.uint(expectedLiquidTokens),
        "last-claim-cycle": Cl.uint(0),
      });
    });

    it("should update pool stats after staking", () => {
      const stakeAmount = 5000000;
      const protocolFee = 5000;
      const netStake = stakeAmount - protocolFee;

      simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(stakeAmount)],
        wallet1
      );

      // Verify pool updated
      const pool = simnet.callReadOnlyFn(
        contractName,
        "get-staking-pool",
        [Cl.principal(validator1)],
        deployer
      );
      expect(pool.result).toBeSome(
        Cl.tuple({
          "total-delegated": Cl.uint(netStake),
          "liquid-tokens-issued": Cl.uint(stakeAmount),
          "active": Cl.bool(true),
          "commission-rate": Cl.uint(1000),
          "validator-rewards": Cl.uint(0),
          "last-reward-cycle": Cl.uint(0),
        })
      );

      // Verify protocol stats
      const stats = simnet.callReadOnlyFn(
        contractName,
        "get-protocol-stats",
        [],
        deployer
      );
      expect(stats.result).toBeOk(
        Cl.tuple({
          "total-staked": Cl.uint(netStake),
          "total-liquid-tokens": Cl.uint(stakeAmount),
          "exchange-rate": Cl.uint(1000000),
          "protocol-fees": Cl.uint(protocolFee),
          "current-cycle": Cl.uint(0),
        })
      );
    });

    it("should allow multiple stakes to same validator", () => {
      const firstStake = 3000000;
      const secondStake = 2000000;
      const totalStake = firstStake + secondStake;
      const totalFees = 30000 + 20000; // 1% each
      const netTotal = totalStake - totalFees;

      // First stake
      simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(firstStake)],
        wallet1
      );

      // Second stake
      const { result } = simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(secondStake)],
        wallet1
      );
      expect(result).toBeOk(Cl.uint(secondStake));

      // Verify combined stake
      const userStake = simnet.callReadOnlyFn(
        contractName,
        "get-user-stake",
        [Cl.principal(wallet1), Cl.principal(validator1)],
        deployer
      );
      expect(userStake.result).toBeSome(
        Cl.tuple({
          "stx-amount": Cl.uint(netTotal),
          "liquid-tokens": Cl.uint(totalStake),
          "stake-height": Cl.uint(simnet.blockHeight - 1), // First stake height
          "unstaking-height": Cl.none(),
          "rewards-claimed": Cl.uint(0),
        })
      );
    });

    it("should reject staking with inactive validator", () => {
      // Deactivate validator
      simnet.callPublicFn(contractName, "deactivate-validator", [], validator1);

      const { result } = simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(5000000)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(108)); // err-invalid-validator
    });

    it("should reject staking below minimum amount", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(999999)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });

    it("should allow staking with different validators", () => {
      // Register second validator
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1500)],
        validator2
      );

      const stakeAmount = 3000000;

      // Stake with first validator
      simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(stakeAmount)],
        wallet1
      );

      // Stake with second validator
      const { result } = simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator2), Cl.uint(stakeAmount)],
        wallet1
      );
      expect(result).toBeOk(Cl.uint(stakeAmount));

      // Verify both stakes exist
      const stake1 = simnet.callReadOnlyFn(
        contractName,
        "get-user-stake",
        [Cl.principal(wallet1), Cl.principal(validator1)],
        deployer
      );
      const stake2 = simnet.callReadOnlyFn(
        contractName,
        "get-user-stake",
        [Cl.principal(wallet1), Cl.principal(validator2)],
        deployer
      );

      expect(stake1.result).toBeSome(expect.anything());
      expect(stake2.result).toBeSome(expect.anything());
    });
  });

  describe("Liquid Token Operations", () => {
    beforeEach(() => {
      // Setup: Register validator and stake some tokens
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)],
        validator1
      );
      simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(10000000)],
        wallet1
      );
    });

    it("should allow transfer of liquid tokens between users", () => {
      const transferAmount = 3000000;

      const { result } = simnet.callPublicFn(
        contractName,
        "transfer-liquid-tokens",
        [Cl.principal(wallet2), Cl.uint(transferAmount)],
        wallet1
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify sender balance
      const senderBalance = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(senderBalance.result).toBeTuple({
        "balance": Cl.uint(7000000), // 10000000 - 3000000
        "last-claim-cycle": Cl.uint(0),
      });

      // Verify recipient balance
      const recipientBalance = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet2)],
        deployer
      );
      expect(recipientBalance.result).toBeTuple({
        "balance": Cl.uint(transferAmount),
        "last-claim-cycle": Cl.uint(0),
      });
    });

    it("should reject transfer of insufficient liquid tokens", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "transfer-liquid-tokens",
        [Cl.principal(wallet2), Cl.uint(20000000)], // More than balance
        wallet1
      );
      expect(result).toBeErr(Cl.uint(102)); // err-insufficient-balance
    });

    it("should reject self-transfer", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "transfer-liquid-tokens",
        [Cl.principal(wallet1), Cl.uint(1000000)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });

    it("should correctly calculate STX value of liquid tokens", () => {
      const liquidTokens = 5000000;
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "calculate-stx-value",
        [Cl.uint(liquidTokens)],
        deployer
      );
      expect(result).toBeUint(5000000); // 1:1 initially
    });

    it("should correctly calculate liquid tokens from STX", () => {
      const stxAmount = 7000000;
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "calculate-liquid-tokens",
        [Cl.uint(stxAmount)],
        deployer
      );
      expect(result).toBeUint(7000000); // 1:1 initially
    });
  });

  describe("Administrative Functions", () => {
    it("should allow owner to update current cycle", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "update-current-cycle",
        [Cl.uint(100)],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify cycle updated
      const stats = simnet.callReadOnlyFn(
        contractName,
        "get-protocol-stats",
        [],
        deployer
      );
      expect(stats.result).toBeOk(
        Cl.tuple({
          "total-staked": Cl.uint(0),
          "total-liquid-tokens": Cl.uint(0),
          "exchange-rate": Cl.uint(1000000),
          "protocol-fees": Cl.uint(0),
          "current-cycle": Cl.uint(100),
        })
      );
    });

    it("should reject non-owner cycle updates", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "update-current-cycle",
        [Cl.uint(100)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(100)); // err-owner-only
    });

    it("should allow owner to toggle contract pause", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "toggle-contract-pause",
        [],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should reject operations when contract is paused", () => {
      // Pause contract
      simnet.callPublicFn(contractName, "toggle-contract-pause", [], deployer);

      // Try to register validator
      const { result } = simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)],
        validator1
      );
      expect(result).toBeErr(Cl.uint(101)); // err-not-authorized
    });

    it("should allow owner to withdraw protocol fees", () => {
      // Setup: Create some fees by staking
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)],
        validator1
      );
      simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(10000000)],
        wallet1
      );

      // Withdraw fees
      const { result } = simnet.callPublicFn(
        contractName,
        "withdraw-protocol-fees",
        [],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify fees reset
      const stats = simnet.callReadOnlyFn(
        contractName,
        "get-protocol-stats",
        [],
        deployer
      );
      expect(stats.result).toBeOk(
        Cl.tuple({
          "total-staked": Cl.uint(9900000), // After 1% fee
          "total-liquid-tokens": Cl.uint(10000000),
          "exchange-rate": Cl.uint(1000000),
          "protocol-fees": Cl.uint(0), // Reset to 0
          "current-cycle": Cl.uint(0),
        })
      );
    });
  });
});

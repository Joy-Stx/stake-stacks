
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

  describe("Unstaking Functionality", () => {
    beforeEach(() => {
      // Setup: Register validator and stake tokens
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

    it("should allow users to initiate unstaking", () => {
      const unstakeAmount = 5000000; // 5 liquid tokens

      const { result } = simnet.callPublicFn(
        contractName,
        "initiate-unstaking",
        [Cl.principal(validator1), Cl.uint(unstakeAmount)],
        wallet1
      );
      expect(result).toBeOk(Cl.uint(0)); // First request ID

      // Verify unstaking request created
      const request = simnet.callReadOnlyFn(
        contractName,
        "get-unstaking-request",
        [Cl.principal(wallet1), Cl.uint(0)],
        deployer
      );
      expect(request.result).toBeSome(
        Cl.tuple({
          "amount": Cl.uint(5000000), // STX value (1:1 initially)
          "liquid-tokens": Cl.uint(unstakeAmount),
          "initiated-height": Cl.uint(simnet.blockHeight),
          "completed": Cl.bool(false),
        })
      );

      // Verify liquid token balance reduced
      const balance = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(balance.result).toBeTuple({
        "balance": Cl.uint(5000000), // 10000000 - 5000000
        "last-claim-cycle": Cl.uint(0),
      });
    });

    it("should reject unstaking with insufficient liquid tokens", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "initiate-unstaking",
        [Cl.principal(validator1), Cl.uint(20000000)], // More than balance
        wallet1
      );
      expect(result).toBeErr(Cl.uint(102)); // err-insufficient-balance
    });

    it("should reject completing unstaking before period ends", () => {
      // Initiate unstaking
      simnet.callPublicFn(
        contractName,
        "initiate-unstaking",
        [Cl.principal(validator1), Cl.uint(5000000)],
        wallet1
      );

      // Try to complete immediately
      const { result } = simnet.callPublicFn(
        contractName,
        "complete-unstaking",
        [Cl.uint(0)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(107)); // err-unstaking-period
    });

    it("should allow completing unstaking after period", () => {
      // Initiate unstaking
      simnet.callPublicFn(
        contractName,
        "initiate-unstaking",
        [Cl.principal(validator1), Cl.uint(5000000)],
        wallet1
      );

      // Mine blocks to simulate unstaking period (2016 blocks)
      simnet.mineEmptyBlocks(2017);

      // Complete unstaking
      const { result } = simnet.callPublicFn(
        contractName,
        "complete-unstaking",
        [Cl.uint(0)],
        wallet1
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify request marked as completed
      const request = simnet.callReadOnlyFn(
        contractName,
        "get-unstaking-request",
        [Cl.principal(wallet1), Cl.uint(0)],
        deployer
      );
      expect(request.result).toBeSome(
        Cl.tuple({
          "amount": Cl.uint(5000000),
          "liquid-tokens": Cl.uint(5000000),
          "initiated-height": Cl.uint(simnet.blockHeight - 2017),
          "completed": Cl.bool(true),
        })
      );
    });

    it("should handle multiple unstaking requests", () => {
      // First unstaking request
      const result1 = simnet.callPublicFn(
        contractName,
        "initiate-unstaking",
        [Cl.principal(validator1), Cl.uint(3000000)],
        wallet1
      );
      expect(result1.result).toBeOk(Cl.uint(0));

      // Second unstaking request
      const result2 = simnet.callPublicFn(
        contractName,
        "initiate-unstaking",
        [Cl.principal(validator1), Cl.uint(2000000)],
        wallet1
      );
      expect(result2.result).toBeOk(Cl.uint(1));

      // Verify both requests exist
      const request1 = simnet.callReadOnlyFn(
        contractName,
        "get-unstaking-request",
        [Cl.principal(wallet1), Cl.uint(0)],
        deployer
      );
      const request2 = simnet.callReadOnlyFn(
        contractName,
        "get-unstaking-request",
        [Cl.principal(wallet1), Cl.uint(1)],
        deployer
      );

      expect(request1.result).toBeSome(expect.anything());
      expect(request2.result).toBeSome(expect.anything());
    });
  });

  describe("Rewards Distribution and Claiming", () => {
    beforeEach(() => {
      // Setup: Register validator, stake tokens, and update cycle
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)], // 10% commission
        validator1
      );
      simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(10000000)],
        wallet1
      );
      simnet.callPublicFn(
        contractName,
        "update-current-cycle",
        [Cl.uint(1)],
        deployer
      );
    });

    it("should allow validator to distribute rewards", () => {
      const rewardsAmount = 1000000; // 1 STX rewards
      const expectedCommission = 100000; // 10% of rewards

      const { result } = simnet.callPublicFn(
        contractName,
        "distribute-rewards",
        [Cl.principal(validator1), Cl.uint(rewardsAmount)],
        validator1
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify validator commission updated
      const pool = simnet.callReadOnlyFn(
        contractName,
        "get-staking-pool",
        [Cl.principal(validator1)],
        deployer
      );
      expect(pool.result).toBeSome(
        Cl.tuple({
          "total-delegated": Cl.uint(9900000), // Original stake minus protocol fee
          "liquid-tokens-issued": Cl.uint(10000000),
          "active": Cl.bool(true),
          "commission-rate": Cl.uint(1000),
          "validator-rewards": Cl.uint(expectedCommission),
          "last-reward-cycle": Cl.uint(1),
        })
      );

      // Verify exchange rate updated with net rewards
      const stats = simnet.callReadOnlyFn(
        contractName,
        "get-protocol-stats",
        [],
        deployer
      );
      const statsValue = stats.result as any;
      expect(statsValue.value.data["total-staked"]).toBeUint(10800000); // 9900000 + 900000
    });

    it("should reject reward distribution from non-validator", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "distribute-rewards",
        [Cl.principal(validator1), Cl.uint(1000000)],
        wallet1 // Not the validator
      );
      expect(result).toBeErr(Cl.uint(101)); // err-not-authorized
    });

    it("should allow validator to claim commission rewards", () => {
      // First distribute rewards to accumulate commission
      simnet.callPublicFn(
        contractName,
        "distribute-rewards",
        [Cl.principal(validator1), Cl.uint(1000000)],
        validator1
      );

      // Claim validator rewards
      const { result } = simnet.callPublicFn(
        contractName,
        "claim-validator-rewards",
        [],
        validator1
      );
      expect(result).toBeOk(Cl.uint(100000)); // 10% commission

      // Verify rewards reset to 0
      const pool = simnet.callReadOnlyFn(
        contractName,
        "get-staking-pool",
        [Cl.principal(validator1)],
        deployer
      );
      const poolValue = pool.result as any;
      expect(poolValue.value.data["validator-rewards"]).toBeUint(0);
    });

    it("should calculate pending rewards correctly", () => {
      // Distribute rewards to increase exchange rate
      simnet.callPublicFn(
        contractName,
        "distribute-rewards",
        [Cl.principal(validator1), Cl.uint(1000000)],
        validator1
      );

      // Calculate pending rewards
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "calculate-pending-rewards",
        [Cl.principal(wallet1), Cl.principal(validator1)],
        deployer
      );
      
      // Should have some rewards due to increased exchange rate
      expect(result).toBeOk(expect.anything());
    });

    it("should calculate user yield percentage", () => {
      // Distribute rewards to increase exchange rate
      simnet.callPublicFn(
        contractName,
        "distribute-rewards",
        [Cl.principal(validator1), Cl.uint(1000000)],
        validator1
      );

      // Calculate yield
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-user-yield",
        [Cl.principal(wallet1), Cl.principal(validator1)],
        deployer
      );
      
      // Should return yield percentage in basis points
      expect(result).toBeOk(expect.anything());
    });

    it("should allow claiming staking rewards with auto-compound", () => {
      // Distribute rewards first
      simnet.callPublicFn(
        contractName,
        "distribute-rewards",
        [Cl.principal(validator1), Cl.uint(1000000)],
        validator1
      );

      // Claim staking rewards (auto-compounds)
      const { result } = simnet.callPublicFn(
        contractName,
        "claim-staking-rewards",
        [Cl.principal(validator1)],
        wallet1
      );

      // Should return additional liquid tokens from compounding
      expect(result).toBeOk(expect.anything());

      // Verify user liquid token balance increased
      const balance = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      const balanceValue = balance.result as any;
      expect(balanceValue.data.balance.value).toBeGreaterThan(10000000n);
    });
  });

  describe("Auto-Compounding Mechanism", () => {
    beforeEach(() => {
      // Setup: Register validator, stake tokens, update cycle
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
      simnet.callPublicFn(
        contractName,
        "update-current-cycle",
        [Cl.uint(5)], // Set to cycle 5
        deployer
      );
    });

    it("should auto-compound rewards based on cycles", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "auto-compound-rewards",
        [Cl.principal(validator1)],
        wallet1
      );

      // Should return compounded liquid tokens
      expect(result).toBeOk(expect.anything());

      // Verify liquid token balance updated
      const balance = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(balance.result).toBeTuple({
        "balance": expect.anything(),
        "last-claim-cycle": Cl.uint(5), // Updated to current cycle
      });
    });

    it("should reject auto-compound with no cycles elapsed", () => {
      // User just staked, no cycles have passed
      const { result } = simnet.callPublicFn(
        contractName,
        "auto-compound-rewards",
        [Cl.principal(validator1)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });

    it("should handle multiple auto-compound cycles", () => {
      // First auto-compound
      simnet.callPublicFn(
        contractName,
        "auto-compound-rewards",
        [Cl.principal(validator1)],
        wallet1
      );

      // Advance cycles
      simnet.callPublicFn(
        contractName,
        "update-current-cycle",
        [Cl.uint(10)],
        deployer
      );

      // Second auto-compound
      const { result } = simnet.callPublicFn(
        contractName,
        "auto-compound-rewards",
        [Cl.principal(validator1)],
        wallet1
      );
      expect(result).toBeOk(expect.anything());

      // Verify cycle updated
      const balance = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(balance.result).toBeTuple({
        "balance": expect.anything(),
        "last-claim-cycle": Cl.uint(10),
      });
    });
  });

  describe("Yield Farming with Liquid Tokens", () => {
    beforeEach(() => {
      // Setup: Register validator and stake tokens
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

    it("should allow depositing liquid tokens for yield farming", () => {
      const depositAmount = 5000000;
      const farmingPeriod = 4320; // 30 days in blocks

      const { result } = simnet.callPublicFn(
        contractName,
        "deposit-for-yield",
        [Cl.uint(depositAmount), Cl.uint(farmingPeriod)],
        wallet1
      );

      // Should return calculated yield
      expect(result).toBeOk(expect.anything());

      // Verify liquid tokens locked and yield added
      const balance = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      // Balance should reflect the yield farming calculation
      expect(balance.result).toBeTuple({
        "balance": expect.anything(),
        "last-claim-cycle": expect.anything(),
      });
    });

    it("should reject yield farming with insufficient balance", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "deposit-for-yield",
        [Cl.uint(20000000), Cl.uint(4320)], // More than balance
        wallet1
      );
      expect(result).toBeErr(Cl.uint(102)); // err-insufficient-balance
    });

    it("should reject yield farming with short period", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "deposit-for-yield",
        [Cl.uint(5000000), Cl.uint(100)], // Less than 1 day
        wallet1
      );
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });

    it("should provide bonus yield for longer farming periods", () => {
      const depositAmount = 5000000;
      const longPeriod = 8640; // 60 days - should get bonus

      const { result } = simnet.callPublicFn(
        contractName,
        "deposit-for-yield",
        [Cl.uint(depositAmount), Cl.uint(longPeriod)],
        wallet1
      );

      // Should return higher yield due to bonus
      expect(result).toBeOk(expect.anything());
    });
  });

  describe("Exchange Rate Mechanics", () => {
    beforeEach(() => {
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)],
        validator1
      );
    });

    it("should maintain 1:1 exchange rate initially", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "calculate-liquid-tokens",
        [Cl.uint(5000000)],
        deployer
      );
      expect(result).toBeUint(5000000); // 1:1 ratio

      const stxValue = simnet.callReadOnlyFn(
        contractName,
        "calculate-stx-value",
        [Cl.uint(5000000)],
        deployer
      );
      expect(stxValue.result).toBeUint(5000000); // 1:1 ratio
    });

    it("should update exchange rate after rewards distribution", () => {
      // Stake some tokens first
      simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(10000000)],
        wallet1
      );

      // Distribute rewards to change exchange rate
      simnet.callPublicFn(
        contractName,
        "distribute-rewards",
        [Cl.principal(validator1), Cl.uint(1000000)],
        validator1
      );

      // Check that exchange rate has changed
      const stats = simnet.callReadOnlyFn(
        contractName,
        "get-protocol-stats",
        [],
        deployer
      );
      const statsValue = stats.result as any;
      expect(statsValue.value.data["exchange-rate"].value).toBeGreaterThan(1000000n);
    });

    it("should correctly convert between STX and liquid tokens with new rate", () => {
      // Stake and distribute rewards to change rate
      simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(10000000)],
        wallet1
      );
      simnet.callPublicFn(
        contractName,
        "distribute-rewards",
        [Cl.principal(validator1), Cl.uint(1000000)],
        validator1
      );

      // Test conversion with new exchange rate
      const liquidTokens = simnet.callReadOnlyFn(
        contractName,
        "calculate-liquid-tokens",
        [Cl.uint(5000000)],
        deployer
      );
      const stxValue = simnet.callReadOnlyFn(
        contractName,
        "calculate-stx-value",
        [liquidTokens.result],
        deployer
      );

      // Should approximately equal the original STX amount
      expect(stxValue.result).toBeUint(5000000);
    });
  });

  describe("Delegation Marketplace", () => {
    beforeEach(() => {
      // Setup: Register validators
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)],
        validator1
      );
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1200)],
        validator2
      );
    });

    it("should allow validator to create delegation offer", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [
          Cl.uint(800), // 8% offered commission (better than validator's 10%)
          Cl.uint(1000000), // 1 STX minimum
          Cl.uint(50000000), // 50 STX maximum
          Cl.uint(4320), // 30 days duration
        ],
        validator1
      );
      expect(result).toBeOk(Cl.uint(0)); // First offer ID

      // Verify offer created
      const offer = simnet.callReadOnlyFn(
        contractName,
        "get-delegation-offer",
        [Cl.uint(0)],
        deployer
      );
      expect(offer.result).toBeSome(
        Cl.tuple({
          "validator": Cl.principal(validator1),
          "offered-commission": Cl.uint(800),
          "minimum-delegation": Cl.uint(1000000),
          "maximum-delegation": Cl.uint(50000000),
          "duration": Cl.uint(4320),
          "active": Cl.bool(true),
          "created-height": Cl.uint(simnet.blockHeight),
          "delegators-count": Cl.uint(0),
        })
      );
    });

    it("should reject delegation offer with high commission", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [
          Cl.uint(1600), // 16% - above 15% limit
          Cl.uint(1000000),
          Cl.uint(50000000),
          Cl.uint(4320),
        ],
        validator1
      );
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });

    it("should reject delegation offer from non-validator", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [
          Cl.uint(800),
          Cl.uint(1000000),
          Cl.uint(50000000),
          Cl.uint(4320),
        ],
        wallet1 // Not a validator
      );
      expect(result).toBeErr(Cl.uint(108)); // err-invalid-validator
    });

    it("should allow users to accept delegation offers", () => {
      // Create offer first
      simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [
          Cl.uint(800),
          Cl.uint(1000000),
          Cl.uint(50000000),
          Cl.uint(4320),
        ],
        validator1
      );

      // Accept offer
      const { result } = simnet.callPublicFn(
        contractName,
        "accept-delegation-offer",
        [Cl.uint(0), Cl.uint(5000000)], // Offer ID 0, 5 STX
        wallet1
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify delegation request created
      const request = simnet.callReadOnlyFn(
        contractName,
        "get-delegation-request",
        [Cl.principal(wallet1), Cl.uint(0)],
        deployer
      );
      expect(request.result).toBeSome(
        Cl.tuple({
          "amount": Cl.uint(5000000),
          "accepted": Cl.bool(false),
          "created-height": Cl.uint(simnet.blockHeight),
        })
      );

      // Verify offer statistics updated
      const offer = simnet.callReadOnlyFn(
        contractName,
        "get-delegation-offer",
        [Cl.uint(0)],
        deployer
      );
      const offerValue = offer.result as any;
      expect(offerValue.value.data["delegators-count"]).toBeUint(1);
    });

    it("should reject delegation below minimum amount", () => {
      // Create offer
      simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [
          Cl.uint(800),
          Cl.uint(5000000), // 5 STX minimum
          Cl.uint(50000000),
          Cl.uint(4320),
        ],
        validator1
      );

      // Try to accept with less than minimum
      const { result } = simnet.callPublicFn(
        contractName,
        "accept-delegation-offer",
        [Cl.uint(0), Cl.uint(3000000)], // 3 STX - below minimum
        wallet1
      );
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });

    it("should reject delegation above maximum amount", () => {
      // Create offer
      simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [
          Cl.uint(800),
          Cl.uint(1000000),
          Cl.uint(10000000), // 10 STX maximum
          Cl.uint(4320),
        ],
        validator1
      );

      // Try to accept with more than maximum
      const { result } = simnet.callPublicFn(
        contractName,
        "accept-delegation-offer",
        [Cl.uint(0), Cl.uint(15000000)], // 15 STX - above maximum
        wallet1
      );
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });

    it("should allow validator to cancel delegation offer", () => {
      // Create offer
      simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [
          Cl.uint(800),
          Cl.uint(1000000),
          Cl.uint(50000000),
          Cl.uint(4320),
        ],
        validator1
      );

      // Cancel offer
      const { result } = simnet.callPublicFn(
        contractName,
        "cancel-delegation-offer",
        [Cl.uint(0)],
        validator1
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify offer is inactive
      const offer = simnet.callReadOnlyFn(
        contractName,
        "get-delegation-offer",
        [Cl.uint(0)],
        deployer
      );
      const offerValue = offer.result as any;
      expect(offerValue.value.data["active"]).toBeBool(false);
    });

    it("should track marketplace statistics", () => {
      // Create multiple offers
      simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [Cl.uint(800), Cl.uint(1000000), Cl.uint(50000000), Cl.uint(4320)],
        validator1
      );
      simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [Cl.uint(900), Cl.uint(2000000), Cl.uint(30000000), Cl.uint(2160)],
        validator2
      );

      // Get marketplace stats
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-marketplace-stats",
        [],
        deployer
      );
      expect(result).toBeOk(
        Cl.tuple({
          "total-offers": Cl.uint(2),
          "total-lending-positions": Cl.uint(0),
          "protocol-tvl": Cl.uint(0),
          "liquid-token-supply": Cl.uint(0),
        })
      );
    });
  });

  describe("DeFi Integration - Lending Against Liquid Tokens", () => {
    beforeEach(() => {
      // Setup: Register validator, stake tokens to get liquid tokens
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)],
        validator1
      );
      simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(20000000)],
        wallet1
      );
    });

    it("should allow creating lending position with liquid tokens as collateral", () => {
      const collateralAmount = 10000000; // 10 liquid tokens
      const borrowAmount = 6000000; // 6 STX (60% LTV)
      const interestRate = 500; // 5% interest
      const duration = 4320; // 30 days

      const { result } = simnet.callPublicFn(
        contractName,
        "create-lending-position",
        [
          Cl.uint(collateralAmount),
          Cl.uint(borrowAmount),
          Cl.uint(interestRate),
          Cl.uint(duration),
        ],
        wallet1
      );
      expect(result).toBeOk(Cl.uint(0)); // First lending position ID

      // Verify lending position created
      const position = simnet.callReadOnlyFn(
        contractName,
        "get-lending-position",
        [Cl.uint(0)],
        deployer
      );
      expect(position.result).toBeSome(
        Cl.tuple({
          "lender": Cl.principal(wallet1),
          "collateral-amount": Cl.uint(collateralAmount),
          "borrowed-amount": Cl.uint(borrowAmount),
          "interest-rate": Cl.uint(interestRate),
          "duration": Cl.uint(duration),
          "active": Cl.bool(true),
          "created-height": Cl.uint(simnet.blockHeight),
        })
      );

      // Verify liquid tokens locked (removed from balance)
      const balance = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(balance.result).toBeTuple({
        "balance": Cl.uint(10000000), // 20000000 - 10000000 locked
        "last-claim-cycle": Cl.uint(0),
      });
    });

    it("should reject lending with high LTV ratio", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-lending-position",
        [
          Cl.uint(10000000), // 10 liquid tokens collateral
          Cl.uint(8000000), // 8 STX borrow (80% LTV - above 75% limit)
          Cl.uint(500),
          Cl.uint(4320),
        ],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });

    it("should reject lending with insufficient collateral", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-lending-position",
        [
          Cl.uint(30000000), // More than user's balance
          Cl.uint(20000000),
          Cl.uint(500),
          Cl.uint(4320),
        ],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(102)); // err-insufficient-balance
    });

    it("should allow repaying lending position", () => {
      // Create lending position first
      simnet.callPublicFn(
        contractName,
        "create-lending-position",
        [
          Cl.uint(10000000),
          Cl.uint(6000000),
          Cl.uint(500), // 5% interest
          Cl.uint(4320),
        ],
        wallet1
      );

      // Repay position
      const { result } = simnet.callPublicFn(
        contractName,
        "repay-lending-position",
        [Cl.uint(0)],
        wallet1
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify position closed
      const position = simnet.callReadOnlyFn(
        contractName,
        "get-lending-position",
        [Cl.uint(0)],
        deployer
      );
      const positionValue = position.result as any;
      expect(positionValue.value.data["active"]).toBeBool(false);

      // Verify collateral returned
      const balance = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(balance.result).toBeTuple({
        "balance": Cl.uint(20000000), // Collateral returned
        "last-claim-cycle": Cl.uint(0),
      });
    });

    it("should calculate LTV ratio correctly", () => {
      // Create lending position
      simnet.callPublicFn(
        contractName,
        "create-lending-position",
        [
          Cl.uint(10000000), // 10 liquid tokens
          Cl.uint(6000000), // 6 STX
          Cl.uint(500),
          Cl.uint(4320),
        ],
        wallet1
      );

      // Calculate LTV ratio
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "calculate-ltv-ratio",
        [Cl.uint(0)],
        deployer
      );
      expect(result).toBeOk(Cl.uint(60)); // 60% LTV
    });

    it("should allow liquidation of undercollateralized positions", () => {
      // Create lending position
      simnet.callPublicFn(
        contractName,
        "create-lending-position",
        [
          Cl.uint(10000000),
          Cl.uint(7000000), // High LTV near limit
          Cl.uint(500),
          Cl.uint(4320),
        ],
        wallet1
      );

      // Simulate price change by distributing rewards to increase exchange rate
      // This would make the collateral less valuable relative to borrowed amount
      simnet.callPublicFn(
        contractName,
        "distribute-rewards",
        [Cl.principal(validator1), Cl.uint(100000000)], // Large rewards to change rate significantly
        validator1
      );

      // Now LTV should be high enough for liquidation (> 90%)
      const { result } = simnet.callPublicFn(
        contractName,
        "liquidate-lending-position",
        [Cl.uint(0)],
        wallet2 // Different user as liquidator
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify position closed
      const position = simnet.callReadOnlyFn(
        contractName,
        "get-lending-position",
        [Cl.uint(0)],
        deployer
      );
      const positionValue = position.result as any;
      expect(positionValue.value.data["active"]).toBeBool(false);

      // Verify liquidator received collateral
      const liquidatorBalance = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet2)],
        deployer
      );
      expect(liquidatorBalance.result).toBeTuple({
        "balance": Cl.uint(10000000), // Received liquidated collateral
        "last-claim-cycle": expect.anything(),
      });
    });
  });

  describe("Emergency and Administrative Functions", () => {
    beforeEach(() => {
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)],
        validator1
      );
    });

    it("should allow owner to emergency close lending positions", () => {
      // Setup lending position
      simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(20000000)],
        wallet1
      );
      simnet.callPublicFn(
        contractName,
        "create-lending-position",
        [Cl.uint(10000000), Cl.uint(6000000), Cl.uint(500), Cl.uint(4320)],
        wallet1
      );

      // Emergency close
      const { result } = simnet.callPublicFn(
        contractName,
        "emergency-close-lending-position",
        [Cl.uint(0)],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify position closed
      const position = simnet.callReadOnlyFn(
        contractName,
        "get-lending-position",
        [Cl.uint(0)],
        deployer
      );
      const positionValue = position.result as any;
      expect(positionValue.value.data["active"]).toBeBool(false);
    });

    it("should reject emergency close from non-owner", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "emergency-close-lending-position",
        [Cl.uint(0)],
        wallet1 // Not owner
      );
      expect(result).toBeErr(Cl.uint(100)); // err-owner-only
    });

    it("should allow owner to update protocol parameters", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "update-protocol-parameters",
        [
          Cl.uint(2000000), // New minimum stake: 2 STX
          Cl.uint(200), // New fee rate: 2%
        ],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should reject parameter updates with invalid values", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "update-protocol-parameters",
        [
          Cl.uint(0), // Invalid minimum stake
          Cl.uint(200),
        ],
        deployer
      );
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });

    it("should reject high fee rates", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "update-protocol-parameters",
        [
          Cl.uint(1000000),
          Cl.uint(600), // 6% - above 5% limit
        ],
        deployer
      );
      expect(result).toBeErr(Cl.uint(103)); // err-invalid-amount
    });
  });

  describe("Integration Tests - Complete User Journey", () => {
    it("should handle complete staking to lending workflow", () => {
      // 1. Register validator
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)],
        validator1
      );

      // 2. User stakes STX
      const stakeResult = simnet.callPublicFn(
        contractName,
        "stake-stx",
        [Cl.principal(validator1), Cl.uint(20000000)],
        wallet1
      );
      expect(stakeResult.result).toBeOk(Cl.uint(20000000));

      // 3. Distribute rewards to increase value
      simnet.callPublicFn(
        contractName,
        "distribute-rewards",
        [Cl.principal(validator1), Cl.uint(2000000)],
        validator1
      );

      // 4. Create lending position with liquid tokens
      const lendingResult = simnet.callPublicFn(
        contractName,
        "create-lending-position",
        [Cl.uint(15000000), Cl.uint(10000000), Cl.uint(500), Cl.uint(4320)],
        wallet1
      );
      expect(lendingResult.result).toBeOk(Cl.uint(0));

      // 5. Transfer remaining liquid tokens
      const transferResult = simnet.callPublicFn(
        contractName,
        "transfer-liquid-tokens",
        [Cl.principal(wallet2), Cl.uint(2000000)],
        wallet1
      );
      expect(transferResult.result).toBeOk(Cl.bool(true));

      // 6. Verify final states
      const wallet1Balance = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      const wallet2Balance = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet2)],
        deployer
      );

      expect(wallet1Balance.result).toBeTuple({
        "balance": Cl.uint(3000000), // 20M - 15M locked - 2M transferred
        "last-claim-cycle": expect.anything(),
      });
      expect(wallet2Balance.result).toBeTuple({
        "balance": Cl.uint(2000000), // Received transfer
        "last-claim-cycle": expect.anything(),
      });
    });

    it("should handle delegation marketplace workflow", () => {
      // 1. Register validators
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1000)],
        validator1
      );
      simnet.callPublicFn(
        contractName,
        "register-validator",
        [Cl.uint(1200)],
        validator2
      );

      // 2. Validator creates delegation offer
      const offerResult = simnet.callPublicFn(
        contractName,
        "create-delegation-offer",
        [Cl.uint(800), Cl.uint(1000000), Cl.uint(50000000), Cl.uint(4320)],
        validator1
      );
      expect(offerResult.result).toBeOk(Cl.uint(0));

      // 3. User accepts delegation offer (stakes automatically)
      const acceptResult = simnet.callPublicFn(
        contractName,
        "accept-delegation-offer",
        [Cl.uint(0), Cl.uint(10000000)],
        wallet1
      );
      expect(acceptResult.result).toBeOk(Cl.bool(true));

      // 4. Verify user has staked position and liquid tokens
      const userStake = simnet.callReadOnlyFn(
        contractName,
        "get-user-stake",
        [Cl.principal(wallet1), Cl.principal(validator1)],
        deployer
      );
      const liquidBalance = simnet.callReadOnlyFn(
        contractName,
        "get-liquid-token-balance",
        [Cl.principal(wallet1)],
        deployer
      );

      expect(userStake.result).toBeSome(expect.anything());
      expect(liquidBalance.result).toBeTuple({
        "balance": Cl.uint(10000000),
        "last-claim-cycle": expect.anything(),
      });
    });
  });
});



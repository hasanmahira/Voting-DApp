const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TokenRegistry", function () {
    let TokenRegistry, MockERC20, MockERC721;
    let tokenRegistry, tokenA, tokenB;
    let deployer, admin, user1, user2, otherUser;

    const ADMIN_ROLE = ethers.utils.id("ADMIN_ROLE");
    const TokenType = { ERC20: 0, ERC721: 1, ERC1155: 2 };

    beforeEach(async function () {
        [deployer, admin, user1, user2, otherUser] = await ethers.getSigners();

        // Deploy TokenRegistry
        TokenRegistry = await ethers.getContractFactory("TokenRegistry");
        tokenRegistry = await TokenRegistry.deploy();
        await tokenRegistry.deployed();

        // Grant ADMIN_ROLE to admin account (deployer has it by default)
        await tokenRegistry.connect(deployer).grantRole(ADMIN_ROLE, admin.address);

        // Deploy Mock Tokens
        MockERC20 = await ethers.getContractFactory("MockERC20");
        tokenA = await MockERC20.deploy("Token A", "TKA", ethers.utils.parseUnits("10000", 18));
        await tokenA.deployed();

        MockERC721 = await ethers.getContractFactory("MockERC721");
        tokenB = await MockERC721.deploy("Token B", "TKB");
        await tokenB.deployed();

        // Add tokens to registry
        await tokenRegistry.connect(admin).addToken(tokenA.address, TokenType.ERC20, 1); // Weight 1
        await tokenRegistry.connect(admin).addToken(tokenB.address, TokenType.ERC721, 10); // Weight 10

        // Distribute tokens
        // User1: 100 TKA (ERC20), 2 TKB (ERC721)
        await tokenA.connect(deployer).transfer(user1.address, ethers.utils.parseUnits("100", 18));
        await tokenB.connect(deployer).mint(user1.address); // NFT ID 1
        await tokenB.connect(deployer).mint(user1.address); // NFT ID 2

        // User2: 50 TKA (ERC20), 3 TKB (ERC721)
        await tokenA.connect(deployer).transfer(user2.address, ethers.utils.parseUnits("50", 18));
        await tokenB.connect(deployer).mint(user2.address); // NFT ID 3
        await tokenB.connect(deployer).mint(user2.address); // NFT ID 4
        await tokenB.connect(deployer).mint(user2.address); // NFT ID 5
    });

    describe("Token Management (addToken, removeToken, setTokenWeight)", function () {
        it("Should allow admin to add tokens", async function () {
            const NewERC20 = await ethers.getContractFactory("MockERC20");
            const newToken = await NewERC20.deploy("New Token", "NTK", 0);
            await newToken.deployed();

            await expect(tokenRegistry.connect(admin).addToken(newToken.address, TokenType.ERC20, 5))
                .to.emit(tokenRegistry, "TokenAdded")
                .withArgs(newToken.address, TokenType.ERC20, "New Token", "NTK");
            
            const tokenInfo = await tokenRegistry.getTokenInfo(newToken.address);
            expect(tokenInfo.active).to.be.true;
            expect(tokenInfo.weight).to.equal(5);
        });

        // Add more tests for removeToken, setTokenWeight, isTokenSupported, getSupportedTokens, getTokenInfo
    });
    
    describe("Raw Voting Power (Linear)", function () {
        it("getRawVotingPower: Should calculate correct raw voting power for user1", async function () {
            // User1: 100 TKA (weight 1) + 2 TKB (weight 10 each) = 100 * 1 + 2 * 10 = 100 + 20 = 120
            const expectedPower = ethers.utils.parseUnits("100", 18).add(2 * 10);
            expect(await tokenRegistry.getRawVotingPower(user1.address)).to.equal(expectedPower);
        });

        it("getRawVotingPower: Should calculate correct raw voting power for user2", async function () {
            // User2: 50 TKA (weight 1) + 3 TKB (weight 10 each) = 50 * 1 + 3 * 10 = 50 + 30 = 80
            const expectedPower = ethers.utils.parseUnits("50", 18).add(3 * 10);
            expect(await tokenRegistry.getRawVotingPower(user2.address)).to.equal(expectedPower);
        });

        it("getRawVotingPower: Should return 0 for user with no tokens", async function () {
            expect(await tokenRegistry.getRawVotingPower(otherUser.address)).to.equal(0);
        });

        it("getRawVotingPowerAtBlock: Should return historical raw power", async function () {
            // Initial power for user1: 120
            const initialPowerUser1 = await tokenRegistry.getRawVotingPower(user1.address);
            expect(initialPowerUser1).to.equal(ethers.utils.parseUnits("100", 18).add(20));

            // Take snapshot
            const snapshotBlockNumber = await ethers.provider.getBlockNumber();
            await tokenRegistry.connect(admin).takeSnapshot([user1.address, user2.address]);
            
            // Change user1's token holdings AFTER snapshot
            // Mint 1 more TKB (NFT) for user1 (power increases by 10)
            // Transfer 50 TKA from user1 to otherUser (power decreases by 50)
            await tokenB.connect(deployer).mint(user1.address); // User1 now has 3 TKB
            await tokenA.connect(user1).transfer(otherUser.address, ethers.utils.parseUnits("50", 18)); // User1 now has 50 TKA

            // Current raw power for user1 should reflect changes
            // User1: 50 TKA (weight 1) + 3 TKB (weight 10 each) = 50 * 1 + 3 * 10 = 50 + 30 = 80
            const currentPowerUser1 = await tokenRegistry.getRawVotingPower(user1.address);
            expect(currentPowerUser1).to.equal(ethers.utils.parseUnits("50", 18).add(30));

            // Raw power at snapshot block should remain unchanged
            const historicalPowerUser1 = await tokenRegistry.getRawVotingPowerAtBlock(user1.address, snapshotBlockNumber);
            expect(historicalPowerUser1).to.equal(initialPowerUser1); // Should be 120
        });
        
        it("getRawVotingPowerAtBlock: Should revert if block not yet mined", async function () {
            const currentBlock = await ethers.provider.getBlockNumber();
            await expect(
                tokenRegistry.getRawVotingPowerAtBlock(user1.address, currentBlock + 5)
            ).to.be.revertedWith("TokenRegistry: block not yet mined");
        });
    });

    // Tests for Quadratic Voting Power will be added next

    describe("Quadratic Voting Power", function () {
        it("getVotingPower: Should calculate correct quadratic voting power", async function () {
            // User1: Raw power = 100 TKA * 1 + 2 TKB * 10 = 120. sqrt(120) = 10 (floor)
            let rawPowerUser1 = await tokenRegistry.getRawVotingPower(user1.address);
            expect(rawPowerUser1).to.equal(ethers.utils.parseUnits("100", 18).add(20));
            expect(await tokenRegistry.getVotingPower(user1.address)).to.equal(Math.floor(Math.sqrt(120)));

            // User2: Raw power = 50 TKA * 1 + 3 TKB * 10 = 80. sqrt(80) = 8 (floor)
            let rawPowerUser2 = await tokenRegistry.getRawVotingPower(user2.address);
            expect(rawPowerUser2).to.equal(ethers.utils.parseUnits("50", 18).add(30));
            expect(await tokenRegistry.getVotingPower(user2.address)).to.equal(Math.floor(Math.sqrt(80)));
            
            // Test specific values
            // To test specific raw values, we need to set a user's balance accordingly.
            // Let's use otherUser and grant them specific amounts of tokenA (weight 1).
            // We'll need to ensure otherUser has no other tokens.
            // For these tests, we can add a new token with weight 1 to simplify, or just use tokenA.
            
            // Clean otherUser's TKA balance (if any from other tests, though not in this setup)
            const otherUserInitialTKA = await tokenA.balanceOf(otherUser.address);
            if (otherUserInitialTKA.gt(0)) {
                 await tokenA.connect(otherUser).transfer(deployer.address, otherUserInitialTKA);
            }
            // Clean otherUser's TKB balance (if any)
            // This is harder as we don't track ERC721 IDs per user easily without more contract features.
            // Assuming otherUser has no TKB from beforeEach.

            const testCases = [
                { raw: 0, quadratic: 0 },
                { raw: 1, quadratic: 1 },
                { raw: 2, quadratic: 1 },
                { raw: 3, quadratic: 1 },
                { raw: 4, quadratic: 2 },
                { raw: 8, quadratic: 2 },
                { raw: 9, quadratic: 3 },
                { raw: 10, quadratic: 3 },
                { raw: 15, quadratic: 3 },
                { raw: 16, quadratic: 4 },
                { raw: 24, quadratic: 4 },
                { raw: 25, quadratic: 5 },
                { raw: 99, quadratic: 9 },
                { raw: 100, quadratic: 10 },
                { raw: 143, quadratic: 11 },
                { raw: 144, quadratic: 12 },
            ];

            for (const tc of testCases) {
                // Set otherUser's balance of tokenA to tc.raw (assuming tokenA has weight 1)
                // Since tokenA is ERC20 with 18 decimals, we need to parseUnits if tc.raw is meant as whole tokens.
                // Given the raw values are small, let's assume these are the final raw values, so we mint 'raw' amount of a weight 1 token.
                // For simplicity, let's assume tc.raw is the exact raw voting power.
                // This requires a way to directly set raw voting power, or use a mock that returns it.
                // The current TokenRegistry calculates raw power based on actual token balances.
                // So, we set tokenA balance for otherUser.
                const currentBalance = await tokenA.balanceOf(otherUser.address);
                if (ethers.BigNumber.from(tc.raw).gt(currentBalance)) {
                    await tokenA.connect(deployer).transfer(otherUser.address, ethers.BigNumber.from(tc.raw).sub(currentBalance));
                } else if (ethers.BigNumber.from(tc.raw).lt(currentBalance)) {
                    await tokenA.connect(otherUser).transfer(deployer.address, currentBalance.sub(tc.raw));
                }
                // Verify balance is now tc.raw (assuming tokenA is the only token for otherUser with weight 1)
                expect(await tokenA.balanceOf(otherUser.address)).to.equal(tc.raw);
                expect(await tokenRegistry.getRawVotingPower(otherUser.address)).to.equal(tc.raw);
                expect(await tokenRegistry.getVotingPower(otherUser.address)).to.equal(tc.quadratic, `Test failed for raw=${tc.raw}`);
            }
        });

        it("getVotingPowerAtBlock: Should calculate correct quadratic voting power from snapshot", async function () {
            // From previous raw power test: initialPowerUser1 for user1 was 120 (sqrt=10)
            // Take snapshot for user1
            const snapshotBlockNumber = await ethers.provider.getBlockNumber();
            await tokenRegistry.connect(admin).takeSnapshot([user1.address]);
            
            // Verify quadratic power at snapshot block
            const historicalRawPowerUser1 = await tokenRegistry.getRawVotingPowerAtBlock(user1.address, snapshotBlockNumber);
            expect(historicalRawPowerUser1).to.equal(ethers.utils.parseUnits("100", 18).add(20)); // 120
            expect(await tokenRegistry.getVotingPowerAtBlock(user1.address, snapshotBlockNumber)).to.equal(Math.floor(Math.sqrt(120))); // sqrt(120) = 10

            // Change user1's token holdings AFTER snapshot
            await tokenB.connect(deployer).mint(user1.address); // User1 now has 3 TKB (raw power changes from 120 to 130)
            await tokenA.connect(user1).transfer(otherUser.address, ethers.utils.parseUnits("50", 18)); // User1 now has 50 TKA (raw power changes from 130 to 80)
            // Current raw power for user1: 50 TKA * 1 + 3 TKB * 10 = 80. sqrt(80) = 8
            
            // Current quadratic power should reflect changes
            expect(await tokenRegistry.getVotingPower(user1.address)).to.equal(Math.floor(Math.sqrt(80)));

            // Quadratic power at snapshot block should remain based on snapshot's raw power (120)
            expect(await tokenRegistry.getVotingPowerAtBlock(user1.address, snapshotBlockNumber)).to.equal(Math.floor(Math.sqrt(120)));
        });
        
        it("getVotingPowerAtBlock: Should revert if block not yet mined", async function () {
            const currentBlock = await ethers.provider.getBlockNumber();
            await expect(
                tokenRegistry.getVotingPowerAtBlock(user1.address, currentBlock + 5)
            ).to.be.revertedWith("TokenRegistry: block not yet mined"); // This check is actually in getRawVotingPowerAtBlock
        });
    });
});

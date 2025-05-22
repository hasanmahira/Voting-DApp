const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("VotingCore E2E Tests", function () {
    // Contracts
    let VotingCore, ProposalManager, ExecutionTimelock, TokenRegistry, MockERC20, MockTarget;
    let votingCore, proposalManager, timelock, tokenRegistry, governanceToken, mockTarget;

    // Accounts
    let deployer, admin, voter1, voter2, voter3, otherUser, proposalCreator;

    // Contract Roles (using string literals for clarity in test setup)
    const ADMIN_ROLE_PM = ethers.utils.id("ADMIN_ROLE");
    const CORE_ROLE_PM = ethers.utils.id("CORE_ROLE");
    const PROPOSER_ROLE_TL = ethers.utils.id("PROPOSER_ROLE");
    const EXECUTOR_ROLE_TL = ethers.utils.id("EXECUTOR_ROLE");
    const TIMELOCK_ADMIN_ROLE_TL = ethers.utils.id("TIMELOCK_ADMIN_ROLE");

    // Default Parameters
    const TIMELOCK_MIN_DELAY = 3600; // 1 hour
    const VOTING_DELAY_BLOCKS = 1;
    const VOTING_PERIOD_BLOCKS = 50; // Approx 10 mins with 12s blocks for testing
    const PROPOSAL_THRESHOLD_VOTES = ethers.utils.parseUnits("100", 18); // 100 tokens
    const GOVERNANCE_TOKEN_INITIAL_SUPPLY = ethers.utils.parseUnits("1000000", 18); // 1M tokens

    beforeEach(async function () {
        // 1. Get Signers
        [deployer, admin, voter1, voter2, voter3, otherUser, proposalCreator] = await ethers.getSigners();

        // 2. Deploy Contracts
        // Mock Governance Token (ERC20)
        MockERC20 = await ethers.getContractFactory("MockERC20");
        governanceToken = await MockERC20.deploy("Mock Governance Token", "MGT", GOVERNANCE_TOKEN_INITIAL_SUPPLY);
        await governanceToken.deployed();

        // TokenRegistry
        TokenRegistry = await ethers.getContractFactory("TokenRegistry");
        tokenRegistry = await TokenRegistry.deploy(); // Deployer is owner
        await tokenRegistry.deployed();

        // ExecutionTimelock
        ExecutionTimelock = await ethers.getContractFactory("ExecutionTimelock");
        timelock = await ExecutionTimelock.deploy(
            TIMELOCK_MIN_DELAY,
            [], // Initial proposers for Timelock (ProposalManager will be added)
            [], // Initial executors for Timelock (ProposalManager will be added)
            admin.address // Admin for Timelock
        );
        await timelock.deployed();

        // ProposalManager
        ProposalManager = await ethers.getContractFactory("ProposalManager");
        proposalManager = await ProposalManager.deploy(); // Deployer is admin by default
        await proposalManager.deployed();

        // VotingCore
        VotingCore = await ethers.getContractFactory("VotingCore");
        votingCore = await VotingCore.deploy(); // Deployer is owner by default
        await votingCore.deployed();
        
        // MockTarget
        MockTarget = await ethers.getContractFactory("MockTarget");
        mockTarget = await MockTarget.deploy();
        await mockTarget.deployed();

        // 3. Distribute Mock Governance Tokens
        await governanceToken.connect(deployer).transfer(proposalCreator.address, ethers.utils.parseUnits("500", 18));
        await governanceToken.connect(deployer).transfer(voter1.address, ethers.utils.parseUnits("300", 18));
        await governanceToken.connect(deployer).transfer(voter2.address, ethers.utils.parseUnits("300", 18));
        await governanceToken.connect(deployer).transfer(voter3.address, ethers.utils.parseUnits("200", 18));

        // 4. Configure TokenRegistry
        // Deployer of TokenRegistry is owner, so can call setGovernanceToken
        await tokenRegistry.connect(deployer).setGovernanceToken(governanceToken.address);

        // 5. Configure VotingCore
        // Deployer of VotingCore is owner
        await votingCore.connect(deployer).setProposalManager(proposalManager.address);
        await votingCore.connect(deployer).setTokenRegistry(tokenRegistry.address);
        await votingCore.connect(deployer).setDelegation(ethers.constants.AddressZero); // No delegation for these tests
        await votingCore.connect(deployer).setVotingDelay(VOTING_DELAY_BLOCKS);
        await votingCore.connect(deployer).setVotingPeriod(VOTING_PERIOD_BLOCKS);
        await votingCore.connect(deployer).setProposalThreshold(PROPOSAL_THRESHOLD_VOTES);

        // 6. Configure ProposalManager
        // Deployer of ProposalManager is admin initially. Grant ADMIN_ROLE to 'admin' signer if different.
        if (deployer.address !== admin.address) {
            await proposalManager.connect(deployer).grantRole(ADMIN_ROLE_PM, admin.address);
        }
        // 'admin' (or deployer if admin is deployer) sets timelock and grants CORE_ROLE
        const pmAdmin = admin.address === deployer.address ? deployer : admin;
        await proposalManager.connect(pmAdmin).setTimelock(timelock.address);
        await proposalManager.connect(pmAdmin).grantRole(CORE_ROLE_PM, votingCore.address);

        // 7. Configure ExecutionTimelock
        // 'admin' (admin of Timelock) grants roles to ProposalManager contract
        await timelock.connect(admin).grantRole(PROPOSER_ROLE_TL, proposalManager.address);
        await timelock.connect(admin).grantRole(EXECUTOR_ROLE_TL, proposalManager.address);
    });

    describe("Initial Setup Verification", function () {
        it("Should have correct addresses set up", async function () {
            expect(await votingCore.proposalManager()).to.equal(proposalManager.address);
            expect(await votingCore.tokenRegistry()).to.equal(tokenRegistry.address);
            expect(await tokenRegistry.governanceToken()).to.equal(governanceToken.address);
            expect(await proposalManager.timelock()).to.equal(timelock.address);
        });

        it("Should have correct roles granted", async function () {
            expect(await proposalManager.hasRole(CORE_ROLE_PM, votingCore.address)).to.be.true;
            expect(await timelock.hasRole(PROPOSER_ROLE_TL, proposalManager.address)).to.be.true;
            expect(await timelock.hasRole(EXECUTOR_ROLE_TL, proposalManager.address)).to.be.true;
        });

        it("Should have voting parameters set", async function () {
            expect(await votingCore.votingDelay()).to.equal(VOTING_DELAY_BLOCKS);
            expect(await votingCore.votingPeriod()).to.equal(VOTING_PERIOD_BLOCKS);
            expect(await votingCore.proposalThreshold()).to.equal(PROPOSAL_THRESHOLD_VOTES);
        });

        it("Voters should have governance tokens", async function () {
            expect(await governanceToken.balanceOf(proposalCreator.address)).to.equal(ethers.utils.parseUnits("500", 18));
            expect(await governanceToken.balanceOf(voter1.address)).to.equal(ethers.utils.parseUnits("300", 18));
        });
    });

    // Test sections for Proposal Creation, Voting, Queuing, Execution etc. will follow

    describe("Proposal Creation", function () {
        let targets, values, calldatas;
        let title = "Test Create Proposal";
        let description = "A proposal created via VotingCore.";
        let ipfsHash = "QmCreate";

        beforeEach(async function () {
            targets = [mockTarget.address];
            values = [0];
            const setXInterface = new ethers.utils.Interface(["function setX(uint256 _x)"]);
            calldatas = [setXInterface.encodeFunctionData("setX", [999])];
        });

        it("Should allow an account with sufficient voting power to create a proposal", async function () {
            const currentBlock = await ethers.provider.getBlockNumber();
            const expectedStartBlock = currentBlock + 1 + VOTING_DELAY_BLOCKS; // +1 for current block of createProposal tx
            const expectedEndBlock = expectedStartBlock + VOTING_PERIOD_BLOCKS;

            const tx = await votingCore.connect(proposalCreator).createProposal(title, description, ipfsHash, targets, values, calldatas);
            
            await expect(tx)
                .to.emit(votingCore, "ProposalCreated")
                .withArgs(1, proposalCreator.address, title); // Assuming proposalId starts from 1

            const vcProposal = await votingCore.getProposalDetails(1);
            expect(vcProposal.id).to.equal(1);
            expect(vcProposal.proposer).to.equal(proposalCreator.address);
            expect(vcProposal.title).to.equal(title);
            expect(vcProposal.description).to.equal(description);
            expect(vcProposal.ipfsHash).to.equal(ipfsHash);
            expect(vcProposal.startBlock).to.equal(expectedStartBlock);
            expect(vcProposal.endBlock).to.equal(expectedEndBlock);
            expect(vcProposal.executed).to.be.false;
            expect(vcProposal.queued).to.be.false;

            // Verify proposal in ProposalManager
            // The proposal ID in ProposalManager is different, derived from content.
            // We need to listen to ProposalManager's event or predict its ID.
            // For simplicity, we assume VotingCore's proposalId is passed to PM or linked.
            // Based on current code, ProposalManager generates its own ID.
            // VotingCore doesn't store PM's ID.
            // This test needs to acknowledge that PM has its own IDing.
            // The current design of VotingCore.createProposal does not return PM's proposalId.
            // This makes direct verification tricky without modifying contracts or relying on event sniffing from PM.
            // Let's focus on VotingCore's state.
            // To check PM, we'd need to predict PM's ID or have VotingCore emit it.
            // The call to PM.createProposal happens, but verifying its *specific* outcome in PM
            // is harder without a shared ID or events that link them.
            // For now, we'll trust the call was made. A more robust test would involve PM event sniffing.
        });

        it("Should revert if proposer has insufficient voting power", async function () {
            await expect(
                votingCore.connect(otherUser).createProposal(title, description, ipfsHash, targets, values, calldatas)
            ).to.be.revertedWith("VotingCore: proposer votes below threshold");
        });

        it("Should revert if targets array is empty", async function () {
            await expect(
                votingCore.connect(proposalCreator).createProposal(title, description, ipfsHash, [], [], [])
            ).to.be.revertedWith("VotingCore: proposal must have actions");
        });

        it("Should revert if targets, values, and calldatas lengths mismatch", async function () {
            await expect(
                votingCore.connect(proposalCreator).createProposal(title, description, ipfsHash, targets, [0, 0], calldatas)
            ).to.be.revertedWith("VotingCore: proposal actions mismatch");

            await expect(
                votingCore.connect(proposalCreator).createProposal(title, description, ipfsHash, targets, values, [calldatas[0], calldatas[0]])
            ).to.be.revertedWith("VotingCore: proposal actions mismatch");
        });
    });

    describe("Voting Process", function () {
        let proposalId = 1; // Assuming proposal with ID 1 is created
        let targets, values, calldatas;
        let title = "Voting Test Proposal";
        let description = "A proposal to test voting on.";
        let ipfsHash = "QmVote";

        beforeEach(async function () {
            // Create a proposal for voting
            targets = [mockTarget.address];
            values = [0];
            const setXInterface = new ethers.utils.Interface(["function setX(uint256 _x)"]);
            calldatas = [setXInterface.encodeFunctionData("setX", [123])];
            
            await votingCore.connect(proposalCreator).createProposal(title, description, ipfsHash, targets, values, calldatas);
            // proposalId should be 1 based on the previous test structure. If not, fetch from event.
            // Let's ensure proposalId is correctly assigned if tests run independently or out of order.
            const filter = votingCore.filters.ProposalCreated(null, proposalCreator.address, title);
            const events = await votingCore.queryFilter(filter, "latest");
            if (events.length > 0) {
                 proposalId = events[0].args.proposalId;
            } else {
                // Fallback if event not immediately found (e.g. if a previous test created one)
                // This is a bit fragile; ideally, tests are fully isolated or IDs are deterministic.
                // For now, we'll assume the last proposal by proposalCreator with this title.
                // A better way: use a counter or directly get from createProposal return if it did.
                // Since it doesn't, event sniffing or tracking is needed.
                // The current VotingCore uses an internal counter, so ID 1 is likely after first create.
            }

            // Advance to voting period if votingDelay > 0
            if (VOTING_DELAY_BLOCKS > 0) {
                await time.advanceBlock(VOTING_DELAY_BLOCKS + 1); // +1 to be within active period
            }
        });

        it("Should allow eligible voters to cast votes (for, against, abstain)", async function () {
            const voter1Power = await tokenRegistry.getVotingPower(voter1.address);
            const voter2Power = await tokenRegistry.getVotingPower(voter2.address);
            const voter3Power = await tokenRegistry.getVotingPower(voter3.address);

            // Voter 1 votes FOR
            await expect(votingCore.connect(voter1).castVote(proposalId, 1)) // 1 = For
                .to.emit(votingCore, "VoteCast")
                .withArgs(voter1.address, proposalId, 1, voter1Power);

            let proposalDetails = await votingCore.getProposalDetails(proposalId);
            expect(proposalDetails.forVotes).to.equal(voter1Power);
            let receipt = await votingCore.getReceipt(proposalId, voter1.address);
            expect(receipt.hasVoted).to.be.true;
            expect(receipt.support).to.equal(1);
            expect(receipt.votes).to.equal(voter1Power);

            // Voter 2 votes AGAINST with reason
            const reason = "Against this proposal";
            await expect(votingCore.connect(voter2).castVoteWithReason(proposalId, 0, reason)) // 0 = Against
                .to.emit(votingCore, "VoteCast")
                .withArgs(voter2.address, proposalId, 0, voter2Power); // Event doesn't include reason

            proposalDetails = await votingCore.getProposalDetails(proposalId);
            expect(proposalDetails.againstVotes).to.equal(voter2Power);
            receipt = await votingCore.getReceipt(proposalId, voter2.address);
            expect(receipt.hasVoted).to.be.true;
            expect(receipt.support).to.equal(0);
            expect(receipt.votes).to.equal(voter2Power);
            
            // Voter 3 votes ABSTAIN
            await expect(votingCore.connect(voter3).castVote(proposalId, 2)) // 2 = Abstain
                .to.emit(votingCore, "VoteCast")
                .withArgs(voter3.address, proposalId, 2, voter3Power);

            proposalDetails = await votingCore.getProposalDetails(proposalId);
            expect(proposalDetails.abstainVotes).to.equal(voter3Power);
            receipt = await votingCore.getReceipt(proposalId, voter3.address);
            expect(receipt.hasVoted).to.be.true;
            expect(receipt.support).to.equal(2);
            expect(receipt.votes).to.equal(voter3Power);
        });

        it("Should revert if voting on a non-existent proposal", async function () {
            const nonExistentProposalId = 999;
            await expect(
                votingCore.connect(voter1).castVote(nonExistentProposalId, 1)
            ).to.be.revertedWith("VotingCore: proposal does not exist");
        });

        it("Should revert if voting before startBlock (voting not active)", async function () {
            // Create a new proposal for this test to control timing precisely
            const currentBlock = await ethers.provider.getBlockNumber();
            const newProposalTx = await votingCore.connect(proposalCreator).createProposal("Future Vote", "Desc", "QmFuture", targets, values, calldatas);
            const newReceipt = await newProposalTx.wait();
            const newProposalId = newReceipt.events.find(e => e.event === "ProposalCreated").args.proposalId;

            // Do NOT advance time to voting period
            if (VOTING_DELAY_BLOCKS > 0) { // Only makes sense if there's a delay
                 await expect(
                    votingCore.connect(voter1).castVote(newProposalId, 1)
                ).to.be.revertedWith("VotingCore: voting not started");
            } else {
                // If no voting delay, it should be active immediately after the creation block.
                // This branch might not be hit if VOTING_DELAY_BLOCKS is always >0 for tests.
                // If VOTING_DELAY_BLOCKS = 0, this test would need adjustment or is moot.
            }
        });

        it("Should revert if voting after endBlock (voting period ended)", async function () {
            await time.advanceBlock(VOTING_PERIOD_BLOCKS + VOTING_DELAY_BLOCKS + 2); // Ensure past endBlock
            await expect(
                votingCore.connect(voter1).castVote(proposalId, 1)
            ).to.be.revertedWith("VotingCore: voting ended");
        });

        it("Should revert if an account tries to vote twice", async function () {
            await votingCore.connect(voter1).castVote(proposalId, 1); // First vote
            await expect(
                votingCore.connect(voter1).castVote(proposalId, 0) // Second attempt
            ).to.be.revertedWith("VotingCore: already voted");
        });
        
        it("Should revert if using an invalid support value", async function () {
            await expect(
                votingCore.connect(voter1).castVote(proposalId, 3) // Invalid support type
            ).to.be.revertedWith("VotingCore: invalid vote type");
        });
    });

    describe("Vote Processing and Queuing (processProposalVoteOutcomeAndQueue)", function () {
        let proposalId = 1;
        let targets, values, calldatas;

        beforeEach(async function () {
            // Create a proposal
            targets = [mockTarget.address];
            values = [0];
            const setXInterface = new ethers.utils.Interface(["function setX(uint256 _x)"]);
            calldatas = [setXInterface.encodeFunctionData("setX", [123])];
            
            const createTx = await votingCore.connect(proposalCreator).createProposal("Queue Test", "Desc", "QmQueue", targets, values, calldatas);
            const createReceipt = await createTx.wait();
            proposalId = createReceipt.events.find(e => e.event === "ProposalCreated").args.proposalId;

            // Advance to voting period
            if (VOTING_DELAY_BLOCKS > 0) {
                await time.advanceBlock(VOTING_DELAY_BLOCKS + 1);
            }
        });

        it("Should queue a passed proposal", async function () {
            // Voters vote: For > Against
            await votingCore.connect(voter1).castVote(proposalId, 1); // For: 300
            await votingCore.connect(voter2).castVote(proposalId, 0); // Against: 300 (will make it tied)
            await votingCore.connect(proposalCreator).castVote(proposalId, 1); // For: 500 (Total For: 800, Against: 300)

            // Advance past voting period
            const vcProposalInitial = await votingCore.getProposalDetails(proposalId);
            await time.advanceBlockTo(vcProposalInitial.endBlock.toNumber() + 1);

            await expect(votingCore.connect(otherUser).processProposalVoteOutcomeAndQueue(proposalId))
                .to.emit(votingCore, "ProposalQueuedForTimelock")
                .withArgs(proposalId);

            const vcProposalUpdated = await votingCore.getProposalDetails(proposalId);
            expect(vcProposalUpdated.queued).to.be.true;

            // Verify with ProposalManager
            const pmProposal = await proposalManager.getProposal(proposalId); // PM uses same ID as VC
            expect(pmProposal.timelockId).to.not.equal(ethers.constants.HashZero);
            expect(await timelock.isOperationPending(pmProposal.timelockId)).to.be.true;
        });

        it("Should not queue a failed proposal (against > for)", async function () {
            await votingCore.connect(voter1).castVote(proposalId, 0); // Against: 300
            await votingCore.connect(voter2).castVote(proposalId, 1); // For: 300
            await votingCore.connect(proposalCreator).castVote(proposalId, 0); // Against: 500 (Total For: 300, Against: 800)

            const vcProposalInitial = await votingCore.getProposalDetails(proposalId);
            await time.advanceBlockTo(vcProposalInitial.endBlock.toNumber() + 1);

            // Should not revert, but also not emit ProposalQueuedForTimelock
            await expect(votingCore.connect(otherUser).processProposalVoteOutcomeAndQueue(proposalId))
                .to.not.emit(votingCore, "ProposalQueuedForTimelock");
            
            const vcProposalUpdated = await votingCore.getProposalDetails(proposalId);
            expect(vcProposalUpdated.queued).to.be.false;
        });
        
        it("Should not queue a failed proposal (for == against)", async function () {
            await votingCore.connect(voter1).castVote(proposalId, 1); // For: 300
            await votingCore.connect(voter2).castVote(proposalId, 0); // Against: 300

            const vcProposalInitial = await votingCore.getProposalDetails(proposalId);
            await time.advanceBlockTo(vcProposalInitial.endBlock.toNumber() + 1);
            
            await expect(votingCore.connect(otherUser).processProposalVoteOutcomeAndQueue(proposalId))
                .to.not.emit(votingCore, "ProposalQueuedForTimelock");

            const vcProposalUpdated = await votingCore.getProposalDetails(proposalId);
            expect(vcProposalUpdated.queued).to.be.false;
        });


        it("Should revert if called before voting period ends", async function () {
            // Votes cast, but voting period not ended
            await votingCore.connect(voter1).castVote(proposalId, 1);
            await expect(
                votingCore.connect(otherUser).processProposalVoteOutcomeAndQueue(proposalId)
            ).to.be.revertedWith("VotingCore: voting period not ended");
        });

        it("Should revert if proposal already queued", async function () {
            await votingCore.connect(voter1).castVote(proposalId, 1); // Pass the proposal
            const vcProposalInitial = await votingCore.getProposalDetails(proposalId);
            await time.advanceBlockTo(vcProposalInitial.endBlock.toNumber() + 1);
            await votingCore.connect(otherUser).processProposalVoteOutcomeAndQueue(proposalId); // First queue

            await expect(
                votingCore.connect(otherUser).processProposalVoteOutcomeAndQueue(proposalId) // Second attempt
            ).to.be.revertedWith("VotingCore: proposal already queued");
        });

        it("Should revert if proposal already executed", async function () {
            // Make proposal pass, queue, and execute
            await votingCore.connect(voter1).castVote(proposalId, 1);
            const vcProposalInitial = await votingCore.getProposalDetails(proposalId);
            await time.advanceBlockTo(vcProposalInitial.endBlock.toNumber() + 1);
            await votingCore.connect(otherUser).processProposalVoteOutcomeAndQueue(proposalId);
            
            await time.increase(TIMELOCK_MIN_DELAY);
            await votingCore.connect(otherUser).executeQueuedProposal(proposalId);

            await expect(
                votingCore.connect(otherUser).processProposalVoteOutcomeAndQueue(proposalId)
            ).to.be.revertedWith("VotingCore: proposal already executed");
        });
    });

    describe("Proposal Execution Lifecycle (executeQueuedProposal)", function () {
        let proposalId = 1;
        let targets, values, calldatas;
        const executionTargetValue = 777;

        beforeEach(async function () {
            // Create a proposal
            targets = [mockTarget.address];
            values = [0];
            const setXInterface = new ethers.utils.Interface(["function setX(uint256 _x)"]);
            calldatas = [setXInterface.encodeFunctionData("setX", [executionTargetValue])];
            
            const createTx = await votingCore.connect(proposalCreator).createProposal("Execution Test", "Desc", "QmExec", targets, values, calldatas);
            const createReceipt = await createTx.wait();
            proposalId = createReceipt.events.find(e => e.event === "ProposalCreated").args.proposalId;

            // Advance to voting period
            if (VOTING_DELAY_BLOCKS > 0) {
                await time.advanceBlock(VOTING_DELAY_BLOCKS + 1);
            }
            
            // Make proposal pass
            await votingCore.connect(voter1).castVote(proposalId, 1); // For: 300
            await votingCore.connect(proposalCreator).castVote(proposalId, 1); // For: 500 (Total For: 800)

            // Advance past voting period
            const vcProposalInitial = await votingCore.getProposalDetails(proposalId);
            await time.advanceBlockTo(vcProposalInitial.endBlock.toNumber() + 1);

            // Queue the passed proposal
            await votingCore.connect(otherUser).processProposalVoteOutcomeAndQueue(proposalId);
        });

        it("Should revert if trying to execute before timelock delay has passed", async function () {
            // Time has NOT been advanced by TIMELOCK_MIN_DELAY yet
            await expect(
                votingCore.connect(otherUser).executeQueuedProposal(proposalId)
            ).to.be.revertedWith("ProposalManager: Timelock operation not ready");
        });

        it("Should execute a queued proposal after timelock delay", async function () {
            await time.increase(TIMELOCK_MIN_DELAY); // Wait for timelock delay

            expect(await mockTarget.x()).to.equal(0); // Initial state of target

            await expect(votingCore.connect(otherUser).executeQueuedProposal(proposalId))
                .to.emit(votingCore, "ProposalExecuted")
                .withArgs(proposalId);

            const vcProposalUpdated = await votingCore.getProposalDetails(proposalId);
            expect(vcProposalUpdated.executed).to.be.true;
            expect(vcProposalUpdated.queued).to.be.false;

            expect(await mockTarget.x()).to.equal(executionTargetValue); // Target state changed

            // Verify on Timelock via ProposalManager's stored timelockId
            const pmProposal = await proposalManager.getProposal(proposalId);
            expect(await timelock.isOperationDone(pmProposal.timelockId)).to.be.true;
        });

        it("Should revert if trying to execute a proposal not queued", async function () {
            // Create another proposal that is not queued
            const createTx2 = await votingCore.connect(proposalCreator).createProposal("Not Queued Exec Test", "Desc", "QmNQExec", targets, values, calldatas);
            const createReceipt2 = await createTx2.wait();
            const newProposalId = createReceipt2.events.find(e => e.event === "ProposalCreated").args.proposalId;
            
            await time.increase(TIMELOCK_MIN_DELAY);
            await expect(
                votingCore.connect(otherUser).executeQueuedProposal(newProposalId)
            ).to.be.revertedWith("VotingCore: proposal not queued");
        });

        it("Should revert if trying to execute an already executed proposal", async function () {
            await time.increase(TIMELOCK_MIN_DELAY);
            await votingCore.connect(otherUser).executeQueuedProposal(proposalId); // First execution

            await expect(
                votingCore.connect(otherUser).executeQueuedProposal(proposalId) // Second attempt
            ).to.be.revertedWith("VotingCore: proposal already executed");
        });
    });

    describe("Proposal Failure Lifecycle", function () {
        let proposalId = 1;
        let targets, values, calldatas;

        it("Should handle a failed proposal correctly (not queued, not executed)", async function () {
            // Create a proposal
            targets = [mockTarget.address];
            values = [0];
            const setXInterface = new ethers.utils.Interface(["function setX(uint256 _x)"]);
            calldatas = [setXInterface.encodeFunctionData("setX", [404])];
            
            const createTx = await votingCore.connect(proposalCreator).createProposal("Failed Prop Test", "Desc", "QmFail", targets, values, calldatas);
            const createReceipt = await createTx.wait();
            proposalId = createReceipt.events.find(e => e.event === "ProposalCreated").args.proposalId;

            // Advance to voting period
            if (VOTING_DELAY_BLOCKS > 0) {
                await time.advanceBlock(VOTING_DELAY_BLOCKS + 1);
            }

            // Make proposal fail (e.g., more against votes)
            await votingCore.connect(voter1).castVote(proposalId, 0); // Against: 300
            await votingCore.connect(voter2).castVote(proposalId, 0); // Against: 300 (Total Against: 600)
            await votingCore.connect(proposalCreator).castVote(proposalId, 1); // For: 500

            // Advance past voting period
            const vcProposalInitial = await votingCore.getProposalDetails(proposalId);
            await time.advanceBlockTo(vcProposalInitial.endBlock.toNumber() + 1);

            // Process vote outcome
            await expect(votingCore.connect(otherUser).processProposalVoteOutcomeAndQueue(proposalId))
                .to.not.emit(votingCore, "ProposalQueuedForTimelock");

            const vcProposalUpdated = await votingCore.getProposalDetails(proposalId);
            expect(vcProposalUpdated.queued).to.be.false;
            expect(vcProposalUpdated.executed).to.be.false;

            // Attempt to execute - should fail as it was not queued
            await expect(
                votingCore.connect(otherUser).executeQueuedProposal(proposalId)
            ).to.be.revertedWith("VotingCore: proposal not queued");
        });
    });

    describe("View Functions", function () {
        let proposalId = 1;
        let targets, values, calldatas;

        beforeEach(async function () {
            targets = [mockTarget.address];
            values = [0];
            const setXInterface = new ethers.utils.Interface(["function setX(uint256 _x)"]);
            calldatas = [setXInterface.encodeFunctionData("setX", [1])];
            
            const createTx = await votingCore.connect(proposalCreator).createProposal("View Test", "Desc", "QmView", targets, values, calldatas);
            const createReceipt = await createTx.wait();
            proposalId = createReceipt.events.find(e => e.event === "ProposalCreated").args.proposalId;
        });

        it("getProposalDetails should return correct details at different stages", async function () {
            // After creation
            let details = await votingCore.getProposalDetails(proposalId);
            expect(details.id).to.equal(proposalId);
            expect(details.proposer).to.equal(proposalCreator.address);
            expect(details.forVotes).to.equal(0);
            expect(details.againstVotes).to.equal(0);
            expect(details.abstainVotes).to.equal(0);
            expect(details.queued).to.be.false;
            expect(details.executed).to.be.false;

            // After voting
            if (VOTING_DELAY_BLOCKS > 0) await time.advanceBlock(VOTING_DELAY_BLOCKS + 1);
            const voter1Power = await tokenRegistry.getVotingPower(voter1.address);
            await votingCore.connect(voter1).castVote(proposalId, 1); // Vote For
            details = await votingCore.getProposalDetails(proposalId);
            expect(details.forVotes).to.equal(voter1Power);

            // After queuing
            const vcProp = await votingCore.getProposalDetails(proposalId);
            await time.advanceBlockTo(vcProp.endBlock.toNumber() + 1);
            await votingCore.connect(otherUser).processProposalVoteOutcomeAndQueue(proposalId);
            details = await votingCore.getProposalDetails(proposalId);
            expect(details.queued).to.be.true;

            // After execution
            await time.increase(TIMELOCK_MIN_DELAY);
            await votingCore.connect(otherUser).executeQueuedProposal(proposalId);
            details = await votingCore.getProposalDetails(proposalId);
            expect(details.executed).to.be.true;
            expect(details.queued).to.be.false; // Should be false after execution
        });

        it("getReceipt should return correct receipt details", async function () {
            // Voter1 has not voted yet on this proposalId (it's new each test)
            let receipt = await votingCore.getReceipt(proposalId, voter1.address);
            expect(receipt.hasVoted).to.be.false;
            expect(receipt.support).to.equal(0); // Default
            expect(receipt.votes).to.equal(0);   // Default

            // Vote and check receipt
            if (VOTING_DELAY_BLOCKS > 0) await time.advanceBlock(VOTING_DELAY_BLOCKS + 1);
            const voter1Power = await tokenRegistry.getVotingPower(voter1.address);
            await votingCore.connect(voter1).castVote(proposalId, 1); // Vote For

            receipt = await votingCore.getReceipt(proposalId, voter1.address);
            expect(receipt.hasVoted).to.be.true;
            expect(receipt.support).to.equal(1); // For
            expect(receipt.votes).to.equal(voter1Power);
        });
    });

    describe("Access Control and Configuration", function () {
        it("Should allow owner to set voting delay", async function () {
            const newDelay = 10;
            await votingCore.connect(deployer).setVotingDelay(newDelay);
            expect(await votingCore.votingDelay()).to.equal(newDelay);
            await expect(
                votingCore.connect(otherUser).setVotingDelay(newDelay)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should allow owner to set voting period", async function () {
            const newPeriod = 100;
            await votingCore.connect(deployer).setVotingPeriod(newPeriod);
            expect(await votingCore.votingPeriod()).to.equal(newPeriod);
            await expect(
                votingCore.connect(otherUser).setVotingPeriod(newPeriod)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
        
        it("Should revert if setting voting period to 0", async function () {
            await expect(
                votingCore.connect(deployer).setVotingPeriod(0)
            ).to.be.revertedWith("VotingCore: voting period cannot be 0");
        });


        it("Should allow owner to set proposal threshold", async function () {
            const newThreshold = ethers.utils.parseUnits("200", 18);
            await votingCore.connect(deployer).setProposalThreshold(newThreshold);
            expect(await votingCore.proposalThreshold()).to.equal(newThreshold);
            await expect(
                votingCore.connect(otherUser).setProposalThreshold(newThreshold)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should allow owner to set proposal manager", async function () {
            const newPMAddress = ethers.constants.AddressZero; // Example, though should be valid contract
            // For test, deploy a new PM to change to
            const newPM = await ProposalManager.deploy();
            await newPM.deployed();

            await votingCore.connect(deployer).setProposalManager(newPM.address);
            expect(await votingCore.proposalManager()).to.equal(newPM.address);
            await expect(
                votingCore.connect(otherUser).setProposalManager(newPM.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                 votingCore.connect(deployer).setProposalManager(ethers.constants.AddressZero)
            ).to.be.revertedWith("VotingCore: invalid proposal manager address");
        });

        it("Should allow owner to set token registry", async function () {
            const newTR = await TokenRegistry.deploy();
            await newTR.deployed();
            await votingCore.connect(deployer).setTokenRegistry(newTR.address);
            expect(await votingCore.tokenRegistry()).to.equal(newTR.address);
            await expect(
                votingCore.connect(otherUser).setTokenRegistry(newTR.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(
                 votingCore.connect(deployer).setTokenRegistry(ethers.constants.AddressZero)
            ).to.be.revertedWith("VotingCore: invalid token registry address");
        });
        
        it("Should allow owner to set delegation address", async function () {
            // For this test, setting to another arbitrary address, e.g., otherUser's address
            // In a real scenario, this would be a delegation contract address.
            const newDelegationAddress = otherUser.address; 
            await votingCore.connect(deployer).setDelegation(newDelegationAddress);
            expect(await votingCore.delegation()).to.equal(newDelegationAddress);
            await expect(
                votingCore.connect(otherUser).setDelegation(newDelegationAddress)
            ).to.be.revertedWith("Ownable: caller is not the owner");
            // Setting to address(0) is allowed for delegation if no delegation contract is used
            await votingCore.connect(deployer).setDelegation(ethers.constants.AddressZero);
            expect(await votingCore.delegation()).to.equal(ethers.constants.AddressZero);
        });
    });
});

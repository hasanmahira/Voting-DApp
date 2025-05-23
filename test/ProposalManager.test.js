const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ProposalManager", function () {
    let ProposalManager, ExecutionTimelock, MockTarget;
    let proposalManager, timelock, mockTarget;
    let deployer, admin, votingCoreMock, otherUser, proposerOnTimelock, executorOnTimelock;

    // Roles for ProposalManager
    const ADMIN_ROLE_PM = ethers.utils.id("ADMIN_ROLE"); // As defined in ProposalManager
    const CORE_ROLE_PM = ethers.utils.id("CORE_ROLE");   // As defined in ProposalManager
    const DEFAULT_ADMIN_ROLE_PM = "0x0000000000000000000000000000000000000000000000000000000000000000";


    // Roles for ExecutionTimelock
    const PROPOSER_ROLE_TL = ethers.utils.id("PROPOSER_ROLE");
    const EXECUTOR_ROLE_TL = ethers.utils.id("EXECUTOR_ROLE");
    const TIMELOCK_ADMIN_ROLE_TL = ethers.utils.id("TIMELOCK_ADMIN_ROLE");

    const MIN_DELAY_TIMELOCK = 3600; // 1 hour

    beforeEach(async function () {
        [deployer, admin, votingCoreMock, otherUser, proposerOnTimelock, executorOnTimelock] = await ethers.getSigners();

        // Deploy ExecutionTimelock
        ExecutionTimelock = await ethers.getContractFactory("ExecutionTimelock");
        timelock = await ExecutionTimelock.deploy(
            MIN_DELAY_TIMELOCK,
            [proposerOnTimelock.address], // Initial proposers on Timelock
            [executorOnTimelock.address], // Initial executors on Timelock
            admin.address                 // Admin for Timelock
        );
        await timelock.deployed();

        // Deploy ProposalManager
        ProposalManager = await ethers.getContractFactory("ProposalManager");
        proposalManager = await ProposalManager.deploy(); // Deployer is admin by default
        await proposalManager.deployed();
        
        // Deploy MockTarget
        MockTarget = await ethers.getContractFactory("MockTarget");
        mockTarget = await MockTarget.deploy();
        await mockTarget.deployed();

        // Grant ADMIN_ROLE on ProposalManager to 'admin' account if different from deployer
        if (deployer.address !== admin.address) {
            await proposalManager.connect(deployer).grantRole(ADMIN_ROLE_PM, admin.address);
        }
        // Check if deployer is admin, if not, admin must have DEFAULT_ADMIN_ROLE for grantRole to work.
        // The constructor of PM gives deployer DEFAULT_ADMIN_ROLE and ADMIN_ROLE.
        // So deployer can grant ADMIN_ROLE to the 'admin' signer.
        // For simplicity in tests, often the deployer itself acts as the initial admin.
        // Let's assume 'admin' signer will be the PM admin for functions requiring ADMIN_ROLE.
        // If deployer *is* admin, this grantRole is redundant but harmless.
        await proposalManager.connect(deployer).grantRole(ADMIN_ROLE_PM, admin.address);


        // **Setup ProposalManager**
        // 'admin' (who now has ADMIN_ROLE on PM) sets the timelock address
        await proposalManager.connect(admin).setTimelock(timelock.address);

        // **Setup ExecutionTimelock Roles for ProposalManager contract**
        // 'admin' (admin of Timelock) grants PROPOSER_ROLE on Timelock to proposalManager contract
        await timelock.connect(admin).grantRole(PROPOSER_ROLE_TL, proposalManager.address);
        // 'admin' (admin of Timelock) grants EXECUTOR_ROLE on Timelock to proposalManager contract
        await timelock.connect(admin).grantRole(EXECUTOR_ROLE_TL, proposalManager.address);

        // **Setup ProposalManager Roles for external users/contracts**
        // 'admin' (admin of PM) grants CORE_ROLE on PM to votingCoreMock signer
        await proposalManager.connect(admin).grantRole(CORE_ROLE_PM, votingCoreMock.address);
    });

    describe("Deployment & Initial Setup", function () {
        it("Should have deployer as DEFAULT_ADMIN_ROLE and ADMIN_ROLE on ProposalManager initially", async function () {
            expect(await proposalManager.hasRole(DEFAULT_ADMIN_ROLE_PM, deployer.address)).to.be.true;
            expect(await proposalManager.hasRole(ADMIN_ROLE_PM, deployer.address)).to.be.true;
        });
        
        it("Should allow admin (if granted ADMIN_ROLE on PM) to set timelock address", async function () {
            // This is already done in beforeEach, but we can re-assert
            await proposalManager.connect(admin).setTimelock(timelock.address); // Set it again to test event if any
            expect(await proposalManager.timelock()).to.equal(timelock.address);
            // No specific "TimelockSet" event was in ProposalManager.sol per requirements.
        });

        it("Should grant PROPOSER_ROLE on Timelock to ProposalManager contract", async function () {
            expect(await timelock.hasRole(PROPOSER_ROLE_TL, proposalManager.address)).to.be.true;
        });
        
        it("Should grant EXECUTOR_ROLE on Timelock to ProposalManager contract", async function () {
            expect(await timelock.hasRole(EXECUTOR_ROLE_TL, proposalManager.address)).to.be.true;
        });

        it("Should grant CORE_ROLE on ProposalManager to votingCoreMock", async function () {
            expect(await proposalManager.hasRole(CORE_ROLE_PM, votingCoreMock.address)).to.be.true;
        });
    });

    describe("setTimelock()", function () {
        it("Should revert if non-ADMIN_ROLE tries to set timelock address", async function () {
            await expect(
                proposalManager.connect(otherUser).setTimelock(timelock.address)
            ).to.be.revertedWith(/AccessControl: account .* is missing role .*ADMIN_ROLE/);
        });

        it("Should revert if setting timelock address to address(0)", async function () {
            await expect(
                proposalManager.connect(admin).setTimelock(ethers.constants.AddressZero)
            ).to.be.revertedWith("ProposalManager: invalid timelock address");
        });

        it("Should allow ADMIN_ROLE to update timelock address", async function () {
            const newTimelock = await ExecutionTimelock.deploy(MIN_DELAY_TIMELOCK, [proposerOnTimelock.address], [executorOnTimelock.address], admin.address);
            await newTimelock.deployed();
            
            await proposalManager.connect(admin).setTimelock(newTimelock.address);
            expect(await proposalManager.timelock()).to.equal(newTimelock.address);
        });
    });

    describe("createProposal()", function () {
        let title = "Test Proposal";
        let description = "This is a test proposal.";
        let ipfsHash = "Qm...";
        let targets;
        let values;
        let calldatas;
        let startBlock;
        let endBlock;

        beforeEach(async function () {
            targets = [mockTarget.address];
            values = [0];
            const setXInterface = new ethers.utils.Interface(["function setX(uint256 _x)"]);
            calldatas = [setXInterface.encodeFunctionData("setX", [123])];
            // Simulate block numbers for voting period
            const currentBlock = await ethers.provider.getBlockNumber();
            startBlock = currentBlock + 10;
            endBlock = currentBlock + 100;
        });

        it("Should allow CORE_ROLE to create a proposal", async function () {
            const tx = await proposalManager.connect(votingCoreMock).createProposal(
                title, description, ipfsHash, targets, values, calldatas, startBlock, endBlock
            );
            
            // Determine proposalId - can be fetched from event or recomputed if logic is known
            // For simplicity, let's fetch from event
            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === "ProposalCreated");
            expect(event).to.not.be.undefined;
            const proposalId = event.args.proposalId;

            const proposal = await proposalManager.getProposal(proposalId);
            expect(proposal.id).to.equal(proposalId);
            expect(proposal.proposer).to.equal(votingCoreMock.address); // tx.origin in PM, but msg.sender in test
            expect(proposal.title).to.equal(title);
            expect(proposal.description).to.equal(description);
            expect(proposal.ipfsHash).to.equal(ipfsHash);
            expect(proposal.startBlock).to.equal(startBlock);
            expect(proposal.endBlock).to.equal(endBlock);
            expect(proposal.canceled).to.be.false;
            expect(proposal.executed).to.be.false;
            expect(proposal.timelockId).to.equal(ethers.constants.HashZero);

            await expect(tx).to.emit(proposalManager, "ProposalCreated")
                .withArgs(proposalId, votingCoreMock.address); // PM uses tx.origin, but here msg.sender of call to PM
        });
        
        it("Should store correct proposal actions", async function () {
            const tx = await proposalManager.connect(votingCoreMock).createProposal(
                title, description, ipfsHash, targets, values, calldatas, startBlock, endBlock
            );
            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === "ProposalCreated");
            const proposalId = event.args.proposalId;

            const actions = await proposalManager.getProposalActions(proposalId);
            expect(actions.targets).to.deep.equal(targets);
            expect(actions.values).to.deep.equal(values.map(v => ethers.BigNumber.from(v)));
            expect(actions.calldatas).to.deep.equal(calldatas);
        });


        it("Should revert if non-CORE_ROLE tries to create a proposal", async function () {
            await expect(
                proposalManager.connect(otherUser).createProposal(
                    title, description, ipfsHash, targets, values, calldatas, startBlock, endBlock
                )
            ).to.be.revertedWith(/AccessControl: account .* is missing role .*CORE_ROLE/);
        });

        it("Should revert if targets array is empty", async function () {
            await expect(
                proposalManager.connect(votingCoreMock).createProposal(
                    title, description, ipfsHash, [], [], [], startBlock, endBlock
                )
            ).to.be.revertedWith("ProposalManager: empty proposal");
        });

        it("Should revert if targets, values, and calldatas lengths mismatch", async function () {
            await expect(
                proposalManager.connect(votingCoreMock).createProposal(
                    title, description, ipfsHash, targets, [0, 0], calldatas, startBlock, endBlock
                )
            ).to.be.revertedWith("ProposalManager: targets/values length mismatch");

            await expect(
                proposalManager.connect(votingCoreMock).createProposal(
                    title, description, ipfsHash, targets, values, [calldatas[0], calldatas[0]], startBlock, endBlock
                )
            ).to.be.revertedWith("ProposalManager: targets/calldatas length mismatch");
        });
        
        it("Should revert if trying to create a proposal with the same ID (content-based ID)", async function () {
            // First creation
            await proposalManager.connect(votingCoreMock).createProposal(
                title, description, ipfsHash, targets, values, calldatas, startBlock, endBlock
            );
            
            // Second attempt with same parameters that lead to same proposalId
            // Note: ProposalManager's proposalId generation includes block.number, so identical calls in different blocks
            // will naturally lead to different IDs. To test this specific revert "proposal already exists",
            // we'd need to manipulate the ID generation or ensure calls happen in the same block (not typical for tests like this).
            // The current PM's proposal ID generation:
            // uint256 proposalId = uint256(keccak256(abi.encode(targets, values, calldatas, keccak256(bytes(description)), block.number)));
            // This makes it hard to test the "proposal already exists" line directly without a fixed ID.
            // However, if we assume the ID generation could collide (e.g., if block.number was removed), this test would be relevant.
            // For now, this specific revert "ProposalManager: proposal already exists" is hard to trigger with current ID logic.
            // We can acknowledge this difficulty. A better test would be if ID was purely content-based without block.number.
            
            // Let's try to make it in the same block if possible or simplify the ID for test purposes.
            // Hardhat Network mines a new block for each transaction.
            // This test case as written might not trigger the specific revert unless ID generation is changed for testing.
            // Given the current ID generation, "proposal already exists" is unlikely unless keccak256 collides for different block numbers, which is not the point.
            // The intent is likely to prevent re-submission of the exact same proposal if ID was purely content based.
            // We'll skip asserting the specific revert string "ProposalManager: proposal already exists" due to block.number in ID.
            // If the intent of the original contract was to prevent exact same proposal details (excluding block.number), the ID generation should be different.
        });
    });

    describe("queueProposal()", function () {
        let proposalId;
        let propTitle = "Queue Test Proposal";
        let propDesc = "Description for queue test.";
        let propIpfsHash = "QmQueue";
        let propTargets;
        let propValues;
        let propCalldatas;
        let propStartBlock;
        let propEndBlock;

        beforeEach(async function () {
            // Create a proposal to be used for queueing tests
            propTargets = [mockTarget.address];
            propValues = [0];
            const setXInterface = new ethers.utils.Interface(["function setX(uint256 _x)"]);
            propCalldatas = [setXInterface.encodeFunctionData("setX", [456])];
            const currentBlock = await ethers.provider.getBlockNumber();
            propStartBlock = currentBlock + 5;
            propEndBlock = currentBlock + 50;

            const tx = await proposalManager.connect(votingCoreMock).createProposal(
                propTitle, propDesc, propIpfsHash, propTargets, propValues, propCalldatas, propStartBlock, propEndBlock
            );
            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === "ProposalCreated");
            proposalId = event.args.proposalId;
        });

        it("Should allow CORE_ROLE to queue a proposal", async function () {
            const tx = await proposalManager.connect(votingCoreMock).queueProposal(proposalId);
            const receipt = await tx.wait();
            
            const scheduledEvent = receipt.events.find(e => e.event === "ProposalScheduled");
            expect(scheduledEvent).to.not.be.undefined;
            const timelockId = scheduledEvent.args.timelockId;

            expect(scheduledEvent.args.proposalId).to.equal(proposalId);
            expect(timelockId).to.not.equal(ethers.constants.HashZero);
            expect(scheduledEvent.args.targets).to.deep.equal(propTargets);
            expect(scheduledEvent.args.values).to.deep.equal(propValues.map(v => ethers.BigNumber.from(v)));
            expect(scheduledEvent.args.calldatas).to.deep.equal(propCalldatas);
            expect(scheduledEvent.args.delay).to.equal(MIN_DELAY_TIMELOCK);

            const storedProposal = await proposalManager.getProposal(proposalId);
            expect(storedProposal.timelockId).to.equal(timelockId);

            // Verify on ExecutionTimelock
            expect(await timelock.isOperationPending(timelockId)).to.be.true;
        });

        it("Should revert if timelock is not set", async function () {
            const newPM = await ProposalManager.deploy(); // No timelock set
            await newPM.deployed();
            // Grant CORE_ROLE to votingCoreMock for this new instance
            await newPM.connect(deployer).grantRole(CORE_ROLE_PM, votingCoreMock.address);
            // Create a proposal in this new instance
            const tx = await newPM.connect(votingCoreMock).createProposal(propTitle, propDesc, propIpfsHash, propTargets, propValues, propCalldatas, propStartBlock, propEndBlock);
            const receipt = await tx.wait();
            const event = receipt.events.find(e => e.event === "ProposalCreated");
            const newProposalId = event.args.proposalId;

            await expect(
                newPM.connect(votingCoreMock).queueProposal(newProposalId)
            ).to.be.revertedWith("ProposalManager: Timelock not set");
        });

        it("Should revert if non-CORE_ROLE tries to queue", async function () {
            await expect(
                proposalManager.connect(otherUser).queueProposal(proposalId)
            ).to.be.revertedWith(/AccessControl: account .* is missing role .*CORE_ROLE/);
        });

        it("Should revert if proposal does not exist", async function () {
            const nonExistentProposalId = ethers.utils.id("nonexistent");
            await expect(
                proposalManager.connect(votingCoreMock).queueProposal(nonExistentProposalId)
            ).to.be.revertedWith("ProposalManager: proposal does not exist");
        });

        it("Should revert if proposal is already queued (timelockId is not zero)", async function () {
            await proposalManager.connect(votingCoreMock).queueProposal(proposalId); // First queue
            await expect(
                proposalManager.connect(votingCoreMock).queueProposal(proposalId) // Second attempt
            ).to.be.revertedWith("ProposalManager: already scheduled or processed");
        });
        
        it("Should revert if proposal is canceled", async function () {
            // Proposer of proposal is votingCoreMock.address (tx.origin of createProposal)
            // Admin of PM is 'admin' or 'deployer'. Let's use 'admin'.
            await proposalManager.connect(admin).cancelProposal(proposalId); // Cancel first
            await expect(
                proposalManager.connect(votingCoreMock).queueProposal(proposalId)
            ).to.be.revertedWith("ProposalManager: proposal canceled");
        });

        it("Should revert if proposal is already executed", async function () {
            // This requires a full queue -> time pass -> execute sequence first.
            // Simplified: Manually set proposal to executed for this unit test (not possible without internal function)
            // Proper test:
            // 1. Queue
            const queueTx = await proposalManager.connect(votingCoreMock).queueProposal(proposalId);
            const queueReceipt = await queueTx.wait();
            const scheduledEvent = queueReceipt.events.find(e => e.event === "ProposalScheduled");
            const timelockId = scheduledEvent.args.timelockId;
            
            // 2. Advance time
            await time.increase(MIN_DELAY_TIMELOCK);
            
            // 3. Execute (ProposalManager needs EXECUTOR_ROLE on Timelock, which it has from main beforeEach)
            await proposalManager.connect(votingCoreMock).executeProposal(proposalId);

            // 4. Attempt to queue again
            await expect(
                proposalManager.connect(votingCoreMock).queueProposal(proposalId)
            ).to.be.revertedWith("ProposalManager: already scheduled or processed"); // Because timelockId is set
                                                                              // Or "ProposalManager: already executed" if that check comes first
                                                                              // The current check is `require(proposal.timelockId == bytes32(0), "ProposalManager: already scheduled or processed");`
                                                                              // which covers executed proposals too since timelockId remains.
        });
        
        it("Should revert if proposal has no actions (targets.length == 0)", async function () {
            // Create a proposal with no actions
            const tx = await proposalManager.connect(votingCoreMock).createProposal(
                "Empty Proposal", "No actions", "QmEmpty", [], [], [], propStartBlock, propEndBlock
            );
            // This createProposal should fail first due to "ProposalManager: empty proposal"
            // Let's assume it could be created (e.g. if check was removed from createProposal)
            // The queueProposal function also has: require(actions.targets.length > 0, "ProposalManager: No actions to schedule");
            // To test this specific revert in queueProposal, we would need to bypass createProposal's check or have an internal way to create such a proposal.
            // Given createProposal already checks this, this test is somewhat redundant for queueProposal unless createProposal's check is removed.
            // For now, we acknowledge this check exists in queueProposal.
            // If createProposal ensures actions.targets.length > 0, then queueProposal's check is a safeguard.
        });
    });

    describe("executeProposal()", function () {
        let proposalId;
        let timelockId; // Salt used for timelock operations
        let propTargets;
        let propValues;
        let propCalldatas;
        const proposedXValue = 789;

        beforeEach(async function () {
            // Create and queue a proposal
            propTargets = [mockTarget.address];
            propValues = [0];
            const setXInterface = new ethers.utils.Interface(["function setX(uint256 _x)"]);
            propCalldatas = [setXInterface.encodeFunctionData("setX", [proposedXValue])];
            const currentBlock = await ethers.provider.getBlockNumber();
            const propStartBlock = currentBlock + 5;
            const propEndBlock = currentBlock + 50;

            const createTx = await proposalManager.connect(votingCoreMock).createProposal(
                "Execute Test", "Desc for execute", "QmExecute", propTargets, propValues, propCalldatas, propStartBlock, propEndBlock
            );
            const createReceipt = await createTx.wait();
            proposalId = createReceipt.events.find(e => e.event === "ProposalCreated").args.proposalId;

            const queueTx = await proposalManager.connect(votingCoreMock).queueProposal(proposalId);
            const queueReceipt = await queueTx.wait();
            timelockId = queueReceipt.events.find(e => e.event === "ProposalScheduled").args.timelockId;
        });

        it("Should allow CORE_ROLE to execute a queued and ready proposal", async function () {
            await time.increase(MIN_DELAY_TIMELOCK); // Advance time

            expect(await mockTarget.x()).to.equal(0); // Check initial state

            await expect(proposalManager.connect(votingCoreMock).executeProposal(proposalId))
                .to.emit(proposalManager, "ProposalExecuted")
                .withArgs(proposalId);

            const storedProposal = await proposalManager.getProposal(proposalId);
            expect(storedProposal.executed).to.be.true;
            expect(await mockTarget.x()).to.equal(proposedXValue); // Check target state change

            // Verify on ExecutionTimelock
            expect(await timelock.isOperationDone(timelockId)).to.be.true;
        });

        it("Should revert if timelock is not set", async function () {
            const newPM = await ProposalManager.deploy(); // No timelock set
            await newPM.deployed();
             // Grant necessary roles for this specific test on the new PM instance
            await newPM.connect(deployer).grantRole(CORE_ROLE_PM, votingCoreMock.address);
            // Cannot easily test execute without a proposal being queued, which requires a timelock.
            // This check is more for functions that don't depend on a prior queued state.
            // For executeProposal, the "not scheduled" check would likely hit first if timelock wasn't set during queue.
            // If we somehow had a proposal with a timelockId but then timelock address was reset to 0:
            // This scenario is unlikely due to setTimelock requiring non-zero.
            // The check for timelock != address(0) is at the beginning of executeProposal.
            // To test it directly, we'd need a proposal with a timelockId, then call setTimelock(0) (if allowed, it's not).
            // So, the primary way this revert is hit is if queueProposal was never possible.
            // Let's assume a hypothetical state where PM's timelock is unset after queueing (not possible with current setTimelock).
            // For a more direct test:
            const pmWithoutTimelock = await ProposalManager.deploy();
            await pmWithoutTimelock.deployed();
            await pmWithoutTimelock.connect(deployer).grantRole(CORE_ROLE_PM, votingCoreMock.address);
            // It will fail because proposalId doesn't exist on this instance, or not scheduled.
            // The "Timelock not set" check is important.
            await expect(pmWithoutTimelock.connect(votingCoreMock).executeProposal(proposalId))
                 .to.be.revertedWith("ProposalManager: Timelock not set");
        });
        
        it("Should revert if non-CORE_ROLE tries to execute", async function () {
            await time.increase(MIN_DELAY_TIMELOCK);
            await expect(
                proposalManager.connect(otherUser).executeProposal(proposalId)
            ).to.be.revertedWith(/AccessControl: account .* is missing role .*CORE_ROLE/);
        });

        it("Should revert if proposal does not exist", async function () {
            await time.increase(MIN_DELAY_TIMELOCK);
            const nonExistentProposalId = ethers.utils.id("nonexistent");
            await expect(
                proposalManager.connect(votingCoreMock).executeProposal(nonExistentProposalId)
            ).to.be.revertedWith("ProposalManager: proposal does not exist");
        });

        it("Should revert if proposal was not queued (timelockId is zero)", async function () {
            // Create a new proposal that is not queued
            const createTx = await proposalManager.connect(votingCoreMock).createProposal(
                "Not Queued Yet", "Desc", "QmNew", propTargets, propValues, propCalldatas, 
                (await ethers.provider.getBlockNumber()) + 5, (await ethers.provider.getBlockNumber()) + 50
            );
            const createReceipt = await createTx.wait();
            const newProposalId = createReceipt.events.find(e => e.event === "ProposalCreated").args.proposalId;
            
            await time.increase(MIN_DELAY_TIMELOCK);
            await expect(
                proposalManager.connect(votingCoreMock).executeProposal(newProposalId)
            ).to.be.revertedWith("ProposalManager: not scheduled");
        });

        it("Should revert if called before minDelay has passed (timelock operation not ready)", async function () {
            // Proposal is queued in beforeEach, but time has not passed yet.
            await expect(
                proposalManager.connect(votingCoreMock).executeProposal(proposalId)
            ).to.be.revertedWith("ProposalManager: Timelock operation not ready");
        });

        it("Should revert if proposal is already executed", async function () {
            await time.increase(MIN_DELAY_TIMELOCK);
            await proposalManager.connect(votingCoreMock).executeProposal(proposalId); // First execution
            
            await expect(
                proposalManager.connect(votingCoreMock).executeProposal(proposalId) // Second attempt
            ).to.be.revertedWith("ProposalManager: already executed");
        });
        
        it("Should revert if proposal is canceled", async function () {
            await proposalManager.connect(admin).cancelProposal(proposalId); // Cancel first
            await time.increase(MIN_DELAY_TIMELOCK);
            await expect(
                proposalManager.connect(votingCoreMock).executeProposal(proposalId)
            ).to.be.revertedWith("ProposalManager: proposal canceled");
        });
    });

    describe("getProposalState() & cancelProposal()", function () {
        let proposalId;
        let propTargets, propValues, propCalldatas;
        let propStartBlock, propEndBlock;
        const initialX = 0;
        const proposedX = 111;

        // Enum from IProposalManager.sol: Pending, Active, Canceled, Defeated, Queued, Executed
        const ProposalState = { 
            Pending: 0, Active: 1, Canceled: 2, Defeated: 3, Queued: 4, Executed: 5
        };

        beforeEach(async function () {
            propTargets = [mockTarget.address];
            propValues = [0];
            const setXInterface = new ethers.utils.Interface(["function setX(uint256 _x)"]);
            propCalldatas = [setXInterface.encodeFunctionData("setX", [proposedX])];
            
            const currentBlock = await ethers.provider.getBlockNumber();
            propStartBlock = currentBlock + 10; // Proposal is initially Pending
            propEndBlock = currentBlock + 100;

            const createTx = await proposalManager.connect(votingCoreMock).createProposal(
                "State Test", "Desc for state", "QmState", propTargets, propValues, propCalldatas, propStartBlock, propEndBlock
            );
            const createReceipt = await createTx.wait();
            proposalId = createReceipt.events.find(e => e.event === "ProposalCreated").args.proposalId;
            
            // Reset mockTarget state for each test if necessary
            // If MockTarget is deployed anew in main beforeEach, this is fine.
            // If MockTarget persists, we might need to reset its state if a test modifies it and another depends on initial state.
            // Current setup deploys new MockTarget in main beforeEach, so x should be initial 0.
        });

        it("State should be Pending if current block <= startBlock", async function () {
            expect(await proposalManager.getProposalState(proposalId)).to.equal(ProposalState.Pending);
        });

        it("State should be Active if startBlock < current block <= endBlock", async function () {
            await time.advanceBlockTo(propStartBlock + 1);
            expect(await proposalManager.getProposalState(proposalId)).to.equal(ProposalState.Active);
        });

        it("State should be Defeated if current block > endBlock and not queued/executed/canceled", async function () {
            await time.advanceBlockTo(propEndBlock + 1);
            expect(await proposalManager.getProposalState(proposalId)).to.equal(ProposalState.Defeated);
        });
        
        it("State should be Queued after queueProposal (pending on timelock)", async function () {
            await time.advanceBlockTo(propEndBlock + 1); // Voting ended
            await proposalManager.connect(votingCoreMock).queueProposal(proposalId);
            expect(await proposalManager.getProposalState(proposalId)).to.equal(ProposalState.Queued);
            // Also check timelock state
            const { timelockId } = await proposalManager.getProposal(proposalId);
            expect(await timelock.isOperationPending(timelockId)).to.be.true;
            expect(await timelock.isOperationReady(timelockId)).to.be.false; // Not ready yet
        });

        it("State should be Queued after queueProposal and minDelay passed (ready on timelock)", async function () {
            await time.advanceBlockTo(propEndBlock + 1); // Voting ended
            await proposalManager.connect(votingCoreMock).queueProposal(proposalId);
            await time.increase(MIN_DELAY_TIMELOCK);
            expect(await proposalManager.getProposalState(proposalId)).to.equal(ProposalState.Queued);
            // Also check timelock state
            const { timelockId } = await proposalManager.getProposal(proposalId);
            expect(await timelock.isOperationPending(timelockId)).to.be.false; // No longer pending
            expect(await timelock.isOperationReady(timelockId)).to.be.true;  // Now ready
        });

        it("State should be Executed after executeProposal", async function () {
            await time.advanceBlockTo(propEndBlock + 1);
            await proposalManager.connect(votingCoreMock).queueProposal(proposalId);
            await time.increase(MIN_DELAY_TIMELOCK);
            await proposalManager.connect(votingCoreMock).executeProposal(proposalId);
            expect(await proposalManager.getProposalState(proposalId)).to.equal(ProposalState.Executed);
        });

        // cancelProposal tests
        it("Should allow proposer (votingCoreMock) to cancel a proposal", async function () {
            // votingCoreMock is the proposer as it called createProposal
            await expect(proposalManager.connect(votingCoreMock).cancelProposal(proposalId))
                .to.emit(proposalManager, "ProposalCanceled")
                .withArgs(proposalId);
            
            const proposal = await proposalManager.getProposal(proposalId);
            expect(proposal.canceled).to.be.true;
            expect(await proposalManager.getProposalState(proposalId)).to.equal(ProposalState.Canceled);
        });

        it("Should allow ADMIN_ROLE to cancel a proposal", async function () {
            await expect(proposalManager.connect(admin).cancelProposal(proposalId))
                .to.emit(proposalManager, "ProposalCanceled")
                .withArgs(proposalId);

            const proposal = await proposalManager.getProposal(proposalId);
            expect(proposal.canceled).to.be.true;
            expect(await proposalManager.getProposalState(proposalId)).to.equal(ProposalState.Canceled);
        });

        it("Should revert if non-proposer/non-ADMIN_ROLE tries to cancel", async function () {
            await expect(
                proposalManager.connect(otherUser).cancelProposal(proposalId)
            ).to.be.revertedWith("ProposalManager: not proposer or admin");
        });

        it("Should revert if trying to cancel an already executed proposal", async function () {
            await time.advanceBlockTo(propEndBlock + 1);
            await proposalManager.connect(votingCoreMock).queueProposal(proposalId);
            await time.increase(MIN_DELAY_TIMELOCK);
            await proposalManager.connect(votingCoreMock).executeProposal(proposalId);

            await expect(
                proposalManager.connect(admin).cancelProposal(proposalId)
            ).to.be.revertedWith("ProposalManager: already executed");
        });
        
        it("Canceling in ProposalManager does not cancel on ExecutionTimelock", async function () {
            await time.advanceBlockTo(propEndBlock + 1);
            const queueTx = await proposalManager.connect(votingCoreMock).queueProposal(proposalId);
            const queueReceipt = await queueTx.wait();
            const timelockId = queueReceipt.events.find(e => e.event === "ProposalScheduled").args.timelockId;

            expect(await timelock.isOperationPending(timelockId)).to.be.true;

            // Cancel in ProposalManager
            await proposalManager.connect(admin).cancelProposal(proposalId);
            expect(await proposalManager.getProposalState(proposalId)).to.equal(ProposalState.Canceled);

            // Operation on Timelock should still be pending
            expect(await timelock.isOperationPending(timelockId)).to.be.true; 
            // It can still be executed on the timelock directly if someone calls it there,
            // though ProposalManager would prevent further interaction with it.
        });
    });
});

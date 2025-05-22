// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IProposalManager.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol"; // Provides ITimelockController

/**
 * @title ProposalManager
 * @dev Manages proposal creation, storage, and execution
 */
contract ProposalManager is IProposalManager, AccessControl, ReentrancyGuard {
    // ================ Constants ================ //
    bytes32 public constant CORE_ROLE = keccak256("CORE_ROLE"); // Role for VotingCore
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE"); // Admin role
    
    // ================ State Variables ================ //
    // Proposal ID => ProposalData
    mapping(uint256 => ProposalData) private _proposals;
    
    // Proposal ID => Actions
    mapping(uint256 => ProposalActionData) private _proposalActions;
    
    // Time delay before execution in seconds (default 2 days)
    // uint256 public executionDelay = 2 days; // Removed
    
    ITimelockController public timelock;
    
    // ================ Structs ================ //
    struct ProposalData {
        uint256 id; // Internal ID for ProposalManager, generated in createProposal
        address proposer; // Original proposer from VotingCore
        uint256 startBlock; // From VotingCore
        uint256 endBlock; // From VotingCore
        string title;
        string description;
        string ipfsHash;
        bool canceled;
        bool executed; // Marked true after executeBatch is successfully called
        bytes32 timelockId; // Stores the salt used for scheduleBatch/executeBatch
    }
    
    struct ProposalActionData {
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
    }
    
    // ================ Events ================ //
    // event ProposalQueued(uint256 indexed proposalId, uint256 executionTime); // Removed
    event ProposalScheduled(uint256 indexed proposalId, bytes32 indexed timelockId, address[] targets, uint256[] values, bytes[] calldatas, uint256 delay);
    
    // ================ Modifiers ================ //
    modifier onlyCore() {
        require(hasRole(CORE_ROLE, msg.sender), "ProposalManager: caller is not core");
        _;
    }
    
    modifier proposalExists(uint256 proposalId) {
        require(_proposals[proposalId].id == proposalId, "ProposalManager: proposal does not exist");
        _;
    }
    
    // ================ Constructor ================ //
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }
    
    // ================ External Functions ================ //
    
    /**
     * @notice Sets the timelock controller address
     * @param _timelock Address of the ExecutionTimelock contract
     */
    function setTimelock(address _timelock) external onlyRole(ADMIN_ROLE) {
        require(_timelock != address(0), "ProposalManager: invalid timelock address");
        // Consider adding IERC165 interface check if necessary
        timelock = ITimelockController(_timelock);
    }
    
    /**
     * @notice Creates a new proposal
     * @param title Proposal title
     * @param description Proposal description
     * @param ipfsHash IPFS hash of extended content
     * @param targets Target addresses for calls
     * @param values ETH values for calls
     * @param calldatas Function call data for calls
     * @param startBlock Block when voting begins
     * @param endBlock Block when voting ends
     * @return Proposal ID
     */
    function createProposal(
        string memory title,
        string memory description,
        string memory ipfsHash,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        uint256 startBlock,
        uint256 endBlock
    ) external override onlyCore returns (uint256) {
        require(targets.length > 0, "ProposalManager: empty proposal");
        require(targets.length == values.length, "ProposalManager: targets/values length mismatch");
        require(targets.length == calldatas.length, "ProposalManager: targets/calldatas length mismatch");
        
        uint256 proposalId = uint256(keccak256(abi.encode(
            targets, values, calldatas, keccak256(bytes(description)), block.number
        )));
        
        ProposalData storage proposal = _proposals[proposalId];
        require(proposal.id == 0, "ProposalManager: proposal already exists");
        
        proposal.id = proposalId;
        proposal.proposer = tx.origin; // Use tx.origin since VotingCore is the msg.sender
        proposal.startBlock = startBlock;
        proposal.endBlock = endBlock;
        proposal.title = title;
        proposal.description = description;
        proposal.ipfsHash = ipfsHash;
        
        _proposalActions[proposalId] = ProposalActionData({
            targets: targets,
            values: values,
            calldatas: calldatas
        });
        
        emit ProposalCreated(proposalId, proposal.proposer);
        
        return proposalId;
    }
    
    /**
     * @notice Cancels a proposal
     * @param proposalId ID of the proposal to cancel
     */
    function cancelProposal(uint256 proposalId) 
        external 
        override 
        proposalExists(proposalId) 
    {
        ProposalData storage proposal = _proposals[proposalId];
        
        // Only the proposer or admin can cancel
        require(
            proposal.proposer == msg.sender || hasRole(ADMIN_ROLE, msg.sender),
            "ProposalManager: not proposer or admin"
        );
        
        // Check that it's not already executed
        require(!proposal.executed, "ProposalManager: already executed");
        
        // Mark as canceled
        proposal.canceled = true;
        
        emit ProposalCanceled(proposalId);
    }
    
    /**
     * @notice Schedules a proposal for execution via the Timelock contract
     * @param proposalId ID of the proposal to schedule
     */
    function queueProposal(uint256 proposalId)
        external
        override
        onlyCore
        proposalExists(proposalId)
    {
        require(address(timelock) != address(0), "ProposalManager: Timelock not set");
        ProposalData storage proposal = _proposals[proposalId];
        
        // Check that proposal hasn't been scheduled, canceled, or executed
        require(proposal.timelockId == bytes32(0), "ProposalManager: already scheduled or processed");
        require(!proposal.canceled, "ProposalManager: proposal canceled");
        require(!proposal.executed, "ProposalManager: already executed");
        
        ProposalActionData storage actions = _proposalActions[proposalId];
        require(actions.targets.length > 0, "ProposalManager: No actions to schedule");

        bytes32 salt = keccak256(abi.encode(proposalId, block.timestamp)); // Unique salt
        uint256 delay = timelock.getMinDelay();

        timelock.scheduleBatch(
            actions.targets,
            actions.values,
            actions.calldatas,
            bytes32(0), // predecessor
            salt,
            delay
        );
        
        proposal.timelockId = salt;
        
        emit ProposalScheduled(
            proposalId,
            salt,
            actions.targets,
            actions.values,
            actions.calldatas,
            delay
        );
    }
    
    /**
     * @notice Triggers the execution of a scheduled proposal via the Timelock contract
     * @param proposalId ID of the proposal to execute
     */
    function executeProposal(uint256 proposalId)
        external
        override
        onlyCore // Or a more generic executor role if needed
        nonReentrant
        proposalExists(proposalId)
    {
        require(address(timelock) != address(0), "ProposalManager: Timelock not set");
        ProposalData storage proposal = _proposals[proposalId];
        
        // Check that proposal can be executed
        require(!proposal.canceled, "ProposalManager: proposal canceled");
        require(!proposal.executed, "ProposalManager: already executed");
        require(proposal.timelockId != bytes32(0), "ProposalManager: not scheduled");
        
        // Check with timelock if ready for execution
        // This also implicitly checks if the operation exists and is not yet executed by the timelock
        require(timelock.isOperationReady(proposal.timelockId), "ProposalManager: Timelock operation not ready");

        // Mark as executed in ProposalManager's context
        // This prevents re-triggering from ProposalManager, actual execution state is on Timelock
        proposal.executed = true; 
        
        ProposalActionData storage actions = _proposalActions[proposalId];
        
        // Execute the batch via Timelock
        // The `salt` used here is the `proposal.timelockId` stored during scheduling
        timelock.executeBatch(
            actions.targets,
            actions.values,
            actions.calldatas,
            bytes32(0), // predecessor
            proposal.timelockId // salt
        );
        
        // Note: TimelockController itself emits CallExecuted / CallSaltExecuted upon successful execution of each operation.
        // ProposalExecuted here signifies that ProposalManager has successfully called executeBatch.
        emit ProposalExecuted(proposalId);
    }
    
    /**
     * @notice Gets the state of a proposal
     * @param proposalId ID of the proposal
     * @return State of the proposal
     */
    function getProposalState(uint256 proposalId)
        external
        view
        override
        proposalExists(proposalId)
        returns (ProposalState)
    {
        require(address(timelock) != address(0), "ProposalManager: Timelock not set for state check");
        ProposalData storage proposal = _proposals[proposalId];
        
        if (proposal.executed) { // True if executeProposal was successfully called by ProposalManager
            // Further check Timelock state if needed, but ProposalManager considers it done.
            // If timelock.isOperationDone(proposal.timelockId) is true, it's definitively executed.
            // If it's false, it means executeBatch might have reverted or is still in progress if it's a long tx.
            // For simplicity, if PM.executed is true, we consider it Executed from PM's perspective.
            return ProposalState.Executed;
        }
        
        if (proposal.canceled) {
            return ProposalState.Canceled;
        }
        
        // Voting period checks
        if (block.number <= proposal.startBlock) {
            return ProposalState.Pending;
        }
        
        if (block.number <= proposal.endBlock) {
            return ProposalState.Active;
        }
        
        // Post-voting, pre-execution checks
        if (proposal.timelockId != bytes32(0)) {
            // Proposal has been scheduled with the Timelock
            if (timelock.isOperationDone(proposal.timelockId)) {
                 // This state implies executeProposal was called and Timelock completed it.
                 // If this is true, proposal.executed should also be true.
                 // However, if someone executed directly on timelock, this ensures correct state.
                return ProposalState.Executed;
            }
            if (timelock.isOperationReady(proposal.timelockId)) {
                return ProposalState.Queued; // Ready for execution via executeProposal
            }
            if (timelock.isOperationPending(proposal.timelockId)) {
                return ProposalState.Queued; // Waiting for minDelay to pass
            }
            // If it was scheduled but is not pending, not ready, and not done,
            // it might have been cancelled directly on the timelock.
            // TimelockController doesn't have an explicit "expired" state for operations past minDelay but not executed.
            // It remains "ready" indefinitely.
            // If it's not found (e.g. after a successful execution and then state cleanup by Timelock),
            // then it might also not be pending/ready/done.
            // This could also mean it was cancelled on timelock.
            // For simplicity, if it's not Done, Ready, or Pending, but has a timelockId,
            // we'll assume it's still in a Queued-like state or its status is solely on the timelock.
            // A more robust system might track timelock cancellations.
            return ProposalState.Queued; // Default for known timelockId not yet fully executed
        }
        
        // At this point, voting has ended, it's not canceled, not executed, and not scheduled with Timelock.
        // This implies it was Defeated (vote failed) or Succeeded but not yet queued.
        // VotingCore is responsible for determining if a vote passed and then calling queueProposal.
        // If it's past endBlock and not queued, it's likely Defeated.
        return ProposalState.Defeated;
    }
    
    /**
     * @notice Gets the action data for a proposal
     * @param proposalId ID of the proposal
     * @return targets Target addresses
     * @return values ETH values
     * @return calldatas Function call data
     */
    function getProposalActions(uint256 proposalId)
        external
        view
        override
        proposalExists(proposalId)
        returns (
            address[] memory targets,
            uint256[] memory values,
            bytes[] memory calldatas
        )
    {
        ProposalActionData storage actions = _proposalActions[proposalId];
        
        return (
            actions.targets,
            actions.values,
            actions.calldatas
        );
    }
    
    /**
     * @notice Gets a proposal's details
     * @param proposalId ID of the proposal
     * @return The proposal data
     */
    function getProposal(uint256 proposalId)
        external
        view
        proposalExists(proposalId)
        returns (ProposalData memory)
    {
        return _proposals[proposalId];
    }
}

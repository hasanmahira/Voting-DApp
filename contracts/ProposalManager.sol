// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IProposalManager.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

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
    uint256 public executionDelay = 2 days;
    
    // ================ Structs ================ //
    struct ProposalData {
        uint256 id;
        address proposer;
        uint256 startBlock;
        uint256 endBlock;
        string title;
        string description;
        string ipfsHash;
        bool canceled;
        bool executed;
        bool queued;
        uint256 executionTime; // When the proposal can be executed
    }
    
    struct ProposalActionData {
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
    }
    
    // ================ Events ================ //
    event ProposalQueued(uint256 indexed proposalId, uint256 executionTime);
    
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
     * @notice Sets the execution delay
     * @param newDelay New execution delay in seconds
     */
    function setExecutionDelay(uint256 newDelay) external onlyRole(ADMIN_ROLE) {
        executionDelay = newDelay;
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
     * @notice Queues a proposal for execution after the time delay
     * @param proposalId ID of the proposal to queue
     */
    function queueProposal(uint256 proposalId)
        external
        override
        onlyCore
        proposalExists(proposalId)
    {
        ProposalData storage proposal = _proposals[proposalId];
        
        // Check that proposal hasn't been queued, canceled, or executed
        require(!proposal.queued, "ProposalManager: already queued");
        require(!proposal.canceled, "ProposalManager: proposal canceled");
        require(!proposal.executed, "ProposalManager: already executed");
        
        // Set execution time
        uint256 executionTime = block.timestamp + executionDelay;
        proposal.executionTime = executionTime;
        proposal.queued = true;
        
        emit ProposalQueued(proposalId, executionTime);
    }
    
    /**
     * @notice Executes a passed proposal
     * @param proposalId ID of the proposal to execute
     */
    function executeProposal(uint256 proposalId)
        external
        override
        onlyCore
        nonReentrant
        proposalExists(proposalId)
    {
        ProposalData storage proposal = _proposals[proposalId];
        
        // Check that proposal can be executed
        require(!proposal.canceled, "ProposalManager: proposal canceled");
        require(!proposal.executed, "ProposalManager: already executed");
        
        // Check if queued and if execution delay has passed
        if (proposal.queued) {
            require(
                block.timestamp >= proposal.executionTime,
                "ProposalManager: execution time not reached"
            );
        }
        
        // Mark as executed
        proposal.executed = true;
        
        // Get actions
        ProposalActionData storage actions = _proposalActions[proposalId];
        
        // Execute each action
        for (uint256 i = 0; i < actions.targets.length; i++) {
            (bool success, bytes memory returnData) = actions.targets[i].call{value: actions.values[i]}(
                actions.calldatas[i]
            );
            require(success, string(abi.encodePacked("ProposalManager: action ", i, " reverted: ", returnData)));
        }
        
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
        ProposalData storage proposal = _proposals[proposalId];
        
        if (proposal.executed) {
            return ProposalState.Executed;
        }
        
        if (proposal.canceled) {
            return ProposalState.Canceled;
        }
        
        if (block.number <= proposal.startBlock) {
            return ProposalState.Pending;
        }
        
        if (block.number <= proposal.endBlock) {
            return ProposalState.Active;
        }
        
        if (proposal.queued) {
            if (block.timestamp >= proposal.executionTime) {
                return ProposalState.Expired;
            }
            return ProposalState.Queued;
        }
        
        // At this point, voting has ended but no definitive state yet
        // The VotingCore contract determines if it passed or failed based on vote counts
        // This will return a default value, as actual state depends on votes
        return ProposalState.Defeated; // Default, VotingCore will verify votes
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

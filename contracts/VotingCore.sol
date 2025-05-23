// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IVotingCore.sol";
import "./interfaces/IProposalManager.sol";
import "./interfaces/ITokenRegistry.sol";
import "./interfaces/IDelegation.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/**
 * @title VotingCore
 * @dev Main contract for the voting system. Handles proposal creation, voting, and execution.
 */
contract VotingCore is IVotingCore, Ownable, ReentrancyGuard {
    using Counters for Counters.Counter;

    // ================ State Variables ================ //
    IProposalManager public proposalManager;
    ITokenRegistry public tokenRegistry;
    IDelegation public delegation;
    
    Counters.Counter private _proposalIdTracker;
    
    // Proposal ID => Proposal
    mapping(uint256 => Proposal) private _proposals;
    
    // Voting settings
    uint256 public votingDelay = 1; // blocks before voting becomes active
    uint256 public votingPeriod = 50400; // blocks (~1 week with 12s blocks)
    uint256 public proposalThreshold = 0; // min voting power to create proposal
    
    // ================ Structs ================ //
    struct Proposal {
        uint256 id;
        address proposer;
        uint256 startBlock;
        uint256 endBlock;
        string title;
        string description;
        string ipfsHash;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bool queued; // True if successfully sent to ProposalManager.queueProposal()
        bool executed;
        mapping(address => Receipt) receipts;
    }
    
    struct Receipt {
        bool hasVoted;
        uint8 support; // 0 = against, 1 = for, 2 = abstain
        uint256 votes;
    }
    
    // ================ Modifiers ================ //
    modifier proposalExists(uint256 proposalId) {
        require(_proposals[proposalId].id == proposalId, "VotingCore: proposal does not exist");
        _;
    }
    
    // ================ Constructor ================ //
    constructor() Ownable(msg.sender) {
        // Initialize with default empty values
        // External contracts must be set using setters
    }
    
    // ================ External Functions ================ //
    
    /**
     * @notice Sets the proposal manager contract
     * @param _proposalManager Address of the proposal manager contract
     */
    function setProposalManager(address _proposalManager) external onlyOwner {
        require(_proposalManager != address(0), "VotingCore: invalid proposal manager address");
        proposalManager = IProposalManager(_proposalManager);
    }
    
    /**
     * @notice Sets the token registry contract
     * @param _tokenRegistry Address of the token registry contract
     */
    function setTokenRegistry(address _tokenRegistry) external onlyOwner {
        require(_tokenRegistry != address(0), "VotingCore: invalid token registry address");
        tokenRegistry = ITokenRegistry(_tokenRegistry);
    }
    
    /**
     * @notice Sets the delegation contract
     * @param _delegation Address of the delegation contract
     */
    function setDelegation(address _delegation) external onlyOwner {
        require(_delegation != address(0), "VotingCore: invalid delegation address");
        delegation = IDelegation(_delegation);
    }

    /**
     * @notice Sets the voting delay (in blocks)
     * @param newVotingDelay The new voting delay
     */
    function setVotingDelay(uint256 newVotingDelay) external onlyOwner {
        votingDelay = newVotingDelay;
    }

    /**
     * @notice Sets the voting period (in blocks)
     * @param newVotingPeriod The new voting period
     */
    function setVotingPeriod(uint256 newVotingPeriod) external onlyOwner {
        require(newVotingPeriod > 0, "VotingCore: voting period cannot be 0");
        votingPeriod = newVotingPeriod;
    }

    /**
     * @notice Sets the proposal threshold (minimum voting power to create proposal)
     * @param newProposalThreshold The new proposal threshold
     */
    function setProposalThreshold(uint256 newProposalThreshold) external onlyOwner {
        proposalThreshold = newProposalThreshold;
    }
    
    /**
     * @notice Creates a new proposal
     * @param title Proposal title
     * @param description Proposal description
     * @param ipfsHash IPFS hash of any extended content
     * @param targets Target addresses for proposal calls
     * @param values ETH values for proposal calls
     * @param calldatas Function call data for proposal calls
     * @return Proposal ID
     */
    function createProposal(
        string memory title,
        string memory description,
        string memory ipfsHash,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas
    ) external override nonReentrant returns (uint256) {
        require(targets.length > 0, "VotingCore: proposal must have actions");
        require(targets.length == values.length && targets.length == calldatas.length, "VotingCore: proposal actions mismatch");
        
        // Check if the proposer has enough voting power (using raw, linear power for threshold)
        uint256 proposerVotes = tokenRegistry.getRawVotingPower(msg.sender);
        require(proposerVotes >= proposalThreshold, "VotingCore: proposer votes below threshold");
        
        // Get proposal ID
        _proposalIdTracker.increment();
        uint256 proposalId = _proposalIdTracker.current();
        
        // Calculate voting period
        uint256 startBlock = block.number + votingDelay;
        uint256 endBlock = startBlock + votingPeriod;
        
        // Create proposal
        Proposal storage proposal = _proposals[proposalId];
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.startBlock = startBlock;
        proposal.endBlock = endBlock;
        proposal.title = title;
        proposal.description = description;
        proposal.ipfsHash = ipfsHash;
        proposal.queued = false; // Initialize new field
        proposal.executed = false;
        
        // Create proposal in proposal manager
        proposalManager.createProposal(
            title,
            description,
            ipfsHash,
            targets,
            values,
            calldatas,
            startBlock,
            endBlock
        );
        
        emit ProposalCreated(proposalId, msg.sender, title);
        
        return proposalId;
    }
    
    /**
     * @notice Cast a vote on a proposal
     * @param proposalId ID of the proposal
     * @param support Vote type: 0 = against, 1 = for, 2 = abstain
     * @return Weight of the vote cast
     */
    function castVote(uint256 proposalId, uint8 support) 
        external 
        override 
        nonReentrant 
        proposalExists(proposalId) 
        returns (uint256) 
    {
        require(support <= 2, "VotingCore: invalid vote type");
        return _castVote(proposalId, msg.sender, support, "");
    }
    
    /**
     * @notice Cast a vote on a proposal with a reason
     * @param proposalId ID of the proposal
     * @param support Vote type: 0 = against, 1 = for, 2 = abstain
     * @param reason The reason given for the vote
     * @return Weight of the vote cast
     */
    function castVoteWithReason(
        uint256 proposalId,
        uint8 support,
        string memory reason
    ) 
        external 
        override 
        nonReentrant 
        proposalExists(proposalId) 
        returns (uint256) 
    {
        require(support <= 2, "VotingCore: invalid vote type");
        return _castVote(proposalId, msg.sender, support, reason);
    }
    
    /**
     * @notice Processes the vote outcome of a proposal and queues it with ProposalManager if passed.
     * @param proposalId ID of the proposal
     */
    function processProposalVoteOutcomeAndQueue(uint256 proposalId) 
        external 
        override // Assuming this will replace executeProposal in IVotingCore
        nonReentrant 
        proposalExists(proposalId) 
    {
        Proposal storage proposal = _proposals[proposalId];
        
        // Check if the proposal has ended
        require(block.number > proposal.endBlock, "VotingCore: voting period not ended");
        
        // Check if the proposal has already been queued or executed
        require(!proposal.queued, "VotingCore: proposal already queued");
        require(!proposal.executed, "VotingCore: proposal already executed");
        
        // Check if the proposal has passed (more for votes than against)
        if (proposal.forVotes > proposal.againstVotes) {
            // Mark as queued
            proposal.queued = true;
            
            // Queue through proposal manager
            proposalManager.queueProposal(proposalId);
            
            emit ProposalQueuedForTimelock(proposalId);
        } else {
            // Optional: Add event for proposal defeated if needed
            // For now, it simply means it's not queued and won't be executed.
            // No specific state change needed if `queued` and `executed` remain false.
        }
    }

    /**
     * @notice Executes a proposal that has been successfully queued via ProposalManager.
     * @param proposalId ID of the proposal
     */
    function executeQueuedProposal(uint256 proposalId) 
        external 
        nonReentrant // Assuming this will be a new function in IVotingCore
        proposalExists(proposalId) 
    {
        Proposal storage proposal = _proposals[proposalId];

        // Check if the proposal was queued
        require(proposal.queued, "VotingCore: proposal not queued");
        // Check if the proposal has already been executed
        require(!proposal.executed, "VotingCore: proposal already executed");

        // Execute through proposal manager
        // ProposalManager's executeProposal will check if the timelock delay has passed
        proposalManager.executeProposal(proposalId);

        // Mark as executed
        proposal.executed = true;
        proposal.queued = false; // Clear the queued flag as it's now executed

        emit ProposalExecuted(proposalId);
    }
    
    /**
     * @notice Get proposal details
     * @param proposalId ID of the proposal
     * @return Proposal details
     */
    function getProposalDetails(uint256 proposalId) 
        external 
        view 
        override 
        proposalExists(proposalId) 
        returns (
            uint256 id,
            address proposer,
            uint256 startBlock,
            uint256 endBlock,
            string memory title,
            string memory description,
            string memory ipfsHash,
            uint256 forVotes,
            uint256 againstVotes,
            uint256 abstainVotes,
            bool queued, // Add new field to return tuple
            bool executed
        ) 
    {
        Proposal storage proposal = _proposals[proposalId];
        
        return (
            proposal.id,
            proposal.proposer,
            proposal.startBlock,
            proposal.endBlock,
            proposal.title,
            proposal.description,
            proposal.ipfsHash,
            proposal.forVotes,
            proposal.againstVotes,
            proposal.abstainVotes,
            proposal.queued, // Return new field
            proposal.executed
        );
    }
    
    /**
     * @notice Get receipt for a vote
     * @param proposalId ID of the proposal
     * @param voter Address of the voter
     * @return Receipt details
     */
    function getReceipt(uint256 proposalId, address voter) 
        external 
        view 
        override 
        proposalExists(proposalId) 
        returns (
            bool hasVoted,
            uint8 support,
            uint256 votes
        ) 
    {
        Receipt storage receipt = _proposals[proposalId].receipts[voter];
        
        return (
            receipt.hasVoted,
            receipt.support,
            receipt.votes
        );
    }
    
    // ================ Events from IVotingCore (implicitly) ================ //
    // event ProposalCreated(uint256 proposalId, address proposer, string title);
    // event VoteCast(address voter, uint256 proposalId, uint8 support, uint256 weight);
    // event ProposalExecuted(uint256 proposalId);

    // ================ Additional Events for VotingCore ================ //
    event ProposalQueuedForTimelock(uint256 indexed proposalId); // New event

    // ================ Internal Functions ================ //
    
    /**
     * @dev Internal function to cast a vote
     * @param proposalId ID of the proposal
     * @param voter Address of the voter
     * @param support Vote type
     * @param reason Vote reason
     * @return The weight of the vote
     */
    function _castVote(
        uint256 proposalId,
        address voter,
        uint8 support,
        string memory reason
    ) internal returns (uint256) {
        Proposal storage proposal = _proposals[proposalId];
        
        // Check if the proposal is active
        require(block.number >= proposal.startBlock, "VotingCore: voting not started");
        require(block.number <= proposal.endBlock, "VotingCore: voting ended");
        
        // Check if the voter has already voted
        require(!proposal.receipts[voter].hasVoted, "VotingCore: already voted");
        
        // Get voting power (either direct or delegated)
        uint256 votes = tokenRegistry.getVotingPower(voter);
        
        // Record vote
        Receipt storage receipt = proposal.receipts[voter];
        receipt.hasVoted = true;
        receipt.support = support;
        receipt.votes = votes;
        
        // Count vote
        if (support == 0) {
            proposal.againstVotes += votes;
        } else if (support == 1) {
            proposal.forVotes += votes;
        } else {
            proposal.abstainVotes += votes;
        }
        
        emit VoteCast(voter, proposalId, support, votes);
        
        return votes;
    }
}

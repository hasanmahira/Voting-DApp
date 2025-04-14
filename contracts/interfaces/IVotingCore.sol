// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IVotingCore
 * @dev Interface for the main voting contract
 */
interface IVotingCore {
    // Events
    event ProposalCreated(uint256 proposalId, address proposer, string title);
    event VoteCast(address voter, uint256 proposalId, uint8 support, uint256 weight);
    event ProposalExecuted(uint256 proposalId);
    
    // Structs
    struct ProposalDetails {
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
        bool executed;
    }
    
    struct Receipt {
        bool hasVoted;
        uint8 support;
        uint256 votes;
    }
    
    // Functions
    function createProposal(
        string memory title,
        string memory description,
        string memory ipfsHash,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas
    ) external returns (uint256);
    
    function castVote(uint256 proposalId, uint8 support) external returns (uint256);
    
    function castVoteWithReason(
        uint256 proposalId,
        uint8 support,
        string memory reason
    ) external returns (uint256);
    
    function executeProposal(uint256 proposalId) external;
    
    function getProposalDetails(uint256 proposalId) external view returns (
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
        bool executed
    );
    
    function getReceipt(uint256 proposalId, address voter) external view returns (
        bool hasVoted,
        uint8 support,
        uint256 votes
    );
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IProposalManager
 * @dev Interface for managing proposals in the voting system
 */
interface IProposalManager {
    // Events
    event ProposalCreated(uint256 proposalId, address proposer);
    event ProposalExecuted(uint256 proposalId);
    event ProposalCanceled(uint256 proposalId);
    
    // Enums
    enum ProposalState { Pending, Active, Canceled, Defeated, Succeeded, Queued, Expired, Executed }
    
    // Structs
    struct ProposalAction {
        address target;
        uint256 value;
        bytes calldata;
    }
    
    // Functions
    function createProposal(
        string memory title,
        string memory description,
        string memory ipfsHash,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        uint256 startBlock,
        uint256 endBlock
    ) external returns (uint256);
    
    function cancelProposal(uint256 proposalId) external;
    
    function queueProposal(uint256 proposalId) external;
    
    function executeProposal(uint256 proposalId) external;
    
    function getProposalState(uint256 proposalId) external view returns (ProposalState);
    
    function getProposalActions(uint256 proposalId) external view returns (
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas
    );
}

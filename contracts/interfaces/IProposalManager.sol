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
    event ProposalScheduled(uint256 indexed proposalId, bytes32 indexed timelockId, address[] targets, uint256[] values, bytes[] calldatas, uint256 delay); // New event
    
    // Enums
    // Succeeded and Expired are less relevant from ProposalManager's perspective with TimelockController
    enum ProposalState { Pending, Active, Canceled, Defeated, Queued, Executed } 
    
    // Structs
    // ProposalAction struct was unused by any function in this interface.
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
        bytes32 timelockId;
    }
    
    // Functions
    function setTimelock(address _timelock) external; // New function

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

    function getProposal(uint256 proposalId) external view returns (ProposalData memory); // New function
}

# Smart Contract Architecture

## Overview

The Voting DApp smart contract system uses a modular design pattern with separate contracts for different responsibilities. This approach allows for better maintainability, upgradability, and gas optimization.

## Core Contracts

```
               ┌───────────────────┐
               │                   │
               │  VotingCore.sol   │◄────────┐
               │                   │         │
               └─────────┬─────────┘         │
                         │                   │
                         │                   │
                         ▼                   │
┌──────────────┐  ┌─────────────────┐  ┌────────────────┐
│              │  │                 │  │                │
│Delegation.sol│◄─┤ProposalManager.sol│◄┤TokenRegistry.sol│
│              │  │                 │  │                │
└──────────────┘  └─────────────────┘  └────────────────┘
```

### VotingCore.sol

The central contract that manages the voting process and acts as the main entry point for users.

**Responsibilities:**
- Track proposals and their status
- Process votes and verify eligibility
- Calculate and update voting results
- Emit voting-related events
- Integration with other contracts

### ProposalManager.sol

Manages the creation, modification, and execution of proposals.

**Responsibilities:**
- Create new proposals
- Store proposal metadata (title, description, IPFS hash)
- Track proposal lifecycle (created, active, passed, executed, failed)
- Execute passed proposals
- Apply time-locks for execution

### Delegation.sol

Handles vote delegation logic, allowing token holders to delegate their voting power.

**Responsibilities:**
- Register delegations
- Track delegated voting power
- Provide delegation history
- Allow delegation revocation
- Apply delegation rules and limitations

### TokenRegistry.sol

Verifies token ownership and determines voting power.

**Responsibilities:**
- Validate ERC-20/ERC-721 tokens for voting
- Calculate voting power based on token balances
- Support multiple token types
- Track token snapshots for specific proposals
- Interface with external token contracts

## Contract Interfaces

### IVotingCore

```solidity
interface IVotingCore {
    // Events
    event ProposalCreated(uint256 proposalId, address proposer, string title);
    event VoteCast(address voter, uint256 proposalId, uint8 support, uint256 weight);
    event ProposalExecuted(uint256 proposalId);
    
    // Structs
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
        bool executed;
        mapping(address => Receipt) receipts;
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
```

### IProposalManager

```solidity
interface IProposalManager {
    // Events
    event ProposalCreated(uint256 proposalId, address proposer);
    event ProposalExecuted(uint256 proposalId);
    event ProposalCanceled(uint256 proposalId);
    
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
        ProposalAction[] memory actions,
        uint256 startBlock,
        uint256 endBlock
    ) external returns (uint256);
    
    function cancelProposal(uint256 proposalId) external;
    
    function executeProposal(uint256 proposalId) external;
    
    function getProposalStatus(uint256 proposalId) external view returns (uint8);
    
    function getProposalActions(uint256 proposalId) external view returns (ProposalAction[] memory);
}
```

### IDelegation

```solidity
interface IDelegation {
    // Events
    event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate);
    event DelegateVotesChanged(address indexed delegate, uint256 previousBalance, uint256 newBalance);
    
    // Functions
    function delegate(address delegatee) external;
    
    function delegateBySig(
        address delegatee,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
    
    function getCurrentVotes(address account) external view returns (uint256);
    
    function getPriorVotes(address account, uint256 blockNumber) external view returns (uint256);
}
```

### ITokenRegistry

```solidity
interface ITokenRegistry {
    // Events
    event TokenAdded(address tokenAddress, uint8 tokenType);
    event TokenRemoved(address tokenAddress);
    
    // Functions
    function addToken(address tokenAddress, uint8 tokenType) external;
    
    function removeToken(address tokenAddress) external;
    
    function getVotingPower(address account) external view returns (uint256);
    
    function getVotingPowerAtBlock(address account, uint256 blockNumber) external view returns (uint256);
    
    function isTokenSupported(address tokenAddress) external view returns (bool);
}
```

## Data Flow Diagram

```
┌──────────────┐       ┌───────────────┐      ┌──────────────┐      ┌────────────────┐
│              │       │               │      │              │      │                │
│ Token Holder ├──────►│  VotingCore   ├─────►│ TokenRegistry├─────►│  ERC20/ERC721  │
│              │       │               │      │              │      │    Tokens      │
└──────┬───────┘       └───────┬───────┘      └──────────────┘      └────────────────┘
       │                       │
       │                       │
       │                       ▼
       │              ┌────────────────┐
       │              │                │
       └─────────────►│   Delegation   │
                      │                │
                      └────────┬───────┘
                               │
                               │
                               ▼
                     ┌─────────────────┐       ┌────────────────┐
                     │                 │       │                │
                     │ ProposalManager ├──────►│ Target Contract│
                     │                 │       │                │
                     └─────────────────┘       └────────────────┘
```

## Design Patterns

1. **Access Control**
   - OpenZeppelin's Ownable for admin functions
   - Role-based access control for different permission levels

2. **Proxy Pattern**
   - Transparent Proxy for upgradability
   - Separate logic and storage contracts

3. **Gas Optimization**
   - Efficient storage patterns
   - Batch operations where possible
   - View functions for data reading

4. **Security Measures**
   - Reentrancy guards
   - Integer overflow/underflow protection (Solidity 0.8.x)
   - Function modifiers for verification

5. **Event Emission**
   - Comprehensive events for off-chain tracking
   - Indexed parameters for efficient filtering

## Future Extensions

1. **Quadratic Voting**
   - Extension contract for quadratic vote calculation

2. **Cross-Chain Voting**
   - Chainlink CCIP integration for multi-chain governance

3. **Gasless Voting**
   - Meta-transactions for zero-gas voting

4. **Privacy-Preserving Voting**
   - ZK-proofs integration for anonymous voting

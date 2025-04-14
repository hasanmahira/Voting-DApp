# Voting DApp Data Flow Diagram

## System-Level Data Flow

```mermaid
flowchart TD
    User["User/Token Holder"] -->|"Connect Wallet"| FE["Frontend Application"]
    FE -->|"Read Data"| SC["Smart Contracts"]
    FE -->|"Write Transactions"| SC
    SC -->|"Store Proposal Content"| IPFS["IPFS Storage"]
    SC -->|"Verify Token Ownership"| BC["Blockchain"]
    SC -->|"Execute Proposals"| TC["Target Contracts"]
    API["Backend API"] -->|"Index Events"| SC
    API -->|"Serve Data"| FE
    API -->|"Store User Data"| DB["Database"]
    ML["AI/ML Services"] -->|"Analyze Voting Patterns"| API
    FE -->|"Request Analysis"| ML
```

## Vote Casting Flow

```mermaid
sequenceDiagram
    participant User as Token Holder
    participant Frontend
    participant VotingCore
    participant TokenRegistry
    participant Delegation
    participant ProposalManager
    
    User->>Frontend: Connect Wallet
    Frontend->>TokenRegistry: Check Token Balance
    TokenRegistry-->>Frontend: Return Voting Power
    
    User->>Frontend: Select Proposal to Vote
    Frontend->>VotingCore: Request Proposal Data
    VotingCore-->>Frontend: Return Proposal Details
    
    alt Has Delegated
        Frontend->>Delegation: Check Delegation Status
        Delegation-->>Frontend: Return Delegation Info
    end
    
    User->>Frontend: Cast Vote (For/Against/Abstain)
    Frontend->>VotingCore: Submit Vote Transaction
    VotingCore->>TokenRegistry: Verify Voting Power
    TokenRegistry-->>VotingCore: Return Valid Power
    VotingCore->>VotingCore: Record Vote
    VotingCore-->>Frontend: Emit VoteCast Event
    Frontend-->>User: Show Vote Confirmation
```

## Proposal Creation Flow

```mermaid
sequenceDiagram
    participant Admin as DAO Admin
    participant Frontend
    participant IPFS
    participant VotingCore
    participant ProposalManager
    
    Admin->>Frontend: Create New Proposal
    Admin->>Frontend: Input Proposal Details
    Admin->>Frontend: Define Execution Actions
    
    Frontend->>IPFS: Store Extended Content
    IPFS-->>Frontend: Return Content CID
    
    Frontend->>VotingCore: Submit Create Proposal TX
    VotingCore->>ProposalManager: Forward Proposal Data
    ProposalManager->>ProposalManager: Create Proposal
    ProposalManager-->>VotingCore: Return Proposal ID
    VotingCore-->>Frontend: Emit ProposalCreated Event
    Frontend-->>Admin: Show Confirmation
```

## Proposal Execution Flow

```mermaid
sequenceDiagram
    participant Executor as Executor
    participant Frontend
    participant VotingCore
    participant ProposalManager
    participant Target as Target Contract
    
    Executor->>Frontend: Request Execution
    Frontend->>VotingCore: Submit Execute Proposal TX
    VotingCore->>VotingCore: Verify Proposal Passed
    VotingCore->>ProposalManager: Execute Proposal
    ProposalManager->>ProposalManager: Check Time-lock
    ProposalManager->>Target: Execute Actions
    Target-->>ProposalManager: Return Result
    ProposalManager-->>VotingCore: Confirm Execution
    VotingCore-->>Frontend: Emit ProposalExecuted Event
    Frontend-->>Executor: Show Execution Result
```

## AI Integration Flow

```mermaid
flowchart TD
    VoteEvents["Voting Events"] -->|"Stream Events"| EventProcessor["Event Processor"]
    EventProcessor -->|"Store Data"| DB["Database"]
    DB -->|"Train Models"| ML["ML Fraud Detection"]
    DB -->|"Analyze Patterns"| Analytics["Analytics Engine"]
    
    Vote["New Vote"] -->|"Check"| ML
    ML -->|"Flag Suspicious"| Alert["Alert System"]
    Alert -->|"Notify"| Admin["DAO Admin"]
    
    User["User"] -->|"Request"| API["API Gateway"]
    API -->|"Query"| Analytics
    Analytics -->|"Provide Insights"| Dashboard["Dashboard"]
    Dashboard -->|"Display"| User
```

## Data Storage Model

```mermaid
erDiagram
    PROPOSAL {
        uint256 id PK
        address proposer
        uint256 startBlock
        uint256 endBlock
        string title
        string description
        string ipfsHash
        uint256 forVotes
        uint256 againstVotes
        uint256 abstainVotes
        bool executed
    }
    
    VOTE {
        uint256 proposalId FK
        address voter PK
        uint8 support
        uint256 weight
        string reason
        uint256 timestamp
    }
    
    DELEGATION {
        address delegator PK
        address delegatee
        uint256 timestamp
    }
    
    TOKEN {
        address tokenAddress PK
        uint8 tokenType
        string name
        string symbol
        bool active
    }
    
    USER {
        address walletAddress PK
        string username
        uint256 reputation
        bool isAdmin
    }
    
    PROPOSAL ||--o{ VOTE : "contains"
    DELEGATION ||--|| USER : "delegates to"
    USER ||--o{ VOTE : "casts"
    USER ||--o{ PROPOSAL : "creates"
    TOKEN ||--o{ USER : "owned by"
```

This data flow diagram illustrates the complete flow of information through the Voting DApp system, from user interactions to blockchain transactions and data storage. The diagram should help guide the implementation of the smart contracts and their interactions with frontend and backend services.

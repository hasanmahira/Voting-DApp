// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IDelegation.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Delegation
 * @dev Manages vote delegation for the voting system
 */
contract Delegation is IDelegation, AccessControl {
    using ECDSA for bytes32;

    // ================ Constants ================ //
    bytes32 public constant TOKEN_REGISTRY_ROLE = keccak256("TOKEN_REGISTRY_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    // Domain separator for EIP-712 signatures
    bytes32 public DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");
    
    // Delegation typehash for EIP-712 signatures
    bytes32 public DELEGATION_TYPEHASH = keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)");
    
    // ================ State Variables ================ //
    // Delegator address => delegatee address
    mapping(address => address) private _delegates;
    
    // Delegator address => nonce for signatures
    mapping(address => uint256) private _nonces;
    
    // Voting checkpoint history (for historical vote power lookup)
    // Account => (checkpoint index => Checkpoint)
    mapping(address => mapping(uint32 => Checkpoint)) private _checkpoints;
    
    // Account => number of checkpoints
    mapping(address => uint32) private _numCheckpoints;
    
    // Contract name for EIP-712
    string public name = "Voting DApp Delegation";
    
    // ================ Structs ================ //
    struct Checkpoint {
        uint32 fromBlock;
        uint256 votes;
    }
    
    // ================ Constructor ================ //
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }
    
    // ================ External Functions ================ //
    
    /**
     * @notice Sets the contract name for EIP-712 signatures
     * @param newName New contract name
     */
    function setName(string memory newName) external onlyRole(ADMIN_ROLE) {
        name = newName;
    }
    
    /**
     * @notice Delegate votes from msg.sender to delegatee
     * @param delegatee The address to delegate votes to
     */
    function delegate(address delegatee) external override {
        _delegate(msg.sender, delegatee);
    }
    
    /**
     * @notice Delegates votes from signatory to delegatee using signature
     * @param delegatee The address to delegate votes to
     * @param nonce The contract state required to match the signature
     * @param expiry The time at which to expire the signature
     * @param v The recovery byte of the signature
     * @param r Half of the ECDSA signature pair
     * @param s Half of the ECDSA signature pair
     */
    function delegateBySig(
        address delegatee,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {
        // Check expiry
        require(block.timestamp <= expiry, "Delegation: signature expired");
        
        // Check nonce
        require(nonce == _nonces[delegatee], "Delegation: invalid nonce");
        
        // Check signature
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                block.chainid,
                address(this)
            )
        );
        
        bytes32 structHash = keccak256(
            abi.encode(
                DELEGATION_TYPEHASH,
                delegatee,
                nonce,
                expiry
            )
        );
        
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator,
                structHash
            )
        );
        
        address signatory = digest.recover(v, r, s);
        require(signatory != address(0), "Delegation: invalid signature");
        
        // Increment nonce
        _nonces[signatory]++;
        
        // Delegate
        _delegate(signatory, delegatee);
    }
    
    /**
     * @notice Gets the current votes balance for an account
     * @param account The address to get votes balance for
     * @return The number of current votes for the account
     */
    function getCurrentVotes(address account) external view override returns (uint256) {
        uint32 nCheckpoints = _numCheckpoints[account];
        return nCheckpoints > 0 ? _checkpoints[account][nCheckpoints - 1].votes : 0;
    }
    
    /**
     * @notice Gets the prior votes for an account at a specific block number
     * @param account The address to get votes balance for
     * @param blockNumber The block number to get votes at
     * @return The number of votes the account had at the given block
     */
    function getPriorVotes(address account, uint256 blockNumber) external view override returns (uint256) {
        require(blockNumber < block.number, "Delegation: not yet determined");
        
        uint32 nCheckpoints = _numCheckpoints[account];
        if (nCheckpoints == 0) {
            return 0;
        }
        
        // First check most recent balance
        if (_checkpoints[account][nCheckpoints - 1].fromBlock <= blockNumber) {
            return _checkpoints[account][nCheckpoints - 1].votes;
        }
        
        // Next check implicit zero balance
        if (_checkpoints[account][0].fromBlock > blockNumber) {
            return 0;
        }
        
        // Binary search for the appropriate checkpoint
        uint32 lower = 0;
        uint32 upper = nCheckpoints - 1;
        while (upper > lower) {
            uint32 center = upper - (upper - lower) / 2; // ceil division
            Checkpoint memory cp = _checkpoints[account][center];
            
            if (cp.fromBlock == blockNumber) {
                return cp.votes;
            } else if (cp.fromBlock < blockNumber) {
                lower = center;
            } else {
                upper = center - 1;
            }
        }
        
        return _checkpoints[account][lower].votes;
    }
    
    /**
     * @notice Gets the address that an account has delegated to
     * @param account The account to get delegate of
     * @return The address the account has delegated to
     */
    function delegates(address account) external view override returns (address) {
        return _delegates[account];
    }
    
    /**
     * @notice Gets the current nonce for an address
     * @param account The address to get the nonce for
     * @return The current nonce
     */
    function nonces(address account) external view returns (uint256) {
        return _nonces[account];
    }
    
    /**
     * @notice Updates voting power for an account (only callable by token registry)
     * @param account The account to update votes for
     * @param newVotes The new vote amount
     */
    function updateVotingPower(address account, uint256 newVotes) external onlyRole(TOKEN_REGISTRY_ROLE) {
        _updateVotingPower(account, newVotes);
    }
    
    // ================ Internal Functions ================ //
    
    /**
     * @dev Delegate votes from delegator to delegatee
     * @param delegator The address which is delegating votes
     * @param delegatee The address which is receiving delegated votes
     */
    function _delegate(address delegator, address delegatee) internal {
        address currentDelegate = _delegates[delegator];
        
        // Update the delegation mapping
        _delegates[delegator] = delegatee;
        
        emit DelegateChanged(delegator, currentDelegate, delegatee);
        
        // No need to update vote checkpoints here
        // The token registry will call updateVotingPower when token balances change
    }
    
    /**
     * @dev Add a new checkpoint to the checkpoint history for an account
     * @param account The account to add a checkpoint for
     * @param blockNumber The block number of the checkpoint
     * @param newVotes The votes balance at the checkpoint
     */
    function _addCheckpoint(address account, uint32 blockNumber, uint256 newVotes) internal {
        uint32 pos = _numCheckpoints[account];
        
        // If there are existing checkpoints and the block number matches the latest, update it
        if (pos > 0 && _checkpoints[account][pos - 1].fromBlock == blockNumber) {
            _checkpoints[account][pos - 1].votes = newVotes;
        } else {
            // Otherwise add a new checkpoint
            _checkpoints[account][pos] = Checkpoint({
                fromBlock: blockNumber,
                votes: newVotes
            });
            _numCheckpoints[account] = pos + 1;
        }
    }
    
    /**
     * @dev Updates the voting power for an account
     * @param account The account to update
     * @param newVotes The new voting power
     */
    function _updateVotingPower(address account, uint256 newVotes) internal {
        uint256 oldVotes = _numCheckpoints[account] > 0 ? _checkpoints[account][_numCheckpoints[account] - 1].votes : 0;
        
        // Only update if votes changed
        if (oldVotes != newVotes) {
            _addCheckpoint(account, uint32(block.number), newVotes);
            
            emit DelegateVotesChanged(account, oldVotes, newVotes);
            
            // Update delegatee's votes if account has delegated
            address delegatee = _delegates[account];
            if (delegatee != address(0) && delegatee != account) {
                uint256 delegateeOldVotes = _numCheckpoints[delegatee] > 0 ? 
                    _checkpoints[delegatee][_numCheckpoints[delegatee] - 1].votes : 0;
                
                uint256 delegateeNewVotes = delegateeOldVotes + newVotes - oldVotes;
                
                _addCheckpoint(delegatee, uint32(block.number), delegateeNewVotes);
                
                emit DelegateVotesChanged(delegatee, delegateeOldVotes, delegateeNewVotes);
            }
        }
    }
}

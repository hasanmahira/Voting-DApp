// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IDelegation
 * @dev Interface for vote delegation functionality
 */
interface IDelegation {
    // Events
    event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate);
    event DelegateVotesChanged(address indexed delegate, uint256 previousBalance, uint256 newBalance);
    
    // Functions
    /**
     * @notice Delegate votes from the sender to the given account
     * @param delegatee The address to delegate votes to
     */
    function delegate(address delegatee) external;
    
    /**
     * @notice Delegate votes from signatory to the given account using signature
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
    ) external;
    
    /**
     * @notice Get the current votes balance for an account
     * @param account The address to get votes balance for
     * @return The number of current votes for the account
     */
    function getCurrentVotes(address account) external view returns (uint256);
    
    /**
     * @notice Get the votes balance for an account at a specific block number
     * @param account The address to get votes balance for
     * @param blockNumber The block number to get votes at
     * @return The number of votes the account had at the given block
     */
    function getPriorVotes(address account, uint256 blockNumber) external view returns (uint256);
    
    /**
     * @notice Get the address that an account has delegated to
     * @param account The account to get delegate of
     * @return The address the account has delegated to
     */
    function delegates(address account) external view returns (address);
}

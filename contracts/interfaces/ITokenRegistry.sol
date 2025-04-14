// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title ITokenRegistry
 * @dev Interface for managing token validation and voting power calculations
 */
interface ITokenRegistry {
    // Events
    event TokenAdded(address indexed tokenAddress, uint8 tokenType, string name, string symbol);
    event TokenRemoved(address indexed tokenAddress);
    event TokenWeightChanged(address indexed tokenAddress, uint256 newWeight);
    
    // Enums
    enum TokenType { ERC20, ERC721, ERC1155 }
    
    // Structs
    struct TokenInfo {
        address tokenAddress;
        TokenType tokenType;
        string name;
        string symbol;
        uint256 weight;
        bool active;
    }
    
    // Functions
    /**
     * @notice Add a token to the registry
     * @param tokenAddress The address of the token contract
     * @param tokenType The type of token (0 = ERC20, 1 = ERC721, 2 = ERC1155)
     * @param weight The voting weight multiplier for this token
     */
    function addToken(address tokenAddress, TokenType tokenType, uint256 weight) external;
    
    /**
     * @notice Remove a token from the registry
     * @param tokenAddress The address of the token to remove
     */
    function removeToken(address tokenAddress) external;
    
    /**
     * @notice Set the weight for a token
     * @param tokenAddress The address of the token
     * @param weight The new weight value
     */
    function setTokenWeight(address tokenAddress, uint256 weight) external;
    
    /**
     * @notice Get the voting power for an account
     * @param account The address to get voting power for
     * @return The voting power of the account
     */
    function getVotingPower(address account) external view returns (uint256);
    
    /**
     * @notice Get the voting power for an account at a specific block
     * @param account The address to get voting power for
     * @param blockNumber The block number to get voting power at
     * @return The voting power of the account at the given block
     */
    function getVotingPowerAtBlock(address account, uint256 blockNumber) external view returns (uint256);
    
    /**
     * @notice Check if a token is supported by the registry
     * @param tokenAddress The address of the token to check
     * @return True if the token is supported, false otherwise
     */
    function isTokenSupported(address tokenAddress) external view returns (bool);
    
    /**
     * @notice Get the list of all supported tokens
     * @return An array of token addresses
     */
    function getSupportedTokens() external view returns (address[] memory);
    
    /**
     * @notice Get information about a token
     * @param tokenAddress The address of the token
     * @return Token information structure
     */
    function getTokenInfo(address tokenAddress) external view returns (TokenInfo memory);
}

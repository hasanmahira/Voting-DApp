// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/ITokenRegistry.sol";
import "./interfaces/IDelegation.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

/**
 * @title TokenRegistry
 * @dev Manages token validation and voting power calculations for governance
 */
contract TokenRegistry is ITokenRegistry, AccessControl {
    // ================ Constants ================ //
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    // ================ State Variables ================ //
    // Mapping of registered tokens
    mapping(address => TokenInfo) private _tokenInfo;
    
    // Array of supported token addresses
    address[] private _supportedTokens;
    
    // Address of the delegation contract
    IDelegation public delegation;
    
    // Mapping for token snapshot data (for historical voting power)
    // Block number => account => token address => balance
    mapping(uint256 => mapping(address => mapping(address => uint256))) private _tokenSnapshots;
    
    // Block numbers with snapshots
    mapping(uint256 => bool) private _snapshotTaken;
    
    // ================ Events ================ //
    event TokenSnapshotTaken(uint256 blockNumber);
    
    // ================ Constructor ================ //
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }
    
    // ================ External Functions ================ //
    
    /**
     * @notice Sets the delegation contract
     * @param _delegation Address of the delegation contract
     */
    function setDelegation(address _delegation) external onlyRole(ADMIN_ROLE) {
        require(_delegation != address(0), "TokenRegistry: invalid delegation address");
        delegation = IDelegation(_delegation);
    }
    
    /**
     * @notice Adds a token to the registry
     * @param tokenAddress The address of the token contract
     * @param tokenType The type of token (0 = ERC20, 1 = ERC721, 2 = ERC1155)
     * @param weight The voting weight multiplier for this token
     */
    function addToken(address tokenAddress, TokenType tokenType, uint256 weight) external override onlyRole(ADMIN_ROLE) {
        require(tokenAddress != address(0), "TokenRegistry: invalid token address");
        require(!_tokenInfo[tokenAddress].active, "TokenRegistry: token already added");
        require(weight > 0, "TokenRegistry: weight must be greater than 0");
        
        string memory name;
        string memory symbol;
        
        // Verify token and get metadata
        if (tokenType == TokenType.ERC20) {
            // Try to get ERC20 metadata
            try IERC20(tokenAddress).name() returns (string memory _name) {
                name = _name;
            } catch {
                name = "Unknown ERC20";
            }
            
            try IERC20(tokenAddress).symbol() returns (string memory _symbol) {
                symbol = _symbol;
            } catch {
                symbol = "UNK";
            }
        } else if (tokenType == TokenType.ERC721) {
            // Try to get ERC721 metadata
            try IERC721(tokenAddress).name() returns (string memory _name) {
                name = _name;
            } catch {
                name = "Unknown ERC721";
            }
            
            try IERC721(tokenAddress).symbol() returns (string memory _symbol) {
                symbol = _symbol;
            } catch {
                symbol = "UNK";
            }
        } else {
            // ERC1155 doesn't have standard name/symbol
            name = "ERC1155 Token";
            symbol = "ERC1155";
        }
        
        // Add token to registry
        _tokenInfo[tokenAddress] = TokenInfo({
            tokenAddress: tokenAddress,
            tokenType: tokenType,
            name: name,
            symbol: symbol,
            weight: weight,
            active: true
        });
        
        // Add to supported tokens array
        _supportedTokens.push(tokenAddress);
        
        emit TokenAdded(tokenAddress, uint8(tokenType), name, symbol);
    }
    
    /**
     * @notice Removes a token from the registry
     * @param tokenAddress The address of the token to remove
     */
    function removeToken(address tokenAddress) external override onlyRole(ADMIN_ROLE) {
        require(_tokenInfo[tokenAddress].active, "TokenRegistry: token not active");
        
        // Mark as inactive
        _tokenInfo[tokenAddress].active = false;
        
        // Remove from supported tokens array
        for (uint256 i = 0; i < _supportedTokens.length; i++) {
            if (_supportedTokens[i] == tokenAddress) {
                // Swap with the last element and pop
                _supportedTokens[i] = _supportedTokens[_supportedTokens.length - 1];
                _supportedTokens.pop();
                break;
            }
        }
        
        emit TokenRemoved(tokenAddress);
    }
    
    /**
     * @notice Sets the weight for a token
     * @param tokenAddress The address of the token
     * @param weight The new weight value
     */
    function setTokenWeight(address tokenAddress, uint256 weight) external override onlyRole(ADMIN_ROLE) {
        require(_tokenInfo[tokenAddress].active, "TokenRegistry: token not active");
        require(weight > 0, "TokenRegistry: weight must be greater than 0");
        
        _tokenInfo[tokenAddress].weight = weight;
        
        emit TokenWeightChanged(tokenAddress, weight);
    }
    
    /**
     * @notice Takes a snapshot of token balances at the current block
     * @param accounts Addresses to take snapshots for
     */
    function takeSnapshot(address[] calldata accounts) external onlyRole(ADMIN_ROLE) {
        require(accounts.length > 0, "TokenRegistry: empty accounts array");
        
        // Check if snapshot already taken for this block
        if (!_snapshotTaken[block.number]) {
            _snapshotTaken[block.number] = true;
            emit TokenSnapshotTaken(block.number);
        }
        
        // Take snapshot for each account
        for (uint256 i = 0; i < accounts.length; i++) {
            _takeSnapshotForAccount(accounts[i], block.number);
        }
    }
    
    /**
     * @notice Gets the voting power for an account
     * @param account The address to get voting power for
     * @return The voting power of the account
     */
    function getVotingPower(address account) external view override returns (uint256) {
        return _calculateVotingPower(account, block.number, false);
    }
    
    /**
     * @notice Gets the voting power for an account at a specific block
     * @param account The address to get voting power for
     * @param blockNumber The block number to get voting power at
     * @return The voting power of the account at the given block
     */
    function getVotingPowerAtBlock(address account, uint256 blockNumber) external view override returns (uint256) {
        require(blockNumber < block.number, "TokenRegistry: block not yet mined");
        return _calculateVotingPower(account, blockNumber, true);
    }
    
    /**
     * @notice Checks if a token is supported by the registry
     * @param tokenAddress The address of the token to check
     * @return True if the token is supported, false otherwise
     */
    function isTokenSupported(address tokenAddress) external view override returns (bool) {
        return _tokenInfo[tokenAddress].active;
    }
    
    /**
     * @notice Gets the list of all supported tokens
     * @return An array of token addresses
     */
    function getSupportedTokens() external view override returns (address[] memory) {
        return _supportedTokens;
    }
    
    /**
     * @notice Gets information about a token
     * @param tokenAddress The address of the token
     * @return Token information structure
     */
    function getTokenInfo(address tokenAddress) external view override returns (TokenInfo memory) {
        return _tokenInfo[tokenAddress];
    }
    
    // ================ Internal Functions ================ //
    
    /**
     * @dev Takes a snapshot of token balances for an account
     * @param account The account to take a snapshot for
     * @param blockNumber The block number to associate with the snapshot
     */
    function _takeSnapshotForAccount(address account, uint256 blockNumber) internal {
        for (uint256 i = 0; i < _supportedTokens.length; i++) {
            address token = _supportedTokens[i];
            TokenInfo storage info = _tokenInfo[token];
            
            if (info.active) {
                uint256 balance = _getTokenBalance(account, token, info.tokenType);
                _tokenSnapshots[blockNumber][account][token] = balance;
            }
        }
        
        // Update delegation if needed
        if (address(delegation) != address(0)) {
            uint256 votingPower = _calculateVotingPower(account, blockNumber, false);
            delegation.updateVotingPower(account, votingPower);
        }
    }
    
    /**
     * @dev Gets the balance of tokens for an account
     * @param account The account to get the balance for
     * @param tokenAddress The token address
     * @param tokenType The type of token
     * @return The balance of tokens
     */
    function _getTokenBalance(address account, address tokenAddress, TokenType tokenType) internal view returns (uint256) {
        if (tokenType == TokenType.ERC20) {
            return IERC20(tokenAddress).balanceOf(account);
        } else if (tokenType == TokenType.ERC721) {
            // For ERC721, count the number of tokens owned
            return IERC721(tokenAddress).balanceOf(account);
        } else if (tokenType == TokenType.ERC1155) {
            // For ERC1155, this is a simplified approach
            // In a real implementation, you would need to specify which token IDs to check
            // or track them separately
            return 0; // Not implemented in this simplified version
        }
        
        return 0;
    }
    
    /**
     * @dev Calculates the voting power for an account
     * @param account The account to calculate voting power for
     * @param blockNumber The block number to calculate at
     * @param useSnapshot Whether to use snapshot data
     * @return The voting power
     */
    function _calculateVotingPower(address account, uint256 blockNumber, bool useSnapshot) internal view returns (uint256) {
        uint256 totalVotingPower = 0;
        
        for (uint256 i = 0; i < _supportedTokens.length; i++) {
            address token = _supportedTokens[i];
            TokenInfo storage info = _tokenInfo[token];
            
            if (info.active) {
                uint256 balance;
                
                if (useSnapshot && _snapshotTaken[blockNumber]) {
                    // Use snapshot data if available
                    balance = _tokenSnapshots[blockNumber][account][token];
                } else {
                    // Otherwise use current balance
                    balance = _getTokenBalance(account, token, info.tokenType);
                }
                
                // Apply token weight
                totalVotingPower += balance * info.weight;
            }
        }
        
        return totalVotingPower;
    }
}

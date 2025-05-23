// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title ExecutionTimelock
 * @dev This contract implements a timelock mechanism for executing proposals.
 * It is based on OpenZeppelin's TimelockController, providing a delay before
 * operations can be executed. This contract manages roles for proposing,
 * executing, and administering the timelock.
 *
 * Roles:
 * - PROPOSER_ROLE: Granted to addresses that can schedule operations.
 * - EXECUTOR_ROLE: Granted to addresses that can execute scheduled operations
 *   once the minimum delay has passed. Can be set to address(0) to allow anyone to execute.
 * - CANCELLER_ROLE: Granted to addresses that can cancel scheduled operations.
 *   By default, this role is granted to all proposers.
 * - TIMELOCK_ADMIN_ROLE: Granted to an admin address responsible for managing
 *   roles and other administrative functions of the timelock. The deployer
 *   of this contract will renounce this role if a different admin is specified.
 */
contract ExecutionTimelock is TimelockController {
    /**
     * @dev Sets up the TimelockController.
     * @param minDelay The minimum delay in seconds after an operation is scheduled
     *                 before it can be executed.
     * @param proposers An array of addresses that will be granted the PROPOSER_ROLE
     *                  (and by default, the CANCELLER_ROLE).
     * @param executors An array of addresses that will be granted the EXECUTOR_ROLE.
     *                  Use address(0) in the array if execution should be open to anyone.
     * @param admin The address that will be granted the TIMELOCK_ADMIN_ROLE.
     *              The deployer's TIMELOCK_ADMIN_ROLE will be renounced if 'admin'
     *              is not the deployer.
     */
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {
        // TimelockController's constructor handles:
        // 1. Setting the minimum delay.
        // 2. Granting PROPOSER_ROLE to each address in 'proposers'.
        // 3. Granting CANCELLER_ROLE to each address in 'proposers'.
        // 4. Granting EXECUTOR_ROLE to each address in 'executors'.
        // 5. Granting TIMELOCK_ADMIN_ROLE to the 'admin' address.
        // 6. Revoking TIMELOCK_ADMIN_ROLE from msg.sender if 'admin' is not msg.sender.
        // No further setup is required here for these roles.
    }

    // Functions for proposing, executing, and cancelling operations are inherited
    // from TimelockController:
    // - schedule(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt, uint256 delay)
    // - execute(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt)
    // - cancel(bytes32 id)

    // View functions for checking status are also inherited:
    // - isOperation(bytes32 id)
    // - isOperationPending(bytes32 id)
    // - isOperationReady(bytes32 id)
    // - isOperationDone(bytes32 id)
    // - getTimestamp(bytes32 id)
    // - getMinDelay()

    // Role management functions are inherited from AccessControl (via TimelockController):
    // - hasRole(bytes32 role, address account)
    // - getRoleAdmin(bytes32 role)
    // - grantRole(bytes32 role, address account)
    // - revokeRole(bytes32 role, address account)
    // - renounceRole(bytes32 role, address account)
}

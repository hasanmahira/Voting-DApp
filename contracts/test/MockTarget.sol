// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MockTarget {
    uint256 public x;
    address public lastCaller;
    uint256 public lastValue;
    bytes public lastCalldata;

    event XSet(uint256 _x, address indexed caller, uint256 value, bytes calldata);

    function setX(uint256 _x) public payable {
        x = _x;
        lastCaller = msg.sender;
        lastValue = msg.value;
        lastCalldata = msg.data;
        emit XSet(_x, msg.sender, msg.value, msg.data);
    }

    function setXWithValue(uint256 _x) public payable {
        x = _x;
        lastCaller = msg.sender;
        lastValue = msg.value;
        lastCalldata = msg.data;
        emit XSet(_x, msg.sender, msg.value, msg.data);
    }

    function doNothing() public payable {
        lastCaller = msg.sender;
        lastValue = msg.value;
        lastCalldata = msg.data;
    }
}

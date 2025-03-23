// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ZKParkToken is ERC20, ERC20Burnable, Pausable, Ownable {
    event TokensMinted(address indexed to, uint256 amount);
    event TokensBurned(address indexed from, uint256 amount);
    
    uint256 public constant MAX_SUPPLY = 1000000000;
    
    mapping(address => bool) public minters;
    
    constructor() ERC20("ZKPark Token", "ZKP2") Ownable(msg.sender) {
        _mint(msg.sender, 100000);
    }
    
    function decimals() public pure override returns (uint8) {
        return 0;
    }
    
    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner(), "Not authorized to mint");
        _;
    }
    
    function addMinter(address _minter) external onlyOwner {
        minters[_minter] = true;
    }

    function removeMinter(address _minter) external onlyOwner {
        minters[_minter] = false;
    }
    
    function pause() public onlyOwner {
        _pause();
    }
    
    function unpause() public onlyOwner {
        _unpause();
    }

    function mint(address to, uint256 amount) public onlyMinter {
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds maximum token supply");
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    function burn(uint256 amount) public override {
        super.burn(amount);
        emit TokensBurned(_msgSender(), amount);
    }
    
    function _update(address from, address to, uint256 amount) 
        internal
        override
        whenNotPaused
    {
        super._update(from, to, amount);
    }
}
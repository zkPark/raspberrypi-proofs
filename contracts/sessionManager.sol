// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {LeaseHonkVerifier} from './LeaseVerifier.sol'
import {SessionHonkVerifier} from './SessionVerifier.sol'

interface IZKParkToken is IERC20 {
    function mint(address to, uint256 amount) external;
}

contract ParkingSessionManager is Ownable, ReentrancyGuard {

    LeaseHonkVerifier leaseVerifier;
    SessionHonkVerifier sessionVerifier;
    IZKParkToken public zkParkToken;

    enum SessionStatus { RESERVED, ACTIVE, COMPLETED, CANCELLED }
    
    struct ParkingSession {
        string sessionId;
        address user;
        address spotOwner;
        string parkingMeterDid;
        uint256 startTime;
        uint256 endTime;
        uint256 reservationTime;
        uint256 rewardAmount;
        SessionStatus status;
    }
    
    mapping(string => ParkingSession) public parkingSessions;
    mapping(address => string[]) public userSessions;
    mapping(address => string[]) public spotOwnerSessions;
    
    event SessionReserved(
        string sessionId, 
        address indexed user, 
        address indexed spotOwner, 
        string parkingMeterDid, 
        uint256 startTime, 
        uint256 endTime
    );
    event SessionStarted(string sessionId, uint256 actualStartTime);
    event SessionEnded(
        string sessionId, 
        uint256 actualEndTime, 
        uint256 rewardAmount
    );
    event SessionCancelled(string sessionId, uint256 cancellationTime);
    event RewardDistributed(
        string sessionId, 
        address indexed user, 
        address indexed spotOwner, 
        uint256 userReward, 
        uint256 ownerReward
    );
    event SessionStartedEarly(string sessionId, uint256 scheduledStartTime, uint256 actualStartTime);
    event SessionEndedEarly(string sessionId, uint256 scheduledEndTime, uint256 actualEndTime);
    
    constructor(address _tokenAddress, address _lverifier, address _sverifier) Ownable(msg.sender) {
        zkParkToken = IZKParkToken(_tokenAddress);
        leaseVerifier = LeaseHonkVerifier(_lverifier);
        sessionVerifier = SessionHonkVerifier(_sverifier);
    }
    
    function updateTokenAddress(address _newTokenAddress) external onlyOwner {
        zkParkToken = IZKParkToken(_newTokenAddress);
    }
    
    function createReservation(
        string memory _sessionId,
        address _user,
        address _spotOwner,
        string memory _parkingMeterDid,
        uint256 _startTime,
        uint256 _endTime
    ) external {
        require(bytes(_sessionId).length > 0, "Session ID cannot be empty");
        require(_user != address(0), "Invalid user address");
        require(_spotOwner != address(0), "Invalid spot owner address");
        require(bytes(_parkingMeterDid).length > 0, "Parking meter DID cannot be empty");
        require(_startTime > block.timestamp, "Start time must be in the future");
        require(_endTime > _startTime, "End time must be after start time");
        require(parkingSessions[_sessionId].user == address(0), "Session ID already exists");
        
        ParkingSession memory newSession = ParkingSession({
            sessionId: _sessionId,
            user: _user,
            spotOwner: _spotOwner,
            parkingMeterDid: _parkingMeterDid,
            startTime: _startTime,
            endTime: _endTime,
            reservationTime: block.timestamp,
            rewardAmount: 0,
            status: SessionStatus.RESERVED
        });
        
        parkingSessions[_sessionId] = newSession;
        userSessions[_user].push(_sessionId);
        spotOwnerSessions[_spotOwner].push(_sessionId);
        
        emit SessionReserved(
            _sessionId, 
            _user, 
            _spotOwner, 
            _parkingMeterDid, 
            _startTime, 
            _endTime
        );
    }

    function startSession(string memory _sessionId) external {
        ParkingSession storage session = parkingSessions[_sessionId];
        
        require(bytes(session.sessionId).length > 0, "Session does not exist");
        require(session.status == SessionStatus.RESERVED, "Session not in reserved status");
        
        if (block.timestamp < session.startTime) {
            emit SessionStartedEarly(_sessionId, session.startTime, block.timestamp);
        }
        
        session.status = SessionStatus.ACTIVE;
        session.startTime = block.timestamp;
        
        emit SessionStarted(_sessionId, block.timestamp);
    }

    function verifySessionData(bytes calldata proof, string memory _sessionId, uint256 _rewardAmount) public returns (bool) {
        ParkingSession storage session = parkingSessions[_sessionId];

        require(bytes(session.sessionId).length > 0, "Session does not exist");
        require(session.status == SessionStatus.ACTIVE, "Session not active");

        bytes32[] memory publicInputs = new bytes32[](4);
        publicInputs[0] = _sessionId;
        publicInputs[1] = _rewardAmount;
        publicInputs[2] = parkingSessions[_sessionId].startTime;
        publicInputs[3] = parkingSessions[_sessionId].endTime;

        require(sessionVerifier.verify(proof, publicInputs), "Invalid proof");

        return true;
    }

    function endSession(bytes calldata proof, string memory _sessionId, uint256 _rewardAmount) external nonReentrant {
        ParkingSession storage session = parkingSessions[_sessionId];
        
        require(bytes(session.sessionId).length > 0, "Session does not exist");
        require(session.status == SessionStatus.ACTIVE, "Session not active");

        bytes32[] memory publicInputs = new bytes32[](4);
        publicInputs[0] = _sessionId;
        publicInputs[1] = _rewardAmount;
        publicInputs[2] = parkingSessions[_sessionId].startTime;
        publicInputs[3] = parkingSessions[_sessionId].endTime;

        require(sessionVerifier.verify(proof, publicInputs), "Invalid proof");
        
        if (block.timestamp < session.endTime) {
            emit SessionEndedEarly(_sessionId, session.endTime, block.timestamp);
        }
        
        session.status = SessionStatus.COMPLETED;
        session.endTime = block.timestamp;
        session.rewardAmount = _rewardAmount;
        
        emit SessionEnded(_sessionId, block.timestamp, _rewardAmount);
        _distributeRewards(_sessionId);
    }


    function cancelSession(string memory _sessionId) external {
        ParkingSession storage session = parkingSessions[_sessionId];
        
        require(bytes(session.sessionId).length > 0, "Session does not exist");
        require(session.status == SessionStatus.RESERVED, "Can only cancel reserved sessions");
        session.status = SessionStatus.CANCELLED;
        emit SessionCancelled(_sessionId, block.timestamp);
    }
    

    function dRewards(address _user) external {
        zkParkToken.mint(_user, 10);
    }

    function _distributeRewards(string memory _sessionId) internal {
        ParkingSession storage session = parkingSessions[_sessionId];
        
        uint256 ownerReward = (session.rewardAmount * 70) / 100;
        uint256 userReward = session.rewardAmount - userReward;
        
        zkParkToken.mint(session.user, userReward);
        zkParkToken.mint(session.spotOwner, ownerReward);
        
        emit RewardDistributed(
            _sessionId,
            session.user,
            session.spotOwner,
            userReward,
            ownerReward
        );
    }
    
    function getUserSessions(address _user) external view returns (string[] memory) {
        return userSessions[_user];
    }

    function getSpotOwnerSessions(address _spotOwner) external view returns (string[] memory) {
        return spotOwnerSessions[_spotOwner];
    }

    function getSessionDetails(string memory _sessionId) external view returns (ParkingSession memory) {
        return parkingSessions[_sessionId];
    }
}
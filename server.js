const express = require('express');
const { ethers } = require('ethers');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

let contractABI;
try {
  const abiPath = path.resolve(__dirname, './contracts/sessionManagerABI.json');
  const abiFile = fs.readFileSync(abiPath, 'utf8');
  const abiJson = JSON.parse(abiFile);
  contractABI = abiJson.abi;
  console.log("Contract ABI loaded successfully from file");
} catch (error) {
  console.error("Error loading contract ABI from file:", error);
  process.exit(1);
}

let provider;
let contract;

try {
  provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  contract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS, 
    contractABI, 
    wallet
  );
  
  console.log("Successfully connected to contract at:", process.env.CONTRACT_ADDRESS);
} catch (error) {
  console.error("Error connecting to contract:", error);
}

function generateSessionId(spotOwnerAddress) {
  const timestamp = Date.now();
  const addressPart = spotOwnerAddress.slice(-8);
  const randomPart = Math.random().toString(36).substring(2, 8);
  return `${addressPart}-${timestamp}-${randomPart}`;
}

// 1. Create a reservation
app.post('/api/reservations', async (req, res) => {
  try {
    const { user, spotOwner, startTime, endTime } = req.body;
    const parkingMeterDid = process.env.PARKING_METER_DID;
    if (!user || !spotOwner || !parkingMeterDid || !startTime || !endTime) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const finalSessionId = generateSessionId(spotOwner);
    const startTimestamp = BigInt(Math.floor(new Date(startTime).getTime() / 1000));
    const endTimestamp = BigInt(Math.floor(new Date(endTime).getTime() / 1000));
    
    const tx = await contract.createReservation(
      finalSessionId,
      user,
      spotOwner,
      parkingMeterDid,
      startTimestamp,
      endTimestamp
    );
    
    const receipt = await tx.wait();
    
    res.status(201).json({ 
      success: true, 
      message: 'Reservation created successfully', 
      transactionHash: receipt.transactionHash,
      sessionId: finalSessionId
    });
  } catch (error) {
    console.error('Error creating reservation:', error);
    res.status(500).json({ error: 'Failed to create reservation', details: error.message });
  }
});

// 2. Start a session
app.post('/api/sessions/start', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    const tx = await contract.startSession(sessionId);
    const receipt = await tx.wait();
    
    res.status(200).json({ 
      success: true, 
      message: 'Session started successfully', 
      transactionHash: receipt.transactionHash 
    });
  } catch (error) {
    console.error('Error starting session:', error);
    res.status(500).json({ error: 'Failed to start session', details: error.message });
  }
});

// 3. End a session
app.post('/api/sessions/end', async (req, res) => {
  try {
    const { sessionId, rewardAmount } = req.body;
    
    if (!sessionId || rewardAmount === undefined) {
      return res.status(400).json({ error: 'Session ID and reward amount are required' });
    }
    
    const tx = await contract.endSession(sessionId, BigInt(rewardAmount));
    const receipt = await tx.wait();
    
    res.status(200).json({ 
      success: true, 
      message: 'Session ended successfully', 
      transactionHash: receipt.transactionHash 
    });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ error: 'Failed to end session', details: error.message });
  }
});

// 4. Cancel a session
app.post('/api/sessions/cancel', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    const tx = await contract.cancelSession(sessionId);
    const receipt = await tx.wait();
    
    res.status(200).json({ 
      success: true, 
      message: 'Session cancelled successfully', 
      transactionHash: receipt.transactionHash 
    });
  } catch (error) {
    console.error('Error cancelling session:', error);
    res.status(500).json({ error: 'Failed to cancel session', details: error.message });
  }
});

// 5. Get user sessions
app.get('/api/users/:address/sessions', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address) {
      return res.status(400).json({ error: 'User address is required' });
    }
    
    const sessions = await contract.getUserSessions(address);
    
    res.status(200).json({ 
      success: true, 
      sessions
    });
  } catch (error) {
    console.error('Error fetching user sessions:', error);
    res.status(500).json({ error: 'Failed to fetch user sessions', details: error.message });
  }
});

// 6. Get spot owner sessions
app.get('/api/spotowners/:address/sessions', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address) {
      return res.status(400).json({ error: 'Spot owner address is required' });
    }
    
    const sessions = await contract.getSpotOwnerSessions(address);
    
    res.status(200).json({ 
      success: true, 
      sessions
    });
  } catch (error) {
    console.error('Error fetching spot owner sessions:', error);
    res.status(500).json({ error: 'Failed to fetch spot owner sessions', details: error.message });
  }
});

// 7. Get session details
app.get('/api/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    const sessionDetails = await contract.getSessionDetails(sessionId);
    const statusMap = ['RESERVED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];
    
    const formattedSession = {
      sessionId: sessionDetails.sessionId,
      user: sessionDetails.user,
      spotOwner: sessionDetails.spotOwner,
      parkingMeterDid: sessionDetails.parkingMeterDid,
      startTime: new Date(Number(sessionDetails.startTime) * 1000).toISOString(),
      endTime: new Date(Number(sessionDetails.endTime) * 1000).toISOString(),
      reservationTime: new Date(Number(sessionDetails.reservationTime) * 1000).toISOString(),
      rewardAmount: sessionDetails.rewardAmount.toString(),
      status: statusMap[sessionDetails.status] || 'UNKNOWN'
    };
    
    res.status(200).json({ 
      success: true, 
      session: formattedSession
    });
  } catch (error) {
    console.error('Error fetching session details:', error);
    res.status(500).json({ error: 'Failed to fetch session details', details: error.message });
  }
});


// 8. Get spot owner's earliest future reserved session ID
app.get('/api/spotowners/:address/earliest-future-session-id', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address) {
      return res.status(400).json({ error: 'Spot owner address is required' });
    }
    const sessions = await contract.getSpotOwnerSessions(address);
    
    if (!sessions || sessions.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'No sessions found for this spot owner'
      });
    }
    const statusMap = ['RESERVED', 'ACTIVE', 'COMPLETED', 'CANCELLED']
    
    const currentTime = BigInt(Math.floor(Date.now() / 1000));
    let earliestSessionId = null;
    let earliestTime = null;
    for (const sessionId of sessions) {
      const sessionDetails = await contract.getSessionDetails(sessionId);
      if (statusMap[sessionDetails.status] === 'RESERVED' && sessionDetails.startTime > currentTime) {
        if (earliestTime === null || sessionDetails.startTime < earliestTime) {
          earliestTime = sessionDetails.startTime;
          earliestSessionId = sessionId;
        }
      }
    }

    if (!earliestSessionId) {
      return res.status(404).json({ 
        success: false, 
        message: 'No future reserved sessions found for this spot owner'
      });
    }
    
    res.status(200).json({ 
      success: true, 
      sessionId: earliestSessionId
    });
  } catch (error) {
    console.error('Error fetching earliest future reserved session ID:', error);
    res.status(500).json({ 
      error: 'Failed to fetch earliest future reserved session ID', 
      details: error.message 
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
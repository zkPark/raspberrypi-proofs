import express from 'express';
import cors from 'cors';
import { UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";
import { compile_program, createFileManager } from "@noir-lang/noir_wasm";
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

async function initializeACVMAndNoirC() {
  const acvmModule = await import('@noir-lang/acvm_js');
  const noircModule = await import('@noir-lang/noirc_abi');
  
  console.log("ACVM and NoirC modules initialized");
  return { acvmModule, noircModule };
}

async function getCircuit(circuitName) {
  const circuitPath = path.resolve(__dirname, `./circuit/${circuitName}`);
  const fm = createFileManager(circuitPath);
  const compiledCode = await compile_program(fm);
  return compiledCode;
}

let sessionCircuit;
let sessionBackend;
let leaseCircuit;
let leaseBackend;

async function initializeCircuits() {
  try {
    await initializeACVMAndNoirC();
    console.log("Compiling session circuit...");
    const { program: sessionProgram } = await getCircuit('session');
    sessionCircuit = new Noir(sessionProgram);
    sessionBackend = new UltraHonkBackend(sessionProgram.bytecode);
    console.log("Session circuit initialized successfully");

    console.log("Compiling lease circuit...");
    const { program: leaseProgram } = await getCircuit('lease');
    leaseCircuit = new Noir(leaseProgram);
    leaseBackend = new UltraHonkBackend(leaseProgram.bytecode);
    console.log("Lease circuit initialized successfully");
  } catch (error) {
    console.error("Error initializing circuits:", error);
    throw error;
  }
}

app.post('/session_start', async (req, res) => {
  try {
    const { start_time, slot_id, session_commitment } = req.body;
    
    if (!start_time || !slot_id || !session_commitment) {
      return res.status(400).json({ 
        error: 'Missing required parameters: start_time, slot_id, and session_commitment are required' 
      });
    }

    console.log("Generating witness for session start...");
    const { witness } = await sessionCircuit.execute({ 
      start_time, 
      slot_id, 
      session_commitment,
      end_time: 0,
      price_per_minute: 0,
      total_reward: 0,
      session_id: new Array(32).fill(0),
      is_start_session: true
    });

    console.log("Generating proof for session start...");
    const proof = await sessionBackend.generateProof(witness);

    console.log("Verifying proof for session start...");
    const isValid = await sessionBackend.verifyProof(proof);
    console.log(`Session start proof is ${isValid ? "valid" : "invalid"}`);

    res.json({
      proof: proof.proof,
      publicInputs: proof.publicInputs,
      isValid
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: 'Failed to generate or verify proof for session start' });
  }
});

app.post('/session_end', async (req, res) => {
  try {
    const { 
      start_time, 
      end_time, 
      price_per_minute, 
      slot_id,
      total_reward, 
      session_id
    } = req.body;
    
    if (!start_time || !end_time || !price_per_minute || !slot_id || !total_reward || !session_id) {
      return res.status(400).json({ 
        error: 'Missing required parameters for session end' 
      });
    }

    console.log("Generating witness for session end...");
    const { witness } = await sessionCircuit.execute({ 
      start_time, 
      end_time,
      price_per_minute,
      slot_id,
      total_reward,
      session_id,
      session_commitment: new Array(32).fill(0),
      is_start_session: false
    });

    console.log("Generating proof for session end...");
    const proof = await sessionBackend.generateProof(witness);

    console.log("Verifying proof for session end...");
    const isValid = await sessionBackend.verifyProof(proof);
    console.log(`Session end proof is ${isValid ? "valid" : "invalid"}`);

    res.json({
      proof: proof.proof,
      publicInputs: proof.publicInputs,
      isValid
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: 'Failed to generate or verify proof for session end' });
  }
});

app.post('/verify_full_lease', async (req, res) => {
  try {
    const { 
      lease_bytes,
      address_bytes,
      lease_start,
      lease_end,
      expected_lease_hash,
      expected_address_hash,
      current_date
    } = req.body;
    
    if (!lease_bytes || !address_bytes || lease_start === undefined || 
        lease_end === undefined || !expected_lease_hash || 
        !expected_address_hash || current_date === undefined) {
      return res.status(400).json({ 
        error: 'Missing required parameters for lease verification' 
      });
    }

    console.log("Generating witness for full lease verification...");
    const { witness } = await leaseCircuit.execute({ 
      lease_bytes,
      address_bytes,
      lease_start,
      lease_end,
      expected_lease_hash,
      expected_address_hash,
      current_date,
      full_verification: true
    });

    console.log("Generating proof for full lease verification...");
    const proof = await leaseBackend.generateProof(witness);

    console.log("Verifying proof for full lease verification...");
    const isValid = await leaseBackend.verifyProof(proof);
    console.log(`Full lease verification proof is ${isValid ? "valid" : "invalid"}`);

    res.json({
      proof: proof.proof,
      publicInputs: proof.publicInputs,
      isValid
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: 'Failed to generate or verify proof for full lease verification' });
  }
});

app.post('/verify_address', async (req, res) => {
  try {
    const { 
      address_bytes,
      expected_address_hash
    } = req.body;
    
    if (!address_bytes || !expected_address_hash) {
      return res.status(400).json({ 
        error: 'Missing required parameters: address_bytes and expected_address_hash are required' 
      });
    }

    console.log("Generating witness for address verification...");
    const { witness } = await leaseCircuit.execute({ 
      address_bytes,
      expected_address_hash,
      lease_bytes: new Array(128).fill(0),
      lease_start: 0,
      lease_end: 0,
      expected_lease_hash: new Array(32).fill(0),
      current_date: 0,
      full_verification: false
    });

    console.log("Generating proof for address verification...");
    const proof = await leaseBackend.generateProof(witness);

    console.log("Verifying proof for address verification...");
    const isValid = await leaseBackend.verifyProof(proof);
    console.log(`Address verification proof is ${isValid ? "valid" : "invalid"}`);

    res.json({
      proof: proof.proof,
      publicInputs: proof.publicInputs,
      isValid
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: 'Failed to generate or verify proof for address verification' });
  }
});


app.post('/verify_session', async (req, res) => {
  try {
    const { proof, publicInputs } = req.body;
    
    if (!proof || !publicInputs) {
      return res.status(400).json({ error: 'Proof and publicInputs are required' });
    }

    console.log("Verifying session proof...");
    const isValid = await sessionBackend.verifyProof({ proof, publicInputs });
    console.log(`Session proof is ${isValid ? "valid" : "invalid"}`);

    res.json({ isValid });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: 'Failed to verify session proof' });
  }
});

app.post('/verify_lease', async (req, res) => {
  try {
    const { proof, publicInputs } = req.body;
    
    if (!proof || !publicInputs) {
      return res.status(400).json({ error: 'Proof and publicInputs are required' });
    }

    console.log("Verifying lease proof...");
    const isValid = await leaseBackend.verifyProof({ proof, publicInputs });
    console.log(`Lease proof is ${isValid ? "valid" : "invalid"}`);

    res.json({ isValid });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: 'Failed to verify lease proof' });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    services: {
      session_circuit: !!sessionCircuit,
      lease_circuit: !!leaseCircuit
    }
  });
});

initializeCircuits().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(error => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
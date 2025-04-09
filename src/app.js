// app.js - Combined API Server for Ethereum Operations
require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');

// Import all modules
const { generateAddresses, findSimilarAddresses } = require('./address-generator');
const { collectAddresses } = require('./collect-addresses');
const { sendMultipleTransactions } = require('./multi-sender');
const { startMonitoring, stopMonitoring } = require('./address-monitor');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// 1. Generate Random Addresses API
app.post('/api/addresses/generate', async (req, res) => {
  try {
    const { count = 100, prefixLength = 4, suffixLength = 4 } = req.body;
    
    console.log(`API request to generate ${count} addresses`);
    
    // Generate addresses
    const generatedAddresses = await generateAddresses(count, prefixLength, suffixLength);
    
    res.status(200).json({
      success: true,
      count: generatedAddresses.length,
      addresses: generatedAddresses.slice(0, 10), // Return first 10 as preview
      message: `Generated ${generatedAddresses.length} addresses successfully`
    });
  } catch (error) {
    console.error('Error in /api/addresses/generate:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 2. Find Similar Addresses API
app.get('/api/addresses/similar/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { 
      matchType = 'both',
      limit = 10,
      prefixLength = 4,
      suffixLength = 4,
      includePrivateKeys = false,
      excludeTarget = true
    } = req.query;
    
    console.log(`API request to find addresses similar to ${address}`);
    
    // Find similar addresses
    const similarAddresses = await findSimilarAddresses(address, {
      matchType,
      limit: parseInt(limit),
      prefixLength: parseInt(prefixLength),
      suffixLength: parseInt(suffixLength),
      includePrivateKeys: includePrivateKeys === 'true',
      excludeTarget: excludeTarget === 'true'
    });
    
    res.status(200).json({
      success: true,
      count: similarAddresses.length,
      matchType,
      targetAddress: address,
      addresses: similarAddresses,
      message: `Found ${similarAddresses.length} similar addresses`
    });
  } catch (error) {
    console.error('Error in /api/addresses/similar:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 3. Monitor Address Transactions API
app.post('/api/monitor/start', async (req, res) => {
  try {
    const { addresses, telegramChatId, options = {} } = req.body;
    
    console.log(`Starting monitoring for ${addresses.length} addresses...`);
    const monitoringId = await startMonitoring(addresses, telegramChatId, options);
    
    res.status(200).json({ 
      success: true, 
      monitoringId,
      message: `Started monitoring ${addresses.length} addresses`
    });
  } catch (error) {
    console.error('Error in /api/monitor/start:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Stop monitoring endpoint
app.post('/api/monitor/stop', async (req, res) => {
  try {
    const { monitoringId } = req.body;
    
    console.log(`Stopping monitoring session ${monitoringId}...`);
    const result = await stopMonitoring(monitoringId);
    
    res.status(200).json({ 
      success: true, 
      message: `Stopped monitoring session ${monitoringId}`
    });
  } catch (error) {
    console.error('Error in /api/monitor/stop:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 4. Collect Addresses from Etherscan API
app.post('/api/collect', async (req, res) => {
  try {
    const { limit = 100 } = req.body;
    
    console.log(`Collecting up to ${limit} Ethereum addresses...`);
    const addresses = await collectAddresses(limit);
    
    res.status(200).json({ 
      success: true, 
      count: addresses.length,
      addresses: addresses,  // Only return first 10 for preview
      message: `Collected ${addresses.length} addresses successfully`
    });
  } catch (error) {
    console.error('Error in /api/collect:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 5. Send Transactions to Multiple Addresses API
app.post('/api/send-transactions', async (req, res) => {
  try {
    const { addresses, amountEth, privateKey } = req.body;
    
    console.log(`Sending ${amountEth} ETH to ${addresses.length} addresses...`);
    const results = await sendMultipleTransactions(addresses, parseFloat(amountEth), privateKey);
    
    res.status(200).json({ 
      success: true, 
      transactions: results,
      message: `Sent transactions to ${addresses.length} addresses`
    });
  } catch (error) {
    console.error('Error in /api/send-transactions:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
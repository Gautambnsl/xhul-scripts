// collect-addresses.js - Collects Ethereum addresses from Etherscan
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Get API key from environment
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const DATA_DIR = process.env.DATA_DIR || './data';

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Collects Ethereum addresses from Etherscan
 * @param {number} limit - Maximum number of addresses to collect
 * @returns {Promise<string[]>} Array of Ethereum addresses
 */
async function collectAddresses(limit = 100) {
  // Input validation
  if (isNaN(limit) || limit <= 0) {
    throw new Error('Limit must be a positive number');
  }
  
  if (!ETHERSCAN_API_KEY) {
    throw new Error('ETHERSCAN_API_KEY environment variable is required');
  }
  
  const addressSet = new Set();
  
  try {
    console.log('Starting address collection...');
    
    // 1. Collect top ETH accounts by balance
    console.log('Fetching top ETH accounts by balance...');
    const topAccountsResponse = await axios.get(
      `https://api.etherscan.io/api?module=account&action=balance&address=0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae&tag=latest&apikey=${ETHERSCAN_API_KEY}`
    );
    
    // Verify API response
    if (topAccountsResponse.data.status !== '1') {
      console.warn(`Etherscan API warning: ${topAccountsResponse.data.message}`);
    }
    
    // 2. Get transactions from recent blocks
    console.log('Fetching latest block number...');
    const latestBlockResponse = await axios.get(
      `https://api.etherscan.io/api?module=proxy&action=eth_blockNumber&apikey=${ETHERSCAN_API_KEY}`
    );
    
    if (!latestBlockResponse.data.result) {
      throw new Error('Failed to get latest block number from Etherscan');
    }
    
    const blockNumber = parseInt(latestBlockResponse.data.result, 16);
    console.log(`Latest block: ${blockNumber}`);
    
    // Collect addresses from the last 5 blocks or fewer based on limit
    const blocksToFetch = Math.min(5, Math.ceil(limit / 20));
    
    for (let i = 0; i < blocksToFetch; i++) {
      const targetBlock = blockNumber - i;
      console.log(`Fetching transactions from block ${targetBlock}...`);
      
      const blockResponse = await axios.get(
        `https://api.etherscan.io/api?module=proxy&action=eth_getBlockByNumber&tag=0x${targetBlock.toString(16)}&boolean=true&apikey=${ETHERSCAN_API_KEY}`
      );
      
      if (!blockResponse.data.result) {
        console.warn(`Unable to fetch data for block ${targetBlock}, skipping`);
        continue;
      }
      
      // Extract addresses from transactions
      blockResponse.data.result.transactions.forEach(tx => {
        if (tx.from) addressSet.add(tx.from.toLowerCase());
        if (tx.to) addressSet.add(tx.to.toLowerCase());
        
        // Break early if we've reached the limit
        if (addressSet.size >= limit) return;
      });
      
      // Check if we've reached the desired count
      if (addressSet.size >= limit) break;
      
      // Respect Etherscan API rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // 3. Get top tokens
    if (addressSet.size < limit) {
      console.log('Fetching top token accounts...');
      const topTokenResponse = await axios.get(
        `https://api.etherscan.io/api?module=account&action=tokentx&address=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2&page=1&offset=100&sort=asc&apikey=${ETHERSCAN_API_KEY}`
      );
      
      if (topTokenResponse.data.status === '1' && topTokenResponse.data.result) {
        topTokenResponse.data.result.forEach(tx => {
          if (tx.from) addressSet.add(tx.from.toLowerCase());
          if (tx.to) addressSet.add(tx.to.toLowerCase());
          
          // Break early if we've reached the limit
          if (addressSet.size >= limit) return;
        });
      }
    }
    
    // Convert Set to Array
    const allAddresses = [...addressSet].slice(0, limit);
    
    // Save to file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(DATA_DIR, `eth_addresses_${timestamp}.json`);
    fs.writeFileSync(filePath, JSON.stringify(allAddresses, null, 2));
    
    console.log(`Collected ${allAddresses.length} Ethereum addresses and saved to ${filePath}`);
    return allAddresses;
  } catch (error) {
    console.error('Error collecting addresses:', error);
    throw new Error(`Address collection failed: ${error.message}`);
  }
}

// // Execute the function if running directly
// if (require.main === module) {
//   collectAddresses()
//     .then(addresses => console.log(`Collected ${addresses.length} addresses.`))
//     .catch(error => console.error(error));
// }

module.exports = { collectAddresses };


//collectAddresses();


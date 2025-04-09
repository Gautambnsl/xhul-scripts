// multi-sender.js - Send ETH transactions to multiple addresses
require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Get configuration from environment
const INFURA_API_KEY = process.env.INFURA_API_KEY;
const NETWORK = process.env.NETWORK || 'mainnet';
const DATA_DIR = process.env.DATA_DIR || './data';

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Sends ETH to multiple addresses
 * @param {string[]} recipientAddresses - Array of recipient addresses
 * @param {number} amountEthPerAddress - Amount in ETH to send to each address
 * @param {string} privateKey - Private key for sending wallet
 * @param {Object} options - Additional options
 * @returns {Promise<Array>} Transaction results
 */
async function sendMultipleTransactions(recipientAddresses, amountEthPerAddress, privateKey, options = {}) {
  // Default options
  const opts = {
    network: options.network || NETWORK,
    gasLimit: options.gasLimit || 21000,
    priorityFee: options.priorityFee || 1.5, // gwei
    maxFeePerGas: options.maxFeePerGas || null, // Will be calculated if null
    nonce: options.nonce || null, // Will be fetched if null
    saveToFile: options.saveToFile !== false,
    dryRun: options.dryRun || false, // If true, don't actually send transactions
    concurrentTx: options.concurrentTx || 1 // Number of concurrent transactions
  };


  console.log("try consoling dry ruh value",opts)
  
  // Validate input
  if (!Array.isArray(recipientAddresses) || recipientAddresses.length === 0) {
    throw new Error('Recipient addresses must be a non-empty array');
  }
  
  if (isNaN(amountEthPerAddress) || amountEthPerAddress <= 0) {
    throw new Error('Amount must be a positive number');
  }
  
  if (!privateKey) {
    throw new Error('Private key is required');
  }
  
  if (!INFURA_API_KEY) {
    throw new Error('INFURA_API_KEY environment variable is required');
  }
  
  // Normalize network name for provider URL
  const networkName = opts.network === 'mainnet' ? 'mainnet' : opts.network;
  const provider = new ethers.providers.JsonRpcProvider(
    `https://${networkName}.infura.io/v3/${INFURA_API_KEY}`
  );
  
  // Create wallet
  const wallet = new ethers.Wallet(privateKey, provider);
  const walletAddress = wallet.address;
  
  console.log(`Using wallet: ${walletAddress}`);
  console.log(`Network: ${networkName}`);
  console.log(`Sending ${amountEthPerAddress} ETH to ${recipientAddresses.length} addresses...`);
  
  if (opts.dryRun) {
    console.log('🔔 DRY RUN MODE - No transactions will be sent');
  }
  
  // Calculate total ETH required
  const amountWei = ethers.utils.parseEther(amountEthPerAddress.toString());
  const totalEthRequired = amountWei.mul(recipientAddresses.length);
  
  // Check wallet balance
  const balance = await wallet.getBalance();
  console.log(`Wallet balance: ${ethers.utils.formatEther(balance)} ETH`);
  console.log(`Required balance: ${ethers.utils.formatEther(totalEthRequired)} ETH`);
  
  if (balance.lt(totalEthRequired) && !opts.dryRun) {
    throw new Error(`Insufficient balance. Have ${ethers.utils.formatEther(balance)} ETH, need ${ethers.utils.formatEther(totalEthRequired)} ETH`);
  }
  
  // Get current gas prices
  const feeData = await provider.getFeeData();
  
  // Calculate gas costs
  let maxFeePerGas = opts.maxFeePerGas 
    ? ethers.utils.parseUnits(opts.maxFeePerGas.toString(), 'gwei')
    : feeData.maxFeePerGas;
    
  const maxPriorityFeePerGas = ethers.utils.parseUnits(
    opts.priorityFee.toString(), 
    'gwei'
  );
  
  console.log(`Current gas price settings:`);
  console.log(`- Max fee per gas: ${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} gwei`);
  console.log(`- Priority fee: ${ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei')} gwei`);
  
  // Get starting nonce
  let nonce = opts.nonce !== null 
    ? opts.nonce 
    : await wallet.getTransactionCount();
  
  console.log(`Starting nonce: ${nonce}`);
  
  // Process transactions
  const results = [];
  const promises = [];
  
  for (let i = 0; i < recipientAddresses.length; i++) {
    const recipient = recipientAddresses[i];
    
    // Validate address
    if (!ethers.utils.isAddress(recipient)) {
      console.warn(`Invalid address: ${recipient}, skipping`);
      results.push({
        recipient,
        status: 'Failed',
        error: 'Invalid address format'
      });
      continue;
    }
    
    // Create transaction object
    const txData = {
      to: recipient,
      value: amountWei,
      nonce: nonce + i,
      maxFeePerGas,
      maxPriorityFeePerGas,
      gasLimit: opts.gasLimit,
      type: 2 // EIP-1559 transaction
    };
    
    // Store transaction data
    const txInfo = {
      recipient,
      nonce: txData.nonce,
      value: ethers.utils.formatEther(amountWei),
      maxFeePerGas: ethers.utils.formatUnits(maxFeePerGas, 'gwei'),
      maxPriorityFeePerGas: ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei'),
      status: 'Pending'
    };
    
    results.push(txInfo);
    
    // Function to process a single transaction
    const processTx = async () => {
      try {
        console.log(`[${i+1}/${recipientAddresses.length}] Preparing transaction to ${recipient} (nonce: ${txData.nonce})`);
        
        if (opts.dryRun) {
          // Simulate transaction
          txInfo.status = 'Simulated';
          txInfo.gasEstimate = (await provider.estimateGas(txData)).toString();
          console.log(`  Simulation successful - Gas estimate: ${txInfo.gasEstimate}`);
          return;
        }
        
        // Send transaction
        const tx = await wallet.sendTransaction(txData);
        console.log(`  Transaction sent: ${tx.hash}`);
        
        txInfo.txHash = tx.hash;
        
        // Wait for transaction to be mined
        const receipt = await tx.wait();
        console.log(`  Transaction confirmed in block ${receipt.blockNumber}`);
        
        txInfo.blockNumber = receipt.blockNumber;
        txInfo.gasUsed = receipt.gasUsed.toString();
        txInfo.effectiveGasPrice = ethers.utils.formatUnits(receipt.effectiveGasPrice, 'gwei');
        txInfo.status = receipt.status === 1 ? 'Success' : 'Failed';
      } catch (error) {
        console.error(`  Error sending to ${recipient}:`, error.message);
        txInfo.status = 'Failed';
        txInfo.error = error.message;
      }
    };
    
    // Add to promises queue, respect concurrency limit
    if (opts.concurrentTx > 1) {
      promises.push(processTx());
      
      // Wait for batch to complete if we hit the concurrency limit
      if (promises.length >= opts.concurrentTx || i === recipientAddresses.length - 1) {
        await Promise.all(promises);
        promises.length = 0; // Clear the array
      }
    } else {
      // Process sequentially
      await processTx();
    }
  }
  
  // Make sure all transactions are complete
  if (promises.length > 0) {
    await Promise.all(promises);
  }
  
  // Save results to file
  if (opts.saveToFile) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(DATA_DIR, `tx_results_${timestamp}.json`);
    fs.writeFileSync(filePath, JSON.stringify(results, null, 2));
    console.log(`Transaction results saved to ${filePath}`);
  }
  
  // Summary
  const successful = results.filter(r => r.status === 'Success' || r.status === 'Simulated').length;
  const failed = results.length - successful;
  
  console.log(`\nTransaction summary:`);
  console.log(`- Total: ${results.length}`);
  console.log(`- Successful: ${successful}`);
  console.log(`- Failed: ${failed}`);
  
  if (opts.dryRun) {
    console.log('🔔 This was a dry run - No transactions were actually sent');
  }
  
  return results;
}

// // Execute if running directly
// if (require.main === module) {
//   // Parse command line arguments if present
//   const privateKey = process.env.WALLET_PRIVATE_KEY;
  
//   if (!privateKey) {
//     console.error('Error: WALLET_PRIVATE_KEY environment variable is required');
//     process.exit(1);
//   }
  
//   // Example addresses - replace with actual addresses from file in real use
//   const addresses = [
//     '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
//     '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199'
//   ];
  
//   // Send 0.001 ETH to each address
//   sendMultipleTransactions(addresses, 0.001, privateKey, { dryRun: true })
//     .catch(error => console.error('Error:', error.message));
// }

module.exports = { sendMultipleTransactions };



//sendMultipleTransactions(["0xA92ea390D2Cd54239050b9ea044BB02690CF27F8"],0.1,"3526eaf177d58190847a6997d63b67d270f6a2ff341df56f29fc9fd157268324",{network : "optimism-sepolia"});
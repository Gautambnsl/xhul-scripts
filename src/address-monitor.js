// address-monitor.js - Monitor addresses for incoming transactions

require('dotenv').config();
const { ethers } = require('ethers');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INFURA_API_KEY = process.env.INFURA_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const NETWORK = process.env.NETWORK || 'mainnet';
const DATA_DIR = process.env.DATA_DIR || './data';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const activeSessions = {};

async function sendTelegramNotification(chatId, title, message) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !(chatId || TELEGRAM_CHAT_ID)) {
      console.error('Telegram config missing.');
      return false;
    }

    const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId || TELEGRAM_CHAT_ID,
      text: `${title}\n\n${message}`,
      parse_mode: 'Markdown',
    });

    if (response.data.ok) {
      console.log(`Telegram notification sent: ${response.data.result.message_id}`);
      return true;
    } else {
      console.error('Telegram error:', response.data);
      return false;
    }
  } catch (error) {
    console.error('Telegram error:', error.message);
    return false;
  }
}

function getExplorerUrl(network, txHash) {
  const urls = {
    optimism: 'https://optimistic.etherscan.io',
    'optimism-goerli': 'https://goerli-optimism.etherscan.io',
    'optimism-sepolia': 'https://sepolia-optimism.etherscan.io',
    arbitrum: 'https://arbiscan.io',
    polygon: 'https://polygonscan.com',
    sepolia: 'https://sepolia.etherscan.io',
    goerli: 'https://goerli.etherscan.io',
    mainnet: 'https://etherscan.io',
  };
  return `${urls[network] || urls.mainnet}/tx/${txHash}`;
}

async function startMonitoring(addresses, telegramChatId = TELEGRAM_CHAT_ID, options = {}) {
  const opts = {
    network: options.network || NETWORK,
    minValue: options.minValue || 0,
    saveTransactions: options.saveTransactions !== false,
    includeOutgoing: options.includeOutgoing || false,
    pollingInterval: options.pollingInterval || 15000,
  };

  if (!INFURA_API_KEY) throw new Error('Missing INFURA_API_KEY');
  if (!Array.isArray(addresses) || addresses.length === 0) throw new Error('No addresses provided');

  const sessionId = crypto.randomUUID();
  const watchAddresses = new Set(
    addresses
      .map((addr) => {
        if (!ethers.utils.isAddress(addr)) {
          console.warn(`Invalid address: ${addr}`);
          return null;
        }
        return addr.toLowerCase();
      })
      .filter(Boolean)
  );

  const provider = new ethers.providers.JsonRpcProvider(`https://${opts.network}.infura.io/v3/${INFURA_API_KEY}`);
  const processedTxs = new Set();
  let lastProcessedBlock = await provider.getBlockNumber();
  console.log(`[${sessionId}] Monitoring started from block ${lastProcessedBlock}`);

  let logStream = null;
  if (opts.saveTransactions) {
    const logFile = path.join(DATA_DIR, `tx_monitor_${sessionId}_${Date.now()}.jsonl`);
    logStream = fs.createWriteStream(logFile, { flags: 'a' });
    console.log(`[${sessionId}] Logging to ${logFile}`);
  }

  await sendTelegramNotification(
    telegramChatId,
    '📡 Monitoring Started',
    `Monitoring ${watchAddresses.size} address(es) on *${opts.network}*.\nSession ID: \`${sessionId}\``
  );

  const pollInterval = setInterval(async () => {
    try {
      const currentBlock = await provider.getBlockNumber();
      if (currentBlock <= lastProcessedBlock) return;

      for (let i = lastProcessedBlock + 1; i <= currentBlock; i++) {
        const block = await provider.getBlockWithTransactions(i);
        if (!block || !block.transactions.length) continue;

        for (const tx of block.transactions) {
          if (processedTxs.has(tx.hash)) continue;
          processedTxs.add(tx.hash);

          const isIncoming = tx.to && watchAddresses.has(tx.to.toLowerCase());
          const isOutgoing = tx.from && watchAddresses.has(tx.from.toLowerCase());

          if (!isIncoming && !(isOutgoing && opts.includeOutgoing)) continue;

          const ethValue = parseFloat(ethers.utils.formatEther(tx.value));
          if (ethValue < opts.minValue) continue;

          const type = isIncoming && isOutgoing
            ? 'Internal Tx'
            : isIncoming
              ? 'Incoming'
              : 'Outgoing';

          console.log(`[${sessionId}] ${type} | From: ${tx.from} To: ${tx.to} | ${ethValue} ETH`);

          if (logStream) {
            logStream.write(JSON.stringify({
              timestamp: new Date().toISOString(),
              hash: tx.hash,
              from: tx.from,
              to: tx.to,
              value: ethValue,
              blockNumber: i,
              type,
            }) + '\n');
          }

          await sendTelegramNotification(
            telegramChatId,
            `🔔 ${type} Tx Detected`,
            `From: \`${tx.from}\`\nTo: \`${tx.to}\`\nValue: *${ethValue} ETH*\n[View on Explorer](${getExplorerUrl(opts.network, tx.hash)})`
          );
        }
      }

      lastProcessedBlock = currentBlock;
      if (processedTxs.size > 1000) processedTxs.clear();
    } catch (err) {
      console.error(`[${sessionId}] Polling error:`, err.message);
    }
  }, opts.pollingInterval);

  activeSessions[sessionId] = {
    provider,
    addresses: Array.from(watchAddresses),
    telegramChatId,
    startTime: new Date().toISOString(),
    network: opts.network,
    logStream,
    pollInterval,
  };

  return sessionId;
}

async function stopMonitoring(sessionId) {
  const session = activeSessions[sessionId];
  if (!session) throw new Error(`Session ${sessionId} not found`);

  clearInterval(session.pollInterval);
  session.logStream?.end();

  await sendTelegramNotification(
    session.telegramChatId,
    '🛑 Monitoring Stopped',
    `Monitoring session \`${sessionId}\` stopped after ${timeSince(new Date(session.startTime))}.`
  );

  delete activeSessions[sessionId];
  return true;
}

function timeSince(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

module.exports = {
  startMonitoring,
  stopMonitoring
};


//startMonitoring(["0xb974C9Aaf445ba8ABEe973E36781F658c98743Fa"], "860473460", {network: "optimism-sepolia"});
// address-generator.js - Generate random Ethereum addresses and store in MongoDB
require('dotenv').config();
const { ethers } = require('ethers');
const mongoose = require('mongoose');

// MongoDB connection string
const MONGODB_URI = process.env.MONGODB_URI;
console.log(MONGODB_URI);

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Define Address schema
const addressSchema = new mongoose.Schema({
  address: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true
  },
  privateKey: {
    type: String,
    required: true
  },
  prefix: {
    type: String,
    required: true,
    index: true
  },
  suffix: {
    type: String,
    required: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Address = mongoose.model('Address', addressSchema);

/**
 * Generate random Ethereum addresses and save to MongoDB
 */
async function generateAddresses(count = 100, prefixLength = 4, suffixLength = 4) {
  console.log(`Generating ${count} random Ethereum addresses...`);

  const addresses = [];
  const startTime = Date.now();

  for (let i = 0; i < count; i++) {
    const wallet = ethers.Wallet.createRandom();
    const address = wallet.address.toLowerCase();
    const privateKey = wallet.privateKey;
    const prefix = address.substring(2, 2 + prefixLength);
    const suffix = address.substring(42 - suffixLength);

    const addressDoc = new Address({
      address,
      privateKey,
      prefix,
      suffix
    });

    try {
      await addressDoc.save();

      addresses.push({
        address,
        prefix,
        suffix
      });

      if ((i + 1) % 10 === 0 || i === count - 1) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = (i + 1) / elapsed;
        console.log(`Generated ${i + 1}/${count} addresses (${rate.toFixed(2)}/sec)`);
      }
    } catch (error) {
      if (error.code === 11000) {
        console.warn(`Duplicate address ${address} generated, skipping.`);
        i--; // Try again
      } else {
        console.error(`Error saving address ${address}:`, error);
      }
    }
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`Generated ${addresses.length} addresses in ${totalTime.toFixed(2)} seconds.`);
  return addresses;
}

/**
 * Find addresses in database that match a pattern
 */
async function findSimilarAddresses(targetAddress, options = {}) {
  const opts = {
    prefixLength: options.prefixLength || 4,
    suffixLength: options.suffixLength || 4,
    matchType: options.matchType || 'both', // 'prefix', 'suffix', or 'both'
    limit: options.limit || 10,
    includePrivateKeys: options.includePrivateKeys || false,
    excludeTarget: options.excludeTarget !== false // default true
  };

  if (!targetAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
    throw new Error('Invalid Ethereum address format');
  }

  targetAddress = targetAddress.toLowerCase();
  const targetPrefix = targetAddress.substring(2, 2 + opts.prefixLength);
  const targetSuffix = targetAddress.substring(42 - opts.suffixLength);

  console.log(`Finding addresses similar to ${targetAddress}`);
  console.log(`Target prefix: ${targetPrefix}, suffix: ${targetSuffix}, match type: ${opts.matchType}`);

  let query = {};

  if (opts.matchType === 'prefix') {
    query.prefix = targetPrefix;
  } else if (opts.matchType === 'suffix') {
    query.suffix = targetSuffix;
  } else {
    query.$or = [
      { prefix: targetPrefix },
      { suffix: targetSuffix }
    ];
  }

  if (opts.excludeTarget) {
    query.address = { $ne: targetAddress };
  }

  const projection = opts.includePrivateKeys
    ? { _id: 0, __v: 0 }
    : { _id: 0, __v: 0, privateKey: 0 };

  const similarAddresses = await Address.find(query, projection)
    .limit(opts.limit)
    .lean();

  similarAddresses.forEach(addr => {
    const matchesPrefix = addr.prefix === targetPrefix;
    const matchesSuffix = addr.suffix === targetSuffix;

    addr.similarity = matchesPrefix && matchesSuffix
      ? 'Matches both prefix and suffix'
      : matchesPrefix
        ? 'Matches prefix'
        : 'Matches suffix';
  });

  console.log(`Found ${similarAddresses.length} similar addresses.`);
  return similarAddresses;
}

/**
 * Count total addresses in database
 */
async function countAddresses() {
  return await Address.countDocuments();
}

/**
 * Get statistics about the address database
 */
async function getDBStats() {
  const totalCount = await countAddresses();
  const prefixDistribution = await Address.aggregate([
    { $project: { firstChar: { $substr: ["$prefix", 0, 1] } } },
    { $group: { _id: "$firstChar", count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);

  return {
    totalAddresses: totalCount,
    prefixDistribution: prefixDistribution.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {})
  };
}

module.exports = {
  generateAddresses,
  findSimilarAddresses,
  countAddresses,
  getDBStats
};

//Example direct usage (for testing only):
// findSimilarAddresses("0x5b464a47f4de9c2afd537182d5ae976e1c1a707c", { excludeTarget: true })
//   .then(console.log)
//   .catch(console.error);

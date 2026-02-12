require('dotenv').config();

const express = require('express');
const { MongoClient } = require('mongodb');
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB setup
const mongoClient = new MongoClient(process.env.MONGODB_URI);
let db;

// S3 Configuration
const S3_BUCKET = 'gipper-static-assets';
const S3_PREFIX = 'default_presets_update/';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

// Middleware
app.use(express.static('public'));
app.use(express.json());

/**
 * Extract objects from a preset JSON
 */
function extractObjects(json, fileName) {
  const results = [];

  function traverse(objects) {
    if (!Array.isArray(objects)) return;

    for (const obj of objects) {
      const cleanEntry = { fileName };

      for (const [key, value] of Object.entries(obj)) {
        if (key === 'objects') continue;
        if (typeof value === 'object' && value !== null) {
          cleanEntry[key] = JSON.stringify(value);
        } else {
          cleanEntry[key] = value;
        }
      }

      results.push(cleanEntry);

      if (obj.type === 'group' && obj.objects) {
        traverse(obj.objects);
      }
    }
  }

  if (json.body && json.body.objects) {
    traverse(json.body.objects);
  }

  return results;
}

/**
 * List S3 files with metadata
 */
async function listS3Files() {
  const files = [];
  let continuationToken = null;

  do {
    const command = new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: S3_PREFIX,
      ContinuationToken: continuationToken,
    });

    const response = await s3Client.send(command);

    for (const obj of response.Contents || []) {
      const key = obj.Key;
      const fileName = key.replace(S3_PREFIX, '');

      if (
        fileName.startsWith('template_') &&
        !fileName.includes('school_') &&
        fileName.endsWith('.json')
      ) {
        files.push({
          key,
          fileName,
          lastModified: obj.LastModified.toISOString(),
        });
      }
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : null;
  } while (continuationToken);

  return files;
}

/**
 * Download and parse a file from S3
 */
async function downloadFromS3(key) {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  const response = await s3Client.send(command);
  const bodyString = await response.Body.transformToString();
  return JSON.parse(bodyString);
}

/**
 * Sync from S3 to MongoDB (incremental)
 * @param {function} onProgress - callback for progress updates
 */
async function syncFromS3(onProgress = () => {}) {
  console.log('=== Starting S3 to MongoDB Sync ===');
  const startTime = Date.now();

  // Get S3 files
  onProgress({ stage: 'listing', message: 'Listing S3 files...' });
  console.log('Listing S3 files...');
  const s3Files = await listS3Files();
  console.log(`Found ${s3Files.length} files in S3`);
  onProgress({ stage: 'listing', message: `Found ${s3Files.length} files in S3` });

  // Get existing file metadata from MongoDB
  const existingFiles = await db.collection('fileMetadata').find({}).toArray();
  const existingMap = new Map(existingFiles.map((f) => [f.fileName, f]));

  // Find files to sync
  const filesToSync = [];
  const s3FileNames = new Set();

  for (const s3File of s3Files) {
    s3FileNames.add(s3File.fileName);
    const existing = existingMap.get(s3File.fileName);

    if (!existing || existing.lastModified !== s3File.lastModified) {
      filesToSync.push(s3File);
    }
  }

  // Find files to delete (in DB but not in S3)
  const filesToDelete = existingFiles
    .filter((f) => !s3FileNames.has(f.fileName))
    .map((f) => f.fileName);

  console.log(`Files to sync: ${filesToSync.length}`);
  console.log(`Files to delete: ${filesToDelete.length}`);
  console.log(`Files unchanged: ${s3Files.length - filesToSync.length}`);
  
  onProgress({ 
    stage: 'analyzing', 
    message: `Files to sync: ${filesToSync.length} | Unchanged: ${s3Files.length - filesToSync.length} | To delete: ${filesToDelete.length}` 
  });

  // Delete removed files
  if (filesToDelete.length > 0) {
    await db
      .collection('objects')
      .deleteMany({ fileName: { $in: filesToDelete } });
    await db
      .collection('fileMetadata')
      .deleteMany({ fileName: { $in: filesToDelete } });
    console.log(`Deleted ${filesToDelete.length} files`);
  }

  // Process new/changed files
  let processedCount = 0;
  let totalObjects = 0;

  for (const file of filesToSync) {
    try {
      // Delete existing objects for this file
      await db.collection('objects').deleteMany({ fileName: file.fileName });

      // Download and parse
      const json = await downloadFromS3(file.key);
      const objects = extractObjects(json, file.fileName);

      // Insert objects
      if (objects.length > 0) {
        await db.collection('objects').insertMany(objects);
      }

      // Update file metadata
      await db.collection('fileMetadata').updateOne(
        { fileName: file.fileName },
        {
          $set: {
            fileName: file.fileName,
            lastModified: file.lastModified,
            objectCount: objects.length,
            syncedAt: new Date().toISOString(),
          },
        },
        { upsert: true },
      );

      totalObjects += objects.length;
      processedCount++;

      // Send progress update every 10 files or on last file
      if (processedCount % 10 === 0 || processedCount === filesToSync.length) {
        const pct = Math.round((processedCount / filesToSync.length) * 100);
        onProgress({ 
          stage: 'syncing', 
          message: `Syncing: ${processedCount}/${filesToSync.length} files (${pct}%)`,
          processed: processedCount,
          total: filesToSync.length
        });
        console.log(`Processed ${processedCount}/${filesToSync.length} files...`);
      }
    } catch (error) {
      console.error(`Error processing ${file.fileName}:`, error.message);
    }
  }

  // Update sync metadata
  const objectCount = await db.collection('objects').countDocuments();
  const fileCount = await db.collection('fileMetadata').countDocuments();

  await db.collection('metadata').updateOne(
    { _id: 'sync' },
    {
      $set: {
        lastSync: new Date().toISOString(),
        fileCount,
        objectCount,
      },
    },
    { upsert: true },
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✓ Sync complete in ${elapsed}s`);
  console.log(`  Processed: ${processedCount} files, ${totalObjects} objects`);
  console.log(`  Total in DB: ${fileCount} files, ${objectCount} objects`);
  
  onProgress({ 
    stage: 'complete', 
    message: `✓ Sync complete in ${elapsed}s - ${processedCount} files processed`,
    elapsed
  });

  return { processedCount, totalObjects, fileCount, objectCount };
}

// API: Get status
app.get('/api/status', async (req, res) => {
  try {
    const metadata = await db.collection('metadata').findOne({ _id: 'sync' });

    res.json({
      fileCount: metadata?.fileCount || 0,
      objectCount: metadata?.objectCount || 0,
      lastSync: metadata?.lastSync || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Sync from S3 with Server-Sent Events for progress
app.get('/api/sync', async (req, res) => {
  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await syncFromS3((progress) => {
      sendEvent(progress);
    });

    sendEvent({
      stage: 'done',
      success: true,
      ...result,
      lastSync: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Sync error:', error);
    sendEvent({ stage: 'error', error: error.message });
  } finally {
    res.end();
  }
});

// Keep POST for backward compatibility
app.post('/api/sync', async (req, res) => {
  try {
    const result = await syncFromS3();

    res.json({
      success: true,
      ...result,
      lastSync: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Search objects
app.post('/api/search', async (req, res) => {
  try {
    const { filters, columns } = req.body;

    // Build MongoDB query from filters
    const query = {};

    // Helper to escape regex special characters
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Helper to parse value (handle booleans and numbers)
    const parseValue = (val) => {
      const lower = val.toLowerCase();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
      if (!isNaN(val) && val.trim() !== '') return Number(val);
      return null; // not a special type
    };

    if (filters && filters.length > 0) {
      for (const filter of filters) {
        if (filter.property && filter.value) {
          const parsedValue = parseValue(filter.value);
          
          if (filter.operator === 'exact') {
            if (parsedValue !== null) {
              // Boolean or number - exact match
              query[filter.property] = parsedValue;
            } else {
              // String - case-insensitive exact match
              const escapedValue = escapeRegex(filter.value);
              query[filter.property] = { $regex: `^${escapedValue}$`, $options: 'i' };
            }
          } else {
            // "includes" operator
            if (parsedValue !== null) {
              // Boolean/number - exact match (can't do "includes" on non-strings)
              query[filter.property] = parsedValue;
            } else {
              // String - case-insensitive contains
              const escapedValue = escapeRegex(filter.value);
              query[filter.property] = { $regex: escapedValue, $options: 'i' };
            }
          }
        }
      }
    }

    // Select columns (projection)
    const selectedColumns =
      columns && columns.length > 0
        ? columns
        : ['fileName', 'conrolTitle', 'type', 'className'];

    const projection = { _id: 0 };
    for (const col of selectedColumns) {
      projection[col] = 1;
    }

    // Execute query
    const results = await db
      .collection('objects')
      .find(query)
      .project(projection)
      .limit(10000) // Safety limit
      .toArray();

    res.json({
      count: results.length,
      columns: selectedColumns,
      results,
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
async function start() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoClient.connect();
    db = mongoClient.db('presets');
    console.log('✓ Connected to MongoDB');

    // Create indexes for faster search
    await db.collection('objects').createIndex({ fileName: 1 });
    await db
      .collection('objects')
      .createIndex({ conrolTitle: 'text', type: 'text', className: 'text' });
    console.log('✓ Indexes created');

    // Start server
    app.listen(PORT, () => {
      console.log(`\n🚀 Preset Analyzer running at http://localhost:${PORT}\n`);
    });
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

start();

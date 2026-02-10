require('dotenv').config();

const express = require('express');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 3000;

// S3 Configuration
const S3_BUCKET = 'gipper-static-assets';
const S3_PREFIX = 'default_presets_update/';

// Initialize S3 client
const s3Client = new S3Client({ 
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  } : undefined
});

// Serve static files from public folder
app.use(express.static('public'));
app.use(express.json());

// Cache for parsed data
let cache = {
  objects: [],
  fileCount: 0,
  timestamp: null,
  loading: false,
  error: null
};

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
 * Load all presets from S3
 */
async function loadFromS3() {
  if (cache.loading) {
    console.log('Already loading, skipping...');
    return;
  }

  cache.loading = true;
  cache.error = null;
  console.log('=== Loading presets from S3 ===');
  const startTime = Date.now();

  try {
    // List all matching files
    const files = [];
    let continuationToken = null;

    do {
      const command = new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: S3_PREFIX,
        ContinuationToken: continuationToken
      });

      const response = await s3Client.send(command);

      for (const obj of response.Contents || []) {
        const key = obj.Key;
        const fileName = key.replace(S3_PREFIX, '');

        // Filter: template_*, exclude school_*, .json only
        if (
          fileName.startsWith('template_') &&
          !fileName.includes('school_') &&
          fileName.endsWith('.json')
        ) {
          files.push({ key, fileName });
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : null;
      console.log(`  Found ${files.length} matching files...`);
    } while (continuationToken);

    console.log(`Total: ${files.length} files to process`);

    // Download and parse all files
    const allObjects = [];
    let processed = 0;

    for (const file of files) {
      try {
        const command = new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: file.key
        });

        const response = await s3Client.send(command);
        const bodyString = await response.Body.transformToString();
        const json = JSON.parse(bodyString);
        const objects = extractObjects(json, file.fileName);
        allObjects.push(...objects);

        processed++;
        if (processed % 500 === 0) {
          console.log(`  Processed ${processed}/${files.length} files (${allObjects.length} objects)...`);
        }
      } catch (error) {
        console.error(`Error processing ${file.fileName}:`, error.message);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✓ Loaded ${allObjects.length} objects from ${files.length} files in ${elapsed}s`);

    // Update cache
    cache.objects = allObjects;
    cache.fileCount = files.length;
    cache.timestamp = new Date().toISOString();
    cache.loading = false;

  } catch (error) {
    console.error('Failed to load from S3:', error);
    cache.error = error.message;
    cache.loading = false;
    throw error;
  }
}

/**
 * Get all unique property names from the objects
 */
function getAllPropertyNames(objects) {
  const propertySet = new Set();
  for (const obj of objects) {
    for (const key of Object.keys(obj)) {
      propertySet.add(key);
    }
  }
  return Array.from(propertySet).sort();
}

/**
 * Filter objects based on filters
 */
function filterObjects(objects, filters) {
  if (!filters || filters.length === 0) {
    return objects;
  }

  const validFilters = filters.filter(f => f.property && f.value);
  if (validFilters.length === 0) {
    return objects;
  }

  return objects.filter(obj => {
    return validFilters.every(filter => {
      const { property, value } = filter;
      const objValue = obj[property];

      if (objValue === null || objValue === undefined) {
        return false;
      }

      const strValue = String(objValue).toLowerCase();
      const searchValue = value.toLowerCase();

      return strValue.includes(searchValue);
    });
  });
}

/**
 * Select specific columns from objects
 */
function selectColumns(objects, columns) {
  if (!columns || columns.length === 0) {
    return objects;
  }

  return objects.map(obj => {
    const row = {};
    for (const col of columns) {
      row[col] = obj[col];
    }
    return row;
  });
}

// API: Get status
app.get('/api/status', (req, res) => {
  res.json({
    objectCount: cache.objects.length,
    fileCount: cache.fileCount,
    lastLoaded: cache.timestamp,
    loading: cache.loading,
    error: cache.error,
    properties: cache.objects.length > 0 ? getAllPropertyNames(cache.objects) : []
  });
});

// API: Refresh/reload data from S3
app.post('/api/refresh', async (req, res) => {
  try {
    await loadFromS3();
    res.json({
      objectCount: cache.objects.length,
      fileCount: cache.fileCount,
      lastLoaded: cache.timestamp,
      properties: getAllPropertyNames(cache.objects)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Search objects
app.post('/api/search', (req, res) => {
  const { filters, columns } = req.body;

  if (cache.objects.length === 0) {
    return res.status(503).json({ error: 'Data not loaded yet. Please wait or call /api/refresh' });
  }

  // Apply filters
  let results = filterObjects(cache.objects, filters);

  // Select columns
  const selectedColumns = columns && columns.length > 0 
    ? columns 
    : ['fileName', 'conrolTitle', 'type', 'className'];
  
  const mappedResults = selectColumns(results, selectedColumns);

  res.json({
    count: mappedResults.length,
    columns: selectedColumns,
    results: mappedResults
  });
});

// Start server and load data
app.listen(PORT, async () => {
  console.log(`\n🚀 Preset Analyzer running at http://localhost:${PORT}\n`);
  
  // Load data from S3 on startup
  try {
    await loadFromS3();
  } catch (error) {
    console.error('Initial S3 load failed. Server running but data not available.');
    console.error('Set AWS credentials and call POST /api/refresh to retry.');
  }
});

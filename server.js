const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const PRESETS_FOLDER = './default_presets_all';

// Serve static files from public folder
app.use(express.static('public'));
app.use(express.json());

// Cache for parsed data (builds on first request)
let cachedObjects = null;
let cacheTimestamp = null;

/**
 * Recursively traverse objects and extract metadata
 */
function traverseObjects(objects, fileName, results) {
  if (!Array.isArray(objects)) return;

  for (const obj of objects) {
    const controlTitle = obj.conrolTitle || obj.controlTitle || null;
    
    // Extract relevant properties
    const entry = {
      fileName,
      controlTitle,
      type: obj.type || null,
      className: obj.className || null,
      name: obj.name || null,
      id: obj.id || null,
      hasAdditionalMedia: obj.hasOwnProperty('additionalMedia'),
      hasIsAdditionalMedia: obj.hasOwnProperty('isAdditionalMedia'),
      // Store all property keys for flexible searching
      properties: Object.keys(obj)
    };

    results.push(entry);

    // Recurse into groups
    if (obj.type === 'group' && obj.objects) {
      traverseObjects(obj.objects, fileName, results);
    }
  }
}

/**
 * Load and parse all JSON files
 */
function loadAllPresets() {
  console.log('Loading presets from', PRESETS_FOLDER);
  const startTime = Date.now();
  const results = [];

  const files = fs.readdirSync(PRESETS_FOLDER)
    .filter(file => file.endsWith('.json'));

  console.log(`Found ${files.length} JSON files`);

  for (const file of files) {
    try {
      const filePath = path.join(PRESETS_FOLDER, file);
      const jsonString = fs.readFileSync(filePath, 'utf8');
      const json = JSON.parse(jsonString);

      if (json.body && json.body.objects) {
        traverseObjects(json.body.objects, file, results);
      }
    } catch (error) {
      console.error(`Error processing ${file}:`, error.message);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`Loaded ${results.length} objects from ${files.length} files in ${elapsed}s`);

  return results;
}

/**
 * Get cached objects or load them
 */
function getObjects() {
  if (!cachedObjects) {
    cachedObjects = loadAllPresets();
    cacheTimestamp = new Date().toISOString();
  }
  return cachedObjects;
}

// API: Get status
app.get('/api/status', (req, res) => {
  const objects = getObjects();
  const fileCount = new Set(objects.map(o => o.fileName)).size;
  
  res.json({
    objectCount: objects.length,
    fileCount,
    lastLoaded: cacheTimestamp
  });
});

// API: Refresh cache
app.post('/api/refresh', (req, res) => {
  cachedObjects = null;
  const objects = getObjects();
  const fileCount = new Set(objects.map(o => o.fileName)).size;
  
  res.json({
    objectCount: objects.length,
    fileCount,
    lastLoaded: cacheTimestamp
  });
});

// API: Search objects
app.post('/api/search', (req, res) => {
  const { filters, columns } = req.body;
  const objects = getObjects();

  let results = objects;

  // Apply filters
  if (filters) {
    // Filter by controlTitle contains
    if (filters.controlTitleContains && filters.controlTitleContains.length > 0) {
      const searchTerms = filters.controlTitleContains.map(t => t.toLowerCase());
      results = results.filter(obj => {
        if (!obj.controlTitle) return false;
        const title = obj.controlTitle.toLowerCase();
        return searchTerms.some(term => title.includes(term));
      });
    }

    // Filter by hasProperty
    if (filters.hasProperty && filters.hasProperty.length > 0) {
      results = results.filter(obj => {
        return filters.hasProperty.every(prop => obj.properties.includes(prop));
      });
    }

    // Filter by type
    if (filters.typeEquals && filters.typeEquals.length > 0) {
      results = results.filter(obj => filters.typeEquals.includes(obj.type));
    }
  }

  // Select only requested columns (default to all common ones)
  const selectedColumns = columns || ['controlTitle', 'type', 'className', 'fileName'];
  
  const mappedResults = results.map(obj => {
    const row = {};
    for (const col of selectedColumns) {
      row[col] = obj[col];
    }
    return row;
  });

  res.json({
    count: mappedResults.length,
    columns: selectedColumns,
    results: mappedResults
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Preset Analyzer running at http://localhost:${PORT}\n`);
  // Pre-load data
  getObjects();
});

const express = require('express');
const { loadPresets, getAllPropertyNames, filterObjects, selectColumns } = require('./presetParser');

const app = express();
const PORT = 3000;
const PRESETS_FOLDER = './default_presets_all';

// Serve static files from public folder
app.use(express.static('public'));
app.use(express.json());

// Cache for parsed data
let cache = null;

/**
 * Get cached data or load it
 */
function getData() {
  if (!cache) {
    const data = loadPresets(PRESETS_FOLDER);
    cache = {
      objects: data.objects,
      fileCount: data.fileCount,
      timestamp: data.timestamp,
      properties: getAllPropertyNames(data.objects)
    };
  }
  return cache;
}

// API: Get status and available properties
app.get('/api/status', (req, res) => {
  const data = getData();
  
  res.json({
    objectCount: data.objects.length,
    fileCount: data.fileCount,
    lastLoaded: data.timestamp,
    properties: data.properties
  });
});

// API: Refresh cache
app.post('/api/refresh', (req, res) => {
  cache = null;
  const data = getData();
  
  res.json({
    objectCount: data.objects.length,
    fileCount: data.fileCount,
    lastLoaded: data.timestamp,
    properties: data.properties
  });
});

// API: Search objects
app.post('/api/search', (req, res) => {
  const { filters, columns } = req.body;
  const data = getData();

  // Apply filters
  let results = filterObjects(data.objects, filters);

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

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Preset Analyzer running at http://localhost:${PORT}\n`);
  // Pre-load data
  getData();
});

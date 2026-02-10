const fs = require('fs');
const path = require('path');

/**
 * Recursively traverse objects and extract all properties
 * Each object becomes { fileName, ...allObjectProperties }
 */
function traverseObjects(objects, fileName, results) {
  if (!Array.isArray(objects)) return;

  for (const obj of objects) {
    // Flatten the object: fileName + all properties from the object
    const cleanEntry = { fileName };
    
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'objects') {
        // Skip nested objects array, we'll recurse into it
        continue;
      }
      
      if (typeof value === 'object' && value !== null) {
        // For objects/arrays, stringify them
        cleanEntry[key] = JSON.stringify(value);
      } else {
        cleanEntry[key] = value;
      }
    }

    results.push(cleanEntry);

    // Recurse into groups
    if (obj.type === 'group' && obj.objects) {
      traverseObjects(obj.objects, fileName, results);
    }
  }
}

/**
 * Load and parse all JSON files from a folder
 * @param {string} folderPath - Path to the presets folder
 * @returns {{ objects: Array, fileCount: number, timestamp: string }}
 */
function loadPresets(folderPath) {
  console.log('Loading presets from', folderPath);
  const startTime = Date.now();
  const results = [];

  const files = fs.readdirSync(folderPath)
    .filter(file => file.endsWith('.json'));

  console.log(`Found ${files.length} JSON files`);

  for (const file of files) {
    try {
      const filePath = path.join(folderPath, file);
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

  return {
    objects: results,
    fileCount: files.length,
    timestamp: new Date().toISOString()
  };
}

/**
 * Get all unique property names from the objects
 * @param {Array} objects 
 * @returns {string[]}
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
 * Filter objects based on dynamic filters
 * All filters use "includes" logic (case-insensitive)
 * @param {Array} objects - All objects
 * @param {Array} filters - Array of { property, value }
 * @returns {Array}
 */
function filterObjects(objects, filters) {
  if (!filters || filters.length === 0) {
    return objects;
  }

  // Filter out empty/invalid filters first
  const validFilters = filters.filter(f => f.property && f.value);
  
  if (validFilters.length === 0) {
    return objects;
  }

  return objects.filter(obj => {
    // All filters must match (AND logic)
    return validFilters.every(filter => {
      const { property, value } = filter;
      
      const objValue = obj[property];
      
      // If the object doesn't have this property, it doesn't match
      if (objValue === null || objValue === undefined) {
        return false;
      }

      // Convert to string and do case-insensitive includes check
      const strValue = String(objValue).toLowerCase();
      const searchValue = value.toLowerCase();

      return strValue.includes(searchValue);
    });
  });
}

/**
 * Select specific columns from objects
 * @param {Array} objects 
 * @param {string[]} columns 
 * @returns {Array}
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

module.exports = {
  loadPresets,
  getAllPropertyNames,
  filterObjects,
  selectColumns
};

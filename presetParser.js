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
    const entry = {
      fileName,
      ...obj
    };

    // Remove nested objects/arrays for cleaner CSV output
    // but keep track of which properties exist
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
 * @param {Array} objects - All objects
 * @param {Array} filters - Array of { property, operator, value }
 * @returns {Array}
 */
function filterObjects(objects, filters) {
  if (!filters || filters.length === 0) {
    return objects;
  }

  return objects.filter(obj => {
    // All filters must match (AND logic)
    return filters.every(filter => {
      const { property, operator, value } = filter;
      
      if (!property || !value) return true; // Skip empty filters
      
      const objValue = obj[property];
      
      // Handle null/undefined
      if (objValue === null || objValue === undefined) {
        if (operator === 'not_includes' || operator === 'not_equals') {
          return true; // null doesn't include/equal anything
        }
        return false;
      }

      const strValue = String(objValue).toLowerCase();
      const searchValue = value.toLowerCase();

      switch (operator) {
        case 'includes':
          return strValue.includes(searchValue);
        case 'not_includes':
          return !strValue.includes(searchValue);
        case 'equals':
          return strValue === searchValue;
        case 'not_equals':
          return strValue !== searchValue;
        case 'exists':
          return obj.hasOwnProperty(property);
        case 'not_exists':
          return !obj.hasOwnProperty(property);
        default:
          return true;
      }
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

// State
let lastResults = null;
let lastColumns = null;
let availableProperties = [];

// DOM Elements
const refreshBtn = document.getElementById('refreshBtn');
const statusText = document.getElementById('statusText');
const searchBtn = document.getElementById('searchBtn');
const downloadBtn = document.getElementById('downloadBtn');
const filtersContainer = document.getElementById('filtersContainer');
const addFilterBtn = document.getElementById('addFilterBtn');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const columnsInput = document.getElementById('columnsInput');
const commonProperties = document.getElementById('commonProperties');
const tableHead = document.getElementById('tableHead');
const tableBody = document.getElementById('tableBody');
const resultCount = document.getElementById('resultCount');
const previewNote = document.getElementById('previewNote');

// Operators for filters
const operators = [
  { value: 'includes', label: 'includes' },
  { value: 'not_includes', label: 'not includes' },
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  { value: 'exists', label: 'exists' },
  { value: 'not_exists', label: 'not exists' }
];

// Filter row counter for unique IDs
let filterCounter = 0;

/**
 * Create a filter row element
 */
function createFilterRow() {
  const id = ++filterCounter;
  const row = document.createElement('div');
  row.className = 'filter-row';
  row.dataset.filterId = id;

  // Property input with datalist
  const propertyInput = document.createElement('input');
  propertyInput.type = 'text';
  propertyInput.className = 'filter-property';
  propertyInput.placeholder = 'Property name';
  propertyInput.setAttribute('list', 'propertiesList');

  // Operator select
  const operatorSelect = document.createElement('select');
  operatorSelect.className = 'filter-operator';
  operators.forEach(op => {
    const option = document.createElement('option');
    option.value = op.value;
    option.textContent = op.label;
    operatorSelect.appendChild(option);
  });

  // Value input
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.className = 'filter-value';
  valueInput.placeholder = 'Value';

  // Hide value input when operator is exists/not_exists
  operatorSelect.addEventListener('change', () => {
    const hideValue = ['exists', 'not_exists'].includes(operatorSelect.value);
    valueInput.style.display = hideValue ? 'none' : 'block';
  });

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn btn-remove';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove filter';
  removeBtn.addEventListener('click', () => {
    row.remove();
  });

  row.appendChild(propertyInput);
  row.appendChild(operatorSelect);
  row.appendChild(valueInput);
  row.appendChild(removeBtn);

  return row;
}

/**
 * Add a new filter row
 */
function addFilter() {
  const row = createFilterRow();
  filtersContainer.appendChild(row);
}

/**
 * Clear all filters
 */
function clearFilters() {
  filtersContainer.innerHTML = '';
}

/**
 * Get filters from the UI
 */
function getFilters() {
  const rows = filtersContainer.querySelectorAll('.filter-row');
  const filters = [];

  rows.forEach(row => {
    const property = row.querySelector('.filter-property').value.trim();
    const operator = row.querySelector('.filter-operator').value;
    const value = row.querySelector('.filter-value').value.trim();

    if (property) {
      filters.push({ property, operator, value });
    }
  });

  return filters;
}

/**
 * Get columns from the input
 */
function getColumns() {
  const value = columnsInput.value.trim();
  if (!value) return [];
  
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Load status and properties
 */
async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateStatusDisplay(data);
    
    // Store available properties
    availableProperties = data.properties || [];
    updatePropertiesDatalist();
    updateCommonPropertiesHint();
  } catch (error) {
    statusText.textContent = 'Error loading status';
    console.error(error);
  }
}

/**
 * Update the datalist with available properties
 */
function updatePropertiesDatalist() {
  // Create or update datalist
  let datalist = document.getElementById('propertiesList');
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = 'propertiesList';
    document.body.appendChild(datalist);
  }

  datalist.innerHTML = '';
  availableProperties.forEach(prop => {
    const option = document.createElement('option');
    option.value = prop;
    datalist.appendChild(option);
  });
}

/**
 * Show common properties as hint
 */
function updateCommonPropertiesHint() {
  const common = ['fileName', 'conrolTitle', 'controlTitle', 'type', 'className', 'id', 'name', 'src', 'fill', 'isAdditionalMedia'];
  const available = common.filter(p => availableProperties.includes(p));
  commonProperties.textContent = available.join(', ');
}

function updateStatusDisplay(data) {
  const date = new Date(data.lastLoaded);
  const formatted = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  statusText.textContent = `${data.fileCount.toLocaleString()} files | ${data.objectCount.toLocaleString()} objects | Loaded: ${formatted}`;
}

/**
 * Refresh data from server
 */
async function refreshData() {
  refreshBtn.disabled = true;
  statusText.textContent = 'Refreshing...';
  
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const data = await res.json();
    updateStatusDisplay(data);
    
    availableProperties = data.properties || [];
    updatePropertiesDatalist();
    updateCommonPropertiesHint();
  } catch (error) {
    statusText.textContent = 'Error refreshing data';
    console.error(error);
  } finally {
    refreshBtn.disabled = false;
  }
}

/**
 * Perform search
 */
async function search() {
  const filters = getFilters();
  const columns = getColumns();

  if (columns.length === 0) {
    alert('Please enter at least one output column');
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching...';
  downloadBtn.disabled = true;

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters, columns })
    });

    const data = await res.json();
    lastResults = data.results;
    lastColumns = data.columns;

    displayResults(data);
    downloadBtn.disabled = data.count === 0;
  } catch (error) {
    console.error(error);
    alert('Error performing search');
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = '🔍 Search';
  }
}

/**
 * Display results in table
 */
function displayResults(data) {
  const { results, columns, count } = data;

  resultCount.textContent = `(${count.toLocaleString()} found)`;

  // Clear table
  tableHead.innerHTML = '';
  tableBody.innerHTML = '';

  if (count === 0) {
    tableBody.innerHTML = '<tr><td colspan="100" class="empty-state">No results found</td></tr>';
    previewNote.textContent = '';
    return;
  }

  // Build header
  const headerRow = document.createElement('tr');
  for (const col of columns) {
    const th = document.createElement('th');
    th.textContent = col;
    headerRow.appendChild(th);
  }
  tableHead.appendChild(headerRow);

  // Build rows (limit preview to 100)
  const previewLimit = 100;
  const displayResults = results.slice(0, previewLimit);

  for (const row of displayResults) {
    const tr = document.createElement('tr');
    for (const col of columns) {
      const td = document.createElement('td');
      const value = row[col];
      td.textContent = value ?? '';
      td.title = value ?? ''; // Show full text on hover
      tr.appendChild(td);
    }
    tableBody.appendChild(tr);
  }

  // Preview note
  if (count > previewLimit) {
    previewNote.textContent = `Showing first ${previewLimit} of ${count.toLocaleString()} results. Download CSV for full data.`;
  } else {
    previewNote.textContent = '';
  }
}

/**
 * Download CSV
 */
function downloadCSV() {
  if (!lastResults || !lastColumns) return;

  const escapeCSV = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  let csv = lastColumns.join(',') + '\n';
  
  for (const row of lastResults) {
    const values = lastColumns.map(col => escapeCSV(row[col]));
    csv += values.join(',') + '\n';
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `preset-analysis-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// Event listeners
refreshBtn.addEventListener('click', refreshData);
addFilterBtn.addEventListener('click', addFilter);
clearFiltersBtn.addEventListener('click', clearFilters);
searchBtn.addEventListener('click', search);
downloadBtn.addEventListener('click', downloadCSV);

// Enter key triggers search in columns input
columnsInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') search();
});

// Initialize
loadStatus();
// Add one empty filter row by default
addFilter();

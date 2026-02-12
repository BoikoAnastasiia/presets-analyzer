// State
let lastResults = null;
let lastColumns = null;

// DOM Elements
const statusText = document.getElementById('statusText');
const refreshBtn = document.getElementById('refreshBtn');
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

// Filter row counter
let filterCounter = 0;

/**
 * Create a filter row element
 */
function createFilterRow() {
  const id = ++filterCounter;
  const row = document.createElement('div');
  row.className = 'filter-row';
  row.dataset.filterId = id;

  const propertyInput = document.createElement('input');
  propertyInput.type = 'text';
  propertyInput.className = 'filter-property';
  propertyInput.placeholder = 'Property name (e.g., src, conrolTitle)';
  propertyInput.setAttribute('list', 'propertiesList');

  const operatorSelect = document.createElement('select');
  operatorSelect.className = 'filter-operator';
  const includesOption = document.createElement('option');
  includesOption.value = 'includes';
  includesOption.textContent = 'includes';
  const exactOption = document.createElement('option');
  exactOption.value = 'exact';
  exactOption.textContent = 'exact';
  operatorSelect.appendChild(includesOption);
  operatorSelect.appendChild(exactOption);

  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.className = 'filter-value';
  valueInput.placeholder = 'Value to search for';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn btn-remove';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove filter';
  removeBtn.addEventListener('click', () => row.remove());

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

    if (property && value) {
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
 * Load status from server
 */
async function loadStatus() {
  statusText.textContent = 'Loading...';
  
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    if (data.error) {
      statusText.textContent = `Error: ${data.error}`;
      return;
    }

    if (data.objectCount === 0) {
      statusText.textContent = 'No data in database. Click "Sync from S3" to load data.';
      return;
    }

    const date = new Date(data.lastSync);
    const formatted = date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    statusText.textContent = `${data.fileCount.toLocaleString()} files | ${data.objectCount.toLocaleString()} objects | Last sync: ${formatted}`;
  } catch (error) {
    console.error('Error loading status:', error);
    statusText.textContent = 'Error connecting to server';
  }
}

/**
 * Sync data from S3 to MongoDB with live progress
 */
async function syncData() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = '⏳ Syncing...';
  statusText.textContent = 'Starting sync...';
  
  try {
    const eventSource = new EventSource('/api/sync');
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.stage === 'done') {
        eventSource.close();
        
        const date = new Date(data.lastSync);
        const formatted = date.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        statusText.textContent = `${data.fileCount.toLocaleString()} files | ${data.objectCount.toLocaleString()} objects | Last sync: ${formatted}`;
        
        refreshBtn.disabled = false;
        refreshBtn.textContent = '🔄 Sync from S3';
        
        if (data.processedCount > 0) {
          alert(`Sync complete!\n\nProcessed: ${data.processedCount} files\nNew objects: ${data.totalObjects}\nTotal in DB: ${data.objectCount}`);
        } else {
          alert('Sync complete! No changes detected.');
        }
      } else if (data.stage === 'error') {
        eventSource.close();
        statusText.textContent = `Error: ${data.error}`;
        refreshBtn.disabled = false;
        refreshBtn.textContent = '🔄 Sync from S3';
      } else {
        // Progress update
        statusText.textContent = data.message;
      }
    };
    
    eventSource.onerror = () => {
      eventSource.close();
      statusText.textContent = 'Sync connection lost. Refresh to check status.';
      refreshBtn.disabled = false;
      refreshBtn.textContent = '🔄 Sync from S3';
    };
  } catch (error) {
    console.error('Error syncing:', error);
    statusText.textContent = 'Error syncing data';
    refreshBtn.disabled = false;
    refreshBtn.textContent = '🔄 Sync from S3';
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

    if (data.error) {
      alert(data.error);
      return;
    }

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
      td.title = value ?? '';
      tr.appendChild(td);
    }
    tableBody.appendChild(tr);
  }

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
refreshBtn.addEventListener('click', syncData);
addFilterBtn.addEventListener('click', addFilter);
clearFiltersBtn.addEventListener('click', clearFilters);
searchBtn.addEventListener('click', search);
downloadBtn.addEventListener('click', downloadCSV);

columnsInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') search();
});

// Initialize
addFilter();
loadStatus();

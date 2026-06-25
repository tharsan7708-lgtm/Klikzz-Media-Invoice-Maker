// SPA State variables
let currentView = 'dashboard-view';
let clientsList = [];
let invoiceTemplateSettings = {};
let activeInvoiceNumber = '';
let activeDraftId = null;
let autoSaveTimer = null;
let isFormDirty = false;
let financeChartInstance = null;
let currentMailInvoice = null;

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  initDate();
  await fetchTemplateSettings();
  await initDashboard();
  setupInvoiceForm();
  setupInvoiceMakerTabs();
  setupClientView();
  setupTemplateEditor();
  setupModals();
});

// Helper: Show toast notification
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const msgSpan = document.getElementById('toast-message');
  msgSpan.textContent = message;
  
  toast.className = `toast-notification ${type}`;
  toast.classList.remove('hide');
  
  setTimeout(() => {
    toast.classList.add('hide');
  }, 3000);
}

// 1. NAVIGATION & SPA ROUTER
function setupNavigation() {
  const menuItems = document.querySelectorAll('.menu-item');
  const views = document.querySelectorAll('.view-section');
  const titleEl = document.getElementById('current-view-title');

  menuItems.forEach(item => {
    item.addEventListener('click', async () => {
      const target = item.getAttribute('data-target');
      
      // Handle navigation guard for unsaved invoice form if dirty
      if (currentView === 'invoice-maker-view' && target !== 'invoice-maker-view' && isFormDirty) {
        // Auto-save one last time
        await autoSaveInvoice(true);
      }

      // Toggle views
      menuItems.forEach(mi => mi.classList.remove('active'));
      views.forEach(v => v.classList.remove('active'));
      
      item.classList.add('active');
      const targetView = document.getElementById(target);
      targetView.classList.add('active');
      
      currentView = target;
      
      // Set title
      const menuText = item.querySelector('span').textContent;
      titleEl.textContent = menuText;
      
      // View specific initializations
      if (target === 'dashboard-view') {
        await fetchDashboardStats();
      } else if (target === 'invoice-maker-view') {
        await initInvoiceMaker();
      } else if (target === 'clients-view') {
        await loadClientsList();
      } else if (target === 'template-editor-view') {
        loadTemplateEditorSettings();
      }
    });
  });

  // Quick action create invoice button
  document.getElementById('btn-quick-invoice').addEventListener('click', () => {
    document.getElementById('nav-invoice-maker').click();
  });
}

// Initialize Live Date in Header
function initDate() {
  const dateEl = document.getElementById('live-date');
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  dateEl.textContent = new Date().toLocaleDateString('en-US', options);
}

// 2. TEMPLATE SETTINGS FETCHING
async function fetchTemplateSettings() {
  try {
    const res = await fetch('/api/template');
    if (res.ok) {
      invoiceTemplateSettings = await res.json();
    }
  } catch (error) {
    console.error('Error loading template settings:', error);
  }
}

// 3. DASHBOARD METRICS & CHART
async function initDashboard() {
  // Populate Years dropdown
  const yearSelect = document.getElementById('dash-filter-year');
  const currentYear = new Date().getFullYear();
  for (let i = 0; i < 5; i++) {
    const yr = currentYear - i;
    const opt = document.createElement('option');
    opt.value = yr;
    opt.textContent = yr;
    yearSelect.appendChild(opt);
  }

  // Filter Listeners
  document.getElementById('dash-filter-month').addEventListener('change', fetchDashboardStats);
  document.getElementById('dash-filter-year').addEventListener('change', fetchDashboardStats);

  // Fetch Stats
  await fetchDashboardStats();
}

async function fetchDashboardStats() {
  const month = document.getElementById('dash-filter-month').value;
  const year = document.getElementById('dash-filter-year').value;

  try {
    const res = await fetch(`/api/dashboard/stats?month=${month}&year=${year}`);
    if (res.ok) {
      const data = await res.json();
      
      // Update Summary metrics
      document.getElementById('stat-total-billed').textContent = formatCurrency(data.summary.total_billed);
      document.getElementById('stat-total-received').textContent = formatCurrency(data.summary.total_received);
      document.getElementById('stat-total-outstanding').textContent = formatCurrency(data.summary.total_outstanding);

      // Render Chart
      renderDashboardChart(data.chartData);

      // Render Recent Invoices Table
      renderRecentInvoices(data.recentInvoices);
    }
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
  }
}

function renderDashboardChart(chartData) {
  const ctx = document.getElementById('financeChart').getContext('2d');
  
  if (financeChartInstance) {
    financeChartInstance.destroy();
  }

  const labels = chartData.map(d => d.month);
  const billedValues = chartData.map(d => d.billed);
  const receivedValues = chartData.map(d => d.received);

  financeChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Billed (₹)',
          data: billedValues,
          backgroundColor: '#005bb5',
          borderRadius: 4,
          maxBarThickness: 16,
        },
        {
          label: 'Received (₹)',
          data: receivedValues,
          backgroundColor: '#10b981',
          borderRadius: 4,
          maxBarThickness: 16,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            font: { family: 'Inter', size: 12 },
            boxWidth: 12,
            boxHeight: 12
          }
        }
      },
      scales: {
        x: {
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#e2e8f0' }
        }
      }
    }
  });
}

function renderRecentInvoices(invoices) {
  const tbody = document.getElementById('recent-invoices-list');
  tbody.innerHTML = '';

  if (invoices.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No invoices found for this period.</td></tr>`;
    return;
  }

  invoices.forEach(inv => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600; color:var(--primary-color);">${inv.invoice_number}</td>
      <td>${inv.client_name}</td>
      <td>${formatDate(inv.invoice_date)}</td>
      <td style="font-weight:600;">${formatCurrency(inv.total_amount)}</td>
      <td><span class="badge ${inv.status === 'Received' ? 'badge-received' : 'badge-outstanding'}">${inv.status}</span></td>
      <td>
        <button class="btn-icon btn-view-inv" title="View details"><i class="ph-bold ph-eye"></i></button>
        <button class="btn-icon btn-download-inv" title="Download PDF"><i class="ph-bold ph-download-simple"></i></button>
      </td>
    `;

    // View button
    tr.querySelector('.btn-view-inv').addEventListener('click', () => {
      openInvoiceEditorForView(inv.id);
    });

    // Download PDF directly from recent invoices list
    tr.querySelector('.btn-download-inv').addEventListener('click', async () => {
      await downloadSingleInvoicePDFById(inv.id);
    });

    tbody.appendChild(tr);
  });
}

// Helper: open invoice maker view and load selected invoice
async function openInvoiceEditorForView(invoiceId) {
  const menuBtn = document.getElementById('nav-invoice-maker');
  menuBtn.click();
  await loadInvoiceToMaker(invoiceId);
}

// 4. INVOICE MAKER MODULE
async function initInvoiceMaker() {
  const tabCreate = document.getElementById('tab-create-invoice');
  if (tabCreate) {
    tabCreate.classList.add('active');
    const tabList = document.getElementById('tab-list-invoices');
    if (tabList) tabList.classList.remove('active');
    const creatorContainer = document.getElementById('invoice-creator-container');
    if (creatorContainer) creatorContainer.classList.remove('hide');
    const listContainer = document.getElementById('invoice-list-container');
    if (listContainer) listContainer.classList.add('hide');
  }

  resetInvoiceFormState();
  await fetchClientsDropdown();
  await fetchNextInvoiceNumber();
  
  // Set default date to today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('inv-date').value = today;

  // Start background auto-save interval (every 12 seconds)
  stopAutoSaveTimer();
  autoSaveTimer = setInterval(() => autoSaveInvoice(false), 12000);

  updateInvoiceCalculations();
}

function resetInvoiceFormState() {
  activeDraftId = null;
  isFormDirty = false;
  document.getElementById('invoice-form').reset();
  
  // Clear items
  const itemsContainer = document.getElementById('items-list-inputs');
  itemsContainer.innerHTML = `
    <div class="item-input-row item-row" data-index="0">
      <input type="text" class="item-title" placeholder="Description of item/service" required>
      <input type="number" class="item-price" min="0" step="0.01" placeholder="0.00" required>
      <input type="number" class="item-qty" min="1" step="1" value="1" required>
      <span class="item-total-val">₹0.00</span>
      <button type="button" class="btn-icon btn-delete-row" disabled><i class="ph-bold ph-trash"></i></button>
    </div>
  `;
  
  setupItemRowListeners(itemsContainer.querySelector('.item-row'));
  
  // Reset discount options
  document.querySelector('input[name="discount-type"][value="rupees"]').checked = true;
  document.getElementById('inv-discount-value').value = 0;
  document.getElementById('inv-status').value = 'Outstanding';
  
  hideAutoSaveIndicator();
}

function stopAutoSaveTimer() {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = null;
  }
}

async function fetchClientsDropdown() {
  try {
    const res = await fetch('/api/clients');
    if (res.ok) {
      clientsList = await res.json();
      const select = document.getElementById('inv-client-select');
      
      // Preserve "Custom input" and remove others
      select.innerHTML = '<option value="custom">-- New Client / Custom Input --</option>';
      
      clientsList.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        select.appendChild(opt);
      });
    }
  } catch (error) {
    console.error('Error fetching clients:', error);
  }
}

async function fetchNextInvoiceNumber() {
  try {
    const res = await fetch('/api/invoices/next-number');
    if (res.ok) {
      const data = await res.json();
      activeInvoiceNumber = data.nextInvoiceNumber;
      document.getElementById('inv-number').value = activeInvoiceNumber;

      // If there's an unsaved draft, let's load it!
      if (data.draft) {
        loadDraftIntoMaker(data.draft);
      }
    }
  } catch (error) {
    console.error('Error fetching next invoice number:', error);
  }
}

// Populate a draft
function loadDraftIntoMaker(draft) {
  activeDraftId = draft.id;
  document.getElementById('inv-date').value = draft.invoice_date.split('T')[0];
  document.getElementById('inv-status').value = draft.status;
  
  // Find matching client
  const clientSelect = document.getElementById('inv-client-select');
  const matchingClient = clientsList.find(c => c.id === draft.client_id);
  if (matchingClient) {
    clientSelect.value = draft.client_id;
  } else {
    clientSelect.value = 'custom';
  }
  
  document.getElementById('inv-client-name').value = draft.client_name;
  document.getElementById('inv-client-email').value = draft.client_email || '';
  document.getElementById('inv-client-phone').value = draft.client_phone || '';
  
  // Load discount
  const discTypeRadio = document.querySelector(`input[name="discount-type"][value="${draft.discount_type}"]`);
  if (discTypeRadio) discTypeRadio.checked = true;
  document.getElementById('inv-discount-value').value = draft.discount_value;

  // Load items
  const itemsContainer = document.getElementById('items-list-inputs');
  itemsContainer.innerHTML = '';
  
  if (draft.items && draft.items.length > 0) {
    draft.items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'item-input-row item-row';
      row.setAttribute('data-index', index);
      row.innerHTML = `
        <input type="text" class="item-title" placeholder="Description of item/service" value="${item.title}" required>
        <input type="number" class="item-price" min="0" step="0.01" placeholder="0.00" value="${item.price}" required>
        <input type="number" class="item-qty" min="1" step="1" value="${item.quantity}" required>
        <span class="item-total-val">₹0.00</span>
        <button type="button" class="btn-icon btn-delete-row"><i class="ph-bold ph-trash"></i></button>
      `;
      itemsContainer.appendChild(row);
      setupItemRowListeners(row);
    });
  } else {
    // Default row
    resetInvoiceFormState();
  }
  
  updateDeleteButtonsState();
  updateInvoiceCalculations();
  showAutoSaveIndicator(new Date(draft.updated_at));
}

// Load a saved invoice for viewing/editing
async function loadInvoiceToMaker(invoiceId) {
  try {
    const res = await fetch(`/api/invoices/${invoiceId}`);
    if (res.ok) {
      const inv = await res.json();
      activeInvoiceNumber = inv.invoice_number;
      document.getElementById('inv-number').value = activeInvoiceNumber;
      loadDraftIntoMaker(inv);
    }
  } catch (error) {
    console.error('Error fetching invoice details:', error);
  }
}

function setupInvoiceForm() {
  const clientSelect = document.getElementById('inv-client-select');
  const clientName = document.getElementById('inv-client-name');
  const clientEmail = document.getElementById('inv-client-email');
  const clientPhone = document.getElementById('inv-client-phone');

  // Client Selection Change
  clientSelect.addEventListener('change', () => {
    isFormDirty = true;
    const val = clientSelect.value;
    if (val === 'custom') {
      clientName.value = '';
      clientName.removeAttribute('readonly');
      clientName.className = '';
      clientEmail.value = '';
      clientEmail.removeAttribute('readonly');
      clientEmail.className = '';
      clientPhone.value = '';
      clientPhone.removeAttribute('readonly');
      clientPhone.className = '';
    } else {
      const client = clientsList.find(c => String(c.id) === String(val));
      if (client) {
        clientName.value = client.name;
        clientName.setAttribute('readonly', true);
        clientName.className = 'input-readonly';
        
        clientEmail.value = client.email || '';
        clientEmail.setAttribute('readonly', true);
        clientEmail.className = 'input-readonly';
        
        clientPhone.value = client.phone || '';
        clientPhone.setAttribute('readonly', true);
        clientPhone.className = 'input-readonly';
      }
    }
    updateInvoiceCalculations();
  });

  // Track field changes for auto-save dirty checks
  const fields = ['inv-client-name', 'inv-client-email', 'inv-client-phone', 'inv-date', 'inv-discount-value', 'inv-status'];
  fields.forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      isFormDirty = true;
      updateInvoiceCalculations();
    });
  });

  // Discount Radios
  document.querySelectorAll('input[name="discount-type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      isFormDirty = true;
      updateInvoiceCalculations();
    });
  });

  // Add item row button
  document.getElementById('btn-add-item-row').addEventListener('click', () => {
    isFormDirty = true;
    const container = document.getElementById('items-list-inputs');
    const rows = container.querySelectorAll('.item-row');
    const nextIndex = rows.length > 0 ? parseInt(rows[rows.length - 1].getAttribute('data-index')) + 1 : 0;
    
    const newRow = document.createElement('div');
    newRow.className = 'item-input-row item-row';
    newRow.setAttribute('data-index', nextIndex);
    newRow.innerHTML = `
      <input type="text" class="item-title" placeholder="Description of item/service" required>
      <input type="number" class="item-price" min="0" step="0.01" placeholder="0.00" required>
      <input type="number" class="item-qty" min="1" step="1" value="1" required>
      <span class="item-total-val">₹0.00</span>
      <button type="button" class="btn-icon btn-delete-row"><i class="ph-bold ph-trash"></i></button>
    `;
    
    container.appendChild(newRow);
    setupItemRowListeners(newRow);
    updateDeleteButtonsState();
    updateInvoiceCalculations();
  });

  // Save invoice button
  document.getElementById('btn-save-invoice').addEventListener('click', () => saveInvoiceForm(true));

  // Download PDF button
  document.getElementById('btn-download-pdf').addEventListener('click', triggerPDFDownload);

  // Email invoice button
  document.getElementById('btn-email-invoice').addEventListener('click', openEmailModal);
}

function setupItemRowListeners(row) {
  const title = row.querySelector('.item-title');
  const price = row.querySelector('.item-price');
  const qty = row.querySelector('.item-qty');
  const deleteBtn = row.querySelector('.btn-delete-row');

  const updateRowVal = () => {
    isFormDirty = true;
    const p = parseFloat(price.value) || 0;
    const q = parseFloat(qty.value) || 0;
    const tot = p * q;
    row.querySelector('.item-total-val').textContent = formatCurrency(tot);
    updateInvoiceCalculations();
  };

  title.addEventListener('input', () => { isFormDirty = true; updateInvoiceCalculations(); });
  price.addEventListener('input', updateRowVal);
  qty.addEventListener('input', updateRowVal);

  deleteBtn.addEventListener('click', () => {
    isFormDirty = true;
    row.remove();
    updateDeleteButtonsState();
    updateInvoiceCalculations();
  });
}

function updateDeleteButtonsState() {
  const container = document.getElementById('items-list-inputs');
  const rows = container.querySelectorAll('.item-row');
  rows.forEach(r => {
    const btn = r.querySelector('.btn-delete-row');
    if (rows.length === 1) {
      btn.setAttribute('disabled', true);
    } else {
      btn.removeAttribute('disabled');
    }
  });
}

// Calculate subtotals, discounts, roundoff, and render preview
function updateInvoiceCalculations() {
  // 1. Gather all line items
  const container = document.getElementById('items-list-inputs');
  const rows = container.querySelectorAll('.item-row');
  
  let subtotal = 0;
  const items = [];

  rows.forEach(row => {
    const title = row.querySelector('.item-title').value || '';
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
    const rowTotal = price * qty;
    
    subtotal += rowTotal;
    
    // Update individual row total label on the form
    row.querySelector('.item-total-val').textContent = formatCurrency(rowTotal);

    items.push({ title, price, quantity: qty, total: rowTotal });
  });

  // 2. Discount
  const discType = document.querySelector('input[name="discount-type"]:checked').value;
  const discVal = parseFloat(document.getElementById('inv-discount-value').value) || 0;
  
  let discountAmount = 0;
  if (discType === 'percentage') {
    discountAmount = subtotal * (discVal / 100);
  } else {
    discountAmount = discVal;
  }

  // Cap discount amount to subtotal
  if (discountAmount > subtotal) {
    discountAmount = subtotal;
  }

  const preRoundTotal = subtotal - discountAmount;

  // 3. Automatic Roundoff
  const totalAmount = Math.round(preRoundTotal);
  const roundoff = totalAmount - preRoundTotal;

  // 4. Invoice Metadata
  const invoiceData = {
    invoice_number: document.getElementById('inv-number').value || activeInvoiceNumber,
    invoice_date: document.getElementById('inv-date').value || new Date().toISOString().split('T')[0],
    client_name: document.getElementById('inv-client-name').value || '',
    client_email: document.getElementById('inv-client-email').value || '',
    client_phone: document.getElementById('inv-client-phone').value || '',
    subtotal,
    discount_type: discType,
    discount_value: discVal,
    discount_amount: discountAmount,
    roundoff,
    total_amount: totalAmount,
    status: document.getElementById('inv-status').value,
    items
  };

  // Render preview on the right
  renderInvoicePreview('invoice-sheet', invoiceData, invoiceTemplateSettings);
  
  return invoiceData;
}

// Main layout template renderer
function renderInvoicePreview(sheetId, invoiceData, settings) {
  const container = document.getElementById(sheetId);
  if (!container) return;

  // Format date helper
  const dateFormatted = formatDate(invoiceData.invoice_date);

  // Generate table rows HTML
  let tableRowsHtml = '';
  if (invoiceData.items && invoiceData.items.length > 0) {
    invoiceData.items.forEach((item, index) => {
      tableRowsHtml += `
        <tr class="sheet-element" style="font-size: ${settings.items_table.fontSize}px;">
          <td class="align-center" style="padding: ${settings.items_table.rowPadding}px 8px;">${index + 1}</td>
          <td style="padding: ${settings.items_table.rowPadding}px 12px; font-weight: 500;">${escapeHTML(item.title || 'Item')}</td>
          <td class="align-right" style="padding: ${settings.items_table.rowPadding}px 12px;">₹${(item.price || 0).toFixed(2)}</td>
          <td class="align-center" style="padding: ${settings.items_table.rowPadding}px 12px;">${item.quantity || 0}</td>
          <td class="align-right" style="padding: ${settings.items_table.rowPadding}px 12px; font-weight: 600;">₹${(item.total || 0).toFixed(2)}</td>
        </tr>
      `;
    });
  } else {
    tableRowsHtml = `
      <tr class="sheet-element">
        <td colspan="5" style="text-align: center; padding: 20px; color: var(--text-muted);">No items added yet.</td>
      </tr>
    `;
  }

  // Generate Discount Label
  const discLabel = invoiceData.discount_type === 'percentage' 
    ? `Discount (${invoiceData.discount_value}%)` 
    : `Discount (₹)`;

  // Generate HTML
  container.innerHTML = `
    <!-- Logo block -->
    <div class="sheet-element sheet-logo-container" style="display: ${settings.logo.visible ? 'flex' : 'none'}; margin-bottom: ${settings.logo.marginBottom}px; margin-left: ${settings.logo.xOffset}px; margin-top: ${settings.logo.yOffset}px;">
      <img src="assets/logo.png" class="sheet-logo" style="width: ${settings.logo.width}px;" alt="Logo">
    </div>

    <!-- Header / Company Info -->
    <div class="sheet-element sheet-header-grid" style="display: ${settings.company_info.visible ? 'flex' : 'none'}; margin-bottom: ${settings.company_info.marginBottom}px;">
      <div class="sheet-company-details" style="font-size: ${settings.company_info.fontSize}px; text-align: ${settings.company_info.textAlign}; width: 100%;">
        <div class="company-name-bold">Klikzz Media</div>
        <div>Tiruppur</div>
        <div>Contact: Tharsan V (+91 93458 49630, +91 73583 90770)</div>
      </div>
      <div class="sheet-title-text">INVOICE</div>
    </div>

    <!-- Metadata: Client Info & Invoice details -->
    <div class="sheet-element sheet-details-grid ${settings.client_info.columns === 1 ? 'cols-1' : ''}" style="margin-bottom: ${settings.client_info.marginBottom}px;">
      <!-- Client block -->
      <div class="sheet-card-block" style="display: ${settings.client_info.visible ? 'block' : 'none'}; font-size: ${settings.client_info.fontSize}px;">
        <div class="block-title">Bill To</div>
        <p style="font-weight: 700; color: #0f172a; font-size: 1.1em;">${escapeHTML(invoiceData.client_name || 'Client Name')}</p>
        <p><span style="color:#64748b;">Phone:</span> ${escapeHTML(invoiceData.client_phone || '---')}</p>
        <p><span style="color:#64748b;">Email:</span> ${escapeHTML(invoiceData.client_email || '---')}</p>
      </div>

      <!-- Invoice Details block -->
      <div class="sheet-card-block" style="display: ${settings.invoice_details.visible ? 'block' : 'none'}; font-size: ${settings.invoice_details.fontSize}px;">
        <div class="block-title">Invoice Details</div>
        <div class="meta-field">
          <span class="meta-label">Invoice No:</span>
          <span class="meta-value">${invoiceData.invoice_number}</span>
        </div>
        <div class="meta-field" style="margin-top: 4px;">
          <span class="meta-label">Date:</span>
          <span class="meta-value">${dateFormatted}</span>
        </div>
        <div class="meta-field" style="margin-top: 4px;">
          <span class="meta-label">Status:</span>
          <span class="meta-value" style="color: ${invoiceData.status === 'Received' ? '#10b981' : '#f59e0b'}; font-weight:700;">${invoiceData.status}</span>
        </div>
      </div>
    </div>

    <!-- Items Table -->
    <div class="sheet-element" style="display: ${settings.items_table.visible ? 'block' : 'none'};">
      <table class="sheet-items-table">
        <thead>
          <tr style="background-color: ${settings.items_table.headerColor}; color: ${settings.items_table.headerTextColor}; font-size: ${settings.items_table.fontSize}px;">
            <th class="align-center" style="width: 40px; padding: 8px;">S.No</th>
            <th style="padding: 8px 12px;">Description</th>
            <th class="align-right" style="width: 100px; padding: 8px 12px;">Price</th>
            <th class="align-center" style="width: 60px; padding: 8px 12px;">Qty</th>
            <th class="align-right" style="width: 100px; padding: 8px 12px;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
      </table>
    </div>

    <!-- Totals Area -->
    <div class="sheet-element sheet-totals-outer" style="display: ${settings.totals_section.visible ? 'flex' : 'none'}; margin-top: ${settings.totals_section.marginTop}px;">
      <table class="sheet-totals-table" style="font-size: ${settings.totals_section.fontSize}px;">
        <tr>
          <td>Subtotal:</td>
          <td class="align-right" style="font-weight: 500;">₹${invoiceData.subtotal.toFixed(2)}</td>
        </tr>
        <tr style="display: ${invoiceData.discount_amount > 0 ? 'table-row' : 'none'}; color: #ef4444;">
          <td>${discLabel}:</td>
          <td class="align-right" style="font-weight: 500;">-₹${invoiceData.discount_amount.toFixed(2)}</td>
        </tr>
        <tr style="display: ${invoiceData.roundoff !== 0 ? 'table-row' : 'none'}; color: #64748b;">
          <td>Roundoff:</td>
          <td class="align-right" style="font-weight: 500;">${invoiceData.roundoff >= 0 ? '+' : ''}₹${invoiceData.roundoff.toFixed(2)}</td>
        </tr>
        <tr class="grand-total">
          <td style="font-weight: 700;">Grand Total:</td>
          <td class="align-right" style="font-weight: 700; font-size: 1.1em;">₹${invoiceData.total_amount.toFixed(2)}</td>
        </tr>
      </table>
    </div>

    <!-- Terms & Conditions block -->
    <div class="sheet-element sheet-terms-block" style="display: ${settings.terms_conditions.visible ? 'block' : 'none'}; margin-top: ${settings.terms_conditions.marginTop}px;">
      <h4>Terms & Conditions</h4>
      <div class="terms-content-text" style="font-size: ${settings.terms_conditions.fontSize}px;">${escapeHTML(settings.terms_conditions.content || '')}</div>
    </div>

    <!-- Signatures block -->
    <div class="sheet-element sheet-signatures-block" style="display: ${settings.signatures.visible ? 'flex' : 'none'}; margin-top: ${settings.signatures.marginTop}px;">
      <!-- Client Signature (Left) -->
      <div class="signature-line-col">
        <div class="signature-space">
          <!-- Left is just placeholder/empty for client to sign -->
        </div>
        <div class="signature-label" style="font-size: ${settings.signatures.fontSize}px;">${escapeHTML(settings.signatures.clientLabel)}</div>
      </div>

      <!-- Authorized Signature (Right) -->
      <div class="signature-line-col">
        <div class="signature-space" style="height: ${settings.signatures.height}px;">
          <img src="assets/signature.png" alt="Signature" style="height: 100%; max-width: 100%;">
        </div>
        <div class="signature-label" style="font-size: ${settings.signatures.fontSize}px;">${escapeHTML(settings.signatures.authorizedLabel)}</div>
      </div>
    </div>
  `;
}

// 5. INVOICE AUTO-SAVE MECHANISM
async function autoSaveInvoice(silent = false) {
  // If we are not on the invoice maker screen, skip
  if (currentView !== 'invoice-maker-view') return;
  // If nothing has changed, skip
  if (!isFormDirty) return;

  const data = updateInvoiceCalculations();
  
  // Validation: Only auto-save if client name is entered
  if (!data.client_name.trim()) return;

  // RESTRICTION: Only auto-save if items are added and valid
  if (data.items.length === 0) return;
  const hasValidItems = data.items.every(item => item.title.trim() && parseFloat(item.price) > 0 && parseFloat(item.quantity) > 0);
  if (!hasValidItems) return;

  // Package for server draft (is_saved = false)
  const payload = {
    ...data,
    is_saved: false
  };

  try {
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const responseData = await res.json();
      activeDraftId = responseData.invoiceId;
      isFormDirty = false; // Reset dirty state since server matches client state
      showAutoSaveIndicator(new Date());
    }
  } catch (error) {
    console.error('Error auto-saving invoice draft:', error);
  }
}

function showAutoSaveIndicator(time) {
  const indicator = document.getElementById('autosave-indicator');
  const text = indicator.querySelector('span');
  
  const formattedTime = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  text.textContent = `Draft auto-saved at ${formattedTime}`;
  
  indicator.classList.remove('hide');
}

function hideAutoSaveIndicator() {
  const indicator = document.getElementById('autosave-indicator');
  indicator.classList.add('hide');
}

// 6. PERMANENT SAVE INVOICE FORM
async function saveInvoiceForm(showAlert = true) {
  const data = updateInvoiceCalculations();

  // Field validation
  if (!data.client_name.trim()) {
    showToast('Client Name is required.', 'error');
    return false;
  }
  if (data.items.length === 0 || !data.items[0].title.trim()) {
    showToast('At least one item with a description is required.', 'error');
    return false;
  }

  // Check if any of the items have price/qty equal to 0
  let validItems = true;
  data.items.forEach(item => {
    if (!item.title.trim() || item.price <= 0 || item.quantity <= 0) {
      validItems = false;
    }
  });

  if (!validItems) {
    showToast('Please check all items have a valid title, price and quantity.', 'error');
    return false;
  }

  // Package payload (is_saved = true)
  const payload = {
    ...data,
    is_saved: true
  };

  try {
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      stopAutoSaveTimer();
      isFormDirty = false;
      
      if (showAlert) {
        showToast(`Invoice ${data.invoice_number} saved successfully!`);
        // Navigate back to Dashboard
        setTimeout(() => {
          document.getElementById('nav-dashboard').click();
        }, 1200);
      }
      return true;
    } else {
      const err = await res.json();
      showToast(err.error || 'Failed to save invoice.', 'error');
      return false;
    }
  } catch (error) {
    console.error('Error saving invoice:', error);
    showToast('Network error saving invoice.', 'error');
    return false;
  }
}

// 7. PDF GENERATOR
function getPDFOptions(filename) {
  return {
    margin: 0,
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' }
  };
}

async function triggerPDFDownload() {
  const data = updateInvoiceCalculations();
  if (!data.client_name.trim()) {
    showToast('Please enter client details first.', 'error');
    return;
  }

  const filename = `Invoice_${data.invoice_number}.pdf`;
  const element = document.getElementById('invoice-sheet');
  const opt = getPDFOptions(filename);

  showToast('Generating PDF download...', 'success');
  
  // Generate and download
  html2pdf().from(element).set(opt).save();
}

async function downloadSingleInvoicePDFById(id) {
  try {
    const res = await fetch(`/api/invoices/${id}`);
    if (res.ok) {
      const inv = await res.json();
      
      // Temporarily render to a hidden element or use our main template container
      const tempDiv = document.createElement('div');
      tempDiv.id = 'temp-pdf-sheet';
      tempDiv.className = 'a4-sheet';
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px';
      tempDiv.style.top = '-9999px';
      document.body.appendChild(tempDiv);
      
      renderInvoicePreview('temp-pdf-sheet', inv, invoiceTemplateSettings);
      
      const filename = `Invoice_${inv.invoice_number}.pdf`;
      const opt = getPDFOptions(filename);
      
      await html2pdf().from(tempDiv).set(opt).save();
      
      // Cleanup
      tempDiv.remove();
    }
  } catch (error) {
    console.error('Error downloading invoice:', error);
    showToast('Failed to download invoice PDF.', 'error');
  }
}

// 8. SEND EMAIL MODAL ACTIONS
function openEmailModal() {
  const data = updateInvoiceCalculations();
  if (!data.client_name.trim()) {
    showToast('Please enter client details first.', 'error');
    return;
  }

  currentMailInvoice = data;
  
  const modal = document.getElementById('email-modal');
  const emailInput = document.getElementById('modal-to-email');
  
  // Pre-fill email from form
  emailInput.value = data.client_email || '';
  
  modal.classList.add('show');
}

function setupModals() {
  // Email modal closes
  const closeModal = () => {
    document.getElementById('email-modal').classList.remove('show');
    currentMailInvoice = null;
  };
  
  document.getElementById('btn-close-email-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-email').addEventListener('click', closeModal);
  document.getElementById('btn-submit-email').addEventListener('click', sendInvoiceEmail);

  // Client modal close
  document.getElementById('btn-close-client-modal').addEventListener('click', () => {
    document.getElementById('client-modal').classList.remove('show');
  });
}

async function sendInvoiceEmail() {
  const toEmail = document.getElementById('modal-to-email').value;
  if (!toEmail || !toEmail.trim() || !validateEmail(toEmail)) {
    showToast('Please enter a valid recipient email address.', 'error');
    return;
  }

  // Close modal and show loading toast
  document.getElementById('email-modal').classList.remove('show');
  showToast('Generating invoice attachment & sending email...', 'success');

  // RENDER PDF AS BLOB
  const element = document.getElementById('invoice-sheet');
  const opt = getPDFOptions(`Invoice_${currentMailInvoice.invoice_number}.pdf`);

  try {
    // Save draft or invoice first to database
    await saveInvoiceForm(false);

    // Get PDF raw blob
    const pdfBlob = await html2pdf().from(element).set(opt).output('blob');

    // Create Form data
    const formData = new FormData();
    formData.append('invoice_pdf', pdfBlob, `Invoice_${currentMailInvoice.invoice_number}.pdf`);
    formData.append('to_email', toEmail);
    formData.append('invoice_number', currentMailInvoice.invoice_number);
    formData.append('client_name', currentMailInvoice.client_name);

    const emailRes = await fetch('/api/invoices/send-email', {
      method: 'POST',
      body: formData
    });

    if (emailRes.ok) {
      showToast(`Email sent successfully to ${toEmail}!`);
    } else {
      const err = await emailRes.json();
      showToast(err.error || 'Failed to send email.', 'error');
    }
  } catch (error) {
    console.error('Email error:', error);
    showToast('Failed to generate PDF or connect to SMTP server.', 'error');
  } finally {
    currentMailInvoice = null;
  }
}

// 9. CLIENT MANAGEMENT VIEW
function setupClientView() {
  const searchInput = document.getElementById('client-search');
  searchInput.addEventListener('input', () => {
    renderClientsGrid(searchInput.value);
  });
}

async function loadClientsList() {
  try {
    const res = await fetch('/api/clients');
    if (res.ok) {
      clientsList = await res.json();
      renderClientsGrid();
    }
  } catch (error) {
    console.error('Error fetching clients:', error);
  }
}

function renderClientsGrid(filterText = '') {
  const container = document.getElementById('clients-card-container');
  container.innerHTML = '';

  const cleanFilter = filterText.toLowerCase().trim();
  const filtered = clientsList.filter(c => {
    return c.name.toLowerCase().includes(cleanFilter) || 
           (c.email && c.email.toLowerCase().includes(cleanFilter)) ||
           (c.phone && c.phone.includes(cleanFilter));
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="table-empty" style="grid-column:1/-1;">No clients match your search.</div>`;
    return;
  }

  filtered.forEach(client => {
    const card = document.createElement('div');
    card.className = 'client-card';
    card.innerHTML = `
      <div class="client-card-header">
        <h4 class="client-name-title">${escapeHTML(client.name)}</h4>
      </div>
      <div class="client-card-body">
        <div class="client-info-item">
          <i class="ph-bold ph-envelope"></i>
          <span>${client.email ? escapeHTML(client.email) : '---'}</span>
        </div>
        <div class="client-info-item">
          <i class="ph-bold ph-phone"></i>
          <span>${client.phone ? escapeHTML(client.phone) : '---'}</span>
        </div>
      </div>
      <div class="client-card-stats">
        <div class="client-stat">
          <span class="client-stat-lbl">Invoices</span>
          <span class="client-stat-val">${client.invoice_count}</span>
        </div>
        <div class="client-stat" style="text-align: right;">
          <span class="client-stat-lbl">Total Billed</span>
          <span class="client-stat-val" style="color:var(--primary-color);">${formatCurrency(client.total_billed)}</span>
        </div>
      </div>
      <div class="client-card-footer">
        <button class="btn btn-secondary btn-sm btn-block btn-view-client-invoices" style="width: 100%;">
          <i class="ph-bold ph-list-bullets"></i> View Invoices
        </button>
      </div>
    `;

    card.querySelector('.btn-view-client-invoices').addEventListener('click', () => {
      openClientInvoicesModal(client);
    });

    container.appendChild(card);
  });
}

// View all invoices for a client
async function openClientInvoicesModal(client) {
  const modal = document.getElementById('client-modal');
  document.getElementById('client-modal-title').textContent = `${client.name} - Invoices`;
  document.getElementById('client-modal-email').textContent = client.email || '---';
  document.getElementById('client-modal-phone').textContent = client.phone || '---';
  document.getElementById('client-modal-billed').textContent = formatCurrency(client.total_billed);
  
  const listContainer = document.getElementById('client-invoices-list');
  listContainer.innerHTML = '<tr><td colspan="8" style="text-align:center;">Loading client invoices...</td></tr>';
  
  modal.classList.add('show');

  try {
    const res = await fetch(`/api/clients/${client.id}/invoices`);
    if (res.ok) {
      const invoices = await res.json();
      listContainer.innerHTML = '';
      
      if (invoices.length === 0) {
        listContainer.innerHTML = '<tr><td colspan="8" class="table-empty">No invoices recorded for this client.</td></tr>';
        return;
      }

      invoices.forEach(inv => {
        const tr = document.createElement('tr');
        
        // Format values
        const discountStr = inv.discount_type === 'percentage' 
          ? `${inv.discount_value}% (-₹${Number(inv.discount_amount).toFixed(2)})`
          : `₹${Number(inv.discount_value).toFixed(2)}`;

        tr.innerHTML = `
          <td style="font-weight:600; color:var(--primary-color);">${inv.invoice_number}</td>
          <td>${formatDate(inv.invoice_date)}</td>
          <td>₹${Number(inv.subtotal).toFixed(2)}</td>
          <td>${discountStr}</td>
          <td>${inv.roundoff >= 0 ? '+' : ''}₹${Number(inv.roundoff).toFixed(2)}</td>
          <td style="font-weight:600;">₹${Number(inv.total_amount).toFixed(2)}</td>
          <td>
            <select class="tbl-status-select" data-id="${inv.id}" style="padding: 2px 6px; font-size:11px; width:auto; border-radius:4px;">
              <option value="Outstanding" ${inv.status === 'Outstanding' ? 'selected' : ''}>Outstanding</option>
              <option value="Received" ${inv.status === 'Received' ? 'selected' : ''}>Received</option>
            </select>
          </td>
          <td>
            <button class="btn-icon btn-tbl-edit" title="Edit/View"><i class="ph-bold ph-pencil-simple"></i></button>
            <button class="btn-icon btn-tbl-dl" title="Download PDF"><i class="ph-bold ph-download-simple"></i></button>
            <button class="btn-icon btn-tbl-delete" title="Delete" style="color:var(--color-danger);"><i class="ph-bold ph-trash"></i></button>
          </td>
        `;

        // Edit button click
        tr.querySelector('.btn-tbl-edit').addEventListener('click', () => {
          modal.classList.remove('show');
          openInvoiceEditorForView(inv.id);
        });

        // Download button click
        tr.querySelector('.btn-tbl-dl').addEventListener('click', async () => {
          await downloadSingleInvoicePDFById(inv.id);
        });

        // Delete button click
        tr.querySelector('.btn-tbl-delete').addEventListener('click', async () => {
          if (confirm(`Are you sure you want to delete invoice ${inv.invoice_number}?`)) {
            await deleteInvoice(inv.id, inv.invoice_number);
            // Refresh modal contents by reopening/reloading client data
            const updatedClient = clientsList.find(c => c.id === client.id);
            if (updatedClient) {
              await openClientInvoicesModal(updatedClient);
            } else {
              modal.classList.remove('show');
            }
          }
        });

        // Status change listener
        tr.querySelector('.tbl-status-select').addEventListener('change', async (e) => {
          const newStatus = e.target.value;
          await updateInvoiceStatus(inv.id, newStatus);
        });

        listContainer.appendChild(tr);
      });
    }
  } catch (error) {
    console.error('Error loading client invoices:', error);
  }
}

async function updateInvoiceStatus(id, newStatus) {
  try {
    const res = await fetch(`/api/invoices/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) {
      showToast(`Status updated to ${newStatus}`);
      // Refresh current client list in background to update total billed calculations
      await loadClientsList();
    }
  } catch (error) {
    console.error('Error updating status:', error);
  }
}

// 10. TEMPLATE EDITOR VISUAL STYLING
let tempEditorMockupData = {
  invoice_number: 'KM0001',
  invoice_date: new Date().toISOString().split('T')[0],
  client_name: 'Jaishnava Designers Co.',
  client_email: 'jaishnava@example.com',
  client_phone: '+91 93458 49630',
  subtotal: 10500.00,
  discount_type: 'rupees',
  discount_value: 500.00,
  discount_amount: 500.00,
  roundoff: 0.00,
  total_amount: 10000.00,
  status: 'Outstanding',
  items: [
    { title: 'Social Media Management (1 Month)', price: 6000.00, quantity: 1, total: 6000.00 },
    { title: 'Graphic Design & Video Editing', price: 1500.00, quantity: 3, total: 4500.00 }
  ]
};

function setupTemplateEditor() {
  // Wire up control event listeners
  const controls = [
    // Logo
    { id: 'temp-logo-visible', target: 'logo.visible', type: 'checkbox' },
    { id: 'temp-logo-width', target: 'logo.width', type: 'range', suffix: 'px', valId: 'val-logo-width' },
    { id: 'temp-logo-margin', target: 'logo.marginBottom', type: 'range', suffix: 'px', valId: 'val-logo-margin' },
    
    // Company Header
    { id: 'temp-company-visible', target: 'company_info.visible', type: 'checkbox' },
    { id: 'temp-company-size', target: 'company_info.fontSize', type: 'range', suffix: 'px', valId: 'val-company-size' },
    { id: 'temp-company-margin', target: 'company_info.marginBottom', type: 'range', suffix: 'px', valId: 'val-company-margin' },
    { id: 'temp-company-align', target: 'company_info.textAlign', type: 'select' },
    
    // Details (Client & Metadata)
    { id: 'temp-client-visible', target: 'client_info.visible', type: 'checkbox' },
    { id: 'temp-client-size', target: 'client_info.fontSize', type: 'range', suffix: 'px', valId: 'val-client-size' },
    { id: 'temp-invoice-visible', target: 'invoice_details.visible', type: 'checkbox' },
    { id: 'temp-invoice-size', target: 'invoice_details.fontSize', type: 'range', suffix: 'px', valId: 'val-invoice-size' },
    { id: 'temp-details-columns', target: 'client_info.columns', type: 'select', isInt: true },
    { id: 'temp-details-margin', target: 'client_info.marginBottom', type: 'range', suffix: 'px', valId: 'val-details-margin' },
    
    // Table
    { id: 'temp-table-size', target: 'items_table.fontSize', type: 'range', suffix: 'px', valId: 'val-table-size' },
    { id: 'temp-table-header', target: 'items_table.headerColor', type: 'color' },
    { id: 'temp-table-header-text', target: 'items_table.headerTextColor', type: 'color' },
    { id: 'temp-table-padding', target: 'items_table.rowPadding', type: 'range', suffix: 'px', valId: 'val-table-padding' },
    
    // Totals
    { id: 'temp-totals-size', target: 'totals_section.fontSize', type: 'range', suffix: 'px', valId: 'val-totals-size' },
    { id: 'temp-totals-margin', target: 'totals_section.marginTop', type: 'range', suffix: 'px', valId: 'val-totals-margin' },
    
    // Terms & Conditions
    { id: 'temp-terms-visible', target: 'terms_conditions.visible', type: 'checkbox' },
    { id: 'temp-terms-size', target: 'terms_conditions.fontSize', type: 'range', suffix: 'px', valId: 'val-terms-size' },
    { id: 'temp-terms-margin', target: 'terms_conditions.marginTop', type: 'range', suffix: 'px', valId: 'val-terms-margin' },
    { id: 'temp-terms-content', target: 'terms_conditions.content', type: 'textarea' },
    
    // Signatures
    { id: 'temp-sig-visible', target: 'signatures.visible', type: 'checkbox' },
    { id: 'temp-sig-height', target: 'signatures.height', type: 'range', suffix: 'px', valId: 'val-sig-height' },
    { id: 'temp-sig-margin', target: 'signatures.marginTop', type: 'range', suffix: 'px', valId: 'val-sig-margin' },
    { id: 'temp-sig-client-label', target: 'signatures.clientLabel', type: 'text' },
    { id: 'temp-sig-auth-label', target: 'signatures.authorizedLabel', type: 'text' },
  ];

  controls.forEach(ctrl => {
    const el = document.getElementById(ctrl.id);
    if (!el) return;

    const eventName = (ctrl.type === 'range' || ctrl.type === 'color' || ctrl.type === 'textarea' || ctrl.type === 'text') ? 'input' : 'change';

    el.addEventListener(eventName, () => {
      let val = el.type === 'checkbox' ? el.checked : el.value;
      
      if (ctrl.isInt) {
        val = parseInt(val, 10);
      }
      if (ctrl.type === 'range') {
        val = parseFloat(val);
      }

      // Set target value in settings object (e.g. logo.visible)
      const keys = ctrl.target.split('.');
      if (keys.length === 2) {
        invoiceTemplateSettings[keys[0]][keys[1]] = val;
      }

      // Update range values label
      if (ctrl.valId) {
        document.getElementById(ctrl.valId).textContent = val + (ctrl.suffix || '');
      }

      // Rerender mockup preview
      renderInvoicePreview('editor-invoice-sheet', tempEditorMockupData, invoiceTemplateSettings);
    });
  });

  // Save template settings click
  document.getElementById('btn-save-template').addEventListener('click', saveTemplateSettingsToServer);

  // Reset template settings click
  document.getElementById('btn-reset-template').addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset template coordinates to defaults?')) {
      const defaultTemplate = {
        logo: { visible: true, width: 140, marginBottom: 15, xOffset: 0, yOffset: 0 },
        company_info: { visible: true, fontSize: 13, marginBottom: 20, textAlign: 'left' },
        client_info: { visible: true, fontSize: 14, marginBottom: 20, columns: 2 },
        invoice_details: { visible: true, fontSize: 14, marginBottom: 20 },
        items_table: { visible: true, fontSize: 12, headerColor: '#005bb5', headerTextColor: '#ffffff', rowPadding: 10 },
        totals_section: { visible: true, fontSize: 13, marginTop: 15 },
        terms_conditions: { visible: true, fontSize: 10, marginTop: 25, content: '1. All payments should be made in favor of Klikzz Media.\n2. Goods/Services once billed are subject to terms of service.\n3. Interest @ 18% p.a. will be charged for delayed payments beyond due date.' },
        signatures: { visible: true, height: 60, marginTop: 40, clientLabel: 'Client Signature', authorizedLabel: 'Authorized Signatory' }
      };
      invoiceTemplateSettings = defaultTemplate;
      loadTemplateEditorSettings();
      renderInvoicePreview('editor-invoice-sheet', tempEditorMockupData, invoiceTemplateSettings);
      showToast('Template layout settings reset to defaults.');
    }
  });
}

function loadTemplateEditorSettings() {
  const settings = invoiceTemplateSettings;
  if (!settings || Object.keys(settings).length === 0) return;

  const setVal = (id, val, isCheckbox = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isCheckbox) {
      el.checked = !!val;
    } else {
      el.value = val;
    }
  };

  const updateLabel = (id, val, suffix = '') => {
    const el = document.getElementById(id);
    if (el) el.textContent = val + suffix;
  };

  // Logo
  setVal('temp-logo-visible', settings.logo.visible, true);
  setVal('temp-logo-width', settings.logo.width);
  updateLabel('val-logo-width', settings.logo.width, 'px');
  setVal('temp-logo-margin', settings.logo.marginBottom);
  updateLabel('val-logo-margin', settings.logo.marginBottom, 'px');

  // Company Info
  setVal('temp-company-visible', settings.company_info.visible, true);
  setVal('temp-company-size', settings.company_info.fontSize);
  updateLabel('val-company-size', settings.company_info.fontSize, 'px');
  setVal('temp-company-margin', settings.company_info.marginBottom);
  updateLabel('val-company-margin', settings.company_info.marginBottom, 'px');
  setVal('temp-company-align', settings.company_info.textAlign);

  // Client & Details
  setVal('temp-client-visible', settings.client_info.visible, true);
  setVal('temp-client-size', settings.client_info.fontSize);
  updateLabel('val-client-size', settings.client_info.fontSize, 'px');
  setVal('temp-invoice-visible', settings.invoice_details.visible, true);
  setVal('temp-invoice-size', settings.invoice_details.fontSize);
  updateLabel('val-invoice-size', settings.invoice_details.fontSize, 'px');
  setVal('temp-details-columns', settings.client_info.columns);
  setVal('temp-details-margin', settings.client_info.marginBottom);
  updateLabel('val-details-margin', settings.client_info.marginBottom, 'px');

  // Table
  setVal('temp-table-size', settings.items_table.fontSize);
  updateLabel('val-table-size', settings.items_table.fontSize, 'px');
  setVal('temp-table-header', settings.items_table.headerColor);
  setVal('temp-table-header-text', settings.items_table.headerTextColor);
  setVal('temp-table-padding', settings.items_table.rowPadding);
  updateLabel('val-table-padding', settings.items_table.rowPadding, 'px');

  // Totals
  setVal('temp-totals-size', settings.totals_section.fontSize);
  updateLabel('val-totals-size', settings.totals_section.fontSize, 'px');
  setVal('temp-totals-margin', settings.totals_section.marginTop);
  updateLabel('val-totals-margin', settings.totals_section.marginTop, 'px');

  // Terms
  setVal('temp-terms-visible', settings.terms_conditions.visible, true);
  setVal('temp-terms-size', settings.terms_conditions.fontSize);
  updateLabel('val-terms-size', settings.terms_conditions.fontSize, 'px');
  setVal('temp-terms-margin', settings.terms_conditions.marginTop);
  updateLabel('val-terms-margin', settings.terms_conditions.marginTop, 'px');
  setVal('temp-terms-content', settings.terms_conditions.content);

  // Signatures
  setVal('temp-sig-visible', settings.signatures.visible, true);
  setVal('temp-sig-height', settings.signatures.height);
  updateLabel('val-sig-height', settings.signatures.height, 'px');
  setVal('temp-sig-margin', settings.signatures.marginTop);
  updateLabel('val-sig-margin', settings.signatures.marginTop, 'px');
  setVal('temp-sig-client-label', settings.signatures.clientLabel);
  setVal('temp-sig-auth-label', settings.signatures.authorizedLabel);

  // Initial mockup rendering
  renderInvoicePreview('editor-invoice-sheet', tempEditorMockupData, settings);
}

async function saveTemplateSettingsToServer() {
  try {
    const res = await fetch('/api/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invoiceTemplateSettings)
    });
    if (res.ok) {
      showToast('Invoice layout settings saved successfully!');
    } else {
      showToast('Failed to save layout settings.', 'error');
    }
  } catch (error) {
    console.error('Error saving template:', error);
    showToast('Failed to connect to server.', 'error');
  }
}

// 11. GENERAL UTILITY FUNCTIONS

function formatCurrency(num) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(num);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}-${m}-${y}`;
}

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// 12. NEW INVOICE MAKER TAB CONTROLS (EDIT & DELETE INVOICES LIST)
let currentMakerTab = 'create';
let allMakerInvoices = [];

function setupInvoiceMakerTabs() {
  const tabCreate = document.getElementById('tab-create-invoice');
  const tabList = document.getElementById('tab-list-invoices');
  const creatorContainer = document.getElementById('invoice-creator-container');
  const listContainer = document.getElementById('invoice-list-container');
  const searchInput = document.getElementById('maker-invoice-search');

  const switchTab = async (tab) => {
    currentMakerTab = tab;
    if (tab === 'create') {
      tabCreate.classList.add('active');
      tabList.classList.remove('active');
      creatorContainer.classList.remove('hide');
      listContainer.classList.add('hide');
    } else {
      tabCreate.classList.remove('active');
      tabList.classList.add('active');
      creatorContainer.classList.add('hide');
      listContainer.classList.remove('hide');
      await loadMakerInvoicesList();
    }
  };

  tabCreate.addEventListener('click', () => switchTab('create'));
  tabList.addEventListener('click', () => switchTab('list'));
  
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      filterMakerInvoicesList(searchInput.value);
    });
  }
}

async function loadMakerInvoicesList() {
  const tbody = document.getElementById('maker-invoices-list-tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Loading invoices...</td></tr>';

  try {
    const res = await fetch('/api/invoices');
    if (res.ok) {
      allMakerInvoices = await res.json();
      renderMakerInvoicesTable(allMakerInvoices);
    } else {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Failed to load invoices from database.</td></tr>';
    }
  } catch (error) {
    console.error('Error loading maker invoices list:', error);
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Error fetching invoices.</td></tr>';
  }
}

function renderMakerInvoicesTable(invoices) {
  const tbody = document.getElementById('maker-invoices-list-tbody');
  tbody.innerHTML = '';

  if (invoices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No invoices found.</td></tr>';
    return;
  }

  invoices.forEach(inv => {
    const tr = document.createElement('tr');
    
    // Status badge class
    const statusClass = inv.status === 'Received' ? 'badge-received' : 'badge-outstanding';
    
    // Saved state badge
    const savedStateText = inv.is_saved ? 'Saved' : 'Draft';
    const savedStateStyle = inv.is_saved 
      ? 'background-color:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;' 
      : 'background-color:#f1f5f9; color:#475569; border:1px solid #cbd5e1;';

    tr.innerHTML = `
      <td style="font-weight:600; color:var(--primary-color);">${inv.invoice_number}</td>
      <td>${escapeHTML(inv.client_name)}</td>
      <td>${formatDate(inv.invoice_date)}</td>
      <td style="font-weight:600;">${formatCurrency(inv.total_amount)}</td>
      <td><span class="badge ${statusClass}">${inv.status}</span></td>
      <td><span class="badge" style="${savedStateStyle}">${savedStateText}</span></td>
      <td>
        <button class="btn-icon btn-maker-edit" title="Edit"><i class="ph-bold ph-pencil-simple"></i></button>
        <button class="btn-icon btn-maker-delete" title="Delete" style="color:var(--color-danger);"><i class="ph-bold ph-trash"></i></button>
      </td>
    `;

    // Edit button: loads invoice, switches to create tab
    tr.querySelector('.btn-maker-edit').addEventListener('click', async () => {
      await loadInvoiceToMaker(inv.id);
      document.getElementById('tab-create-invoice').click();
    });

    // Delete button: calls deleteInvoice
    tr.querySelector('.btn-maker-delete').addEventListener('click', async () => {
      if (confirm(`Are you sure you want to delete invoice ${inv.invoice_number}?`)) {
        await deleteInvoice(inv.id, inv.invoice_number);
      }
    });

    tbody.appendChild(tr);
  });
}

function filterMakerInvoicesList(query) {
  const cleanQuery = query.toLowerCase().trim();
  if (!cleanQuery) {
    renderMakerInvoicesTable(allMakerInvoices);
    return;
  }

  const filtered = allMakerInvoices.filter(inv => {
    return inv.invoice_number.toLowerCase().includes(cleanQuery) || 
           inv.client_name.toLowerCase().includes(cleanQuery);
  });

  renderMakerInvoicesTable(filtered);
}

async function deleteInvoice(id, invoiceNumber) {
  try {
    const res = await fetch(`/api/invoices/${id}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      showToast(`Invoice ${invoiceNumber} deleted successfully.`);
      
      // Refresh Next Invoice Number (so it auto-decrements if this was the last invoice!)
      await fetchNextInvoiceNumber();
      
      // If we are currently editing the invoice we just deleted, reset the form state
      if (activeDraftId === id) {
        resetInvoiceFormState();
      }

      // Reload list if we are in the list view
      if (currentMakerTab === 'list') {
        await loadMakerInvoicesList();
      }
      
      // Update Dashboard counts/charts
      await fetchDashboardStats();

      // Update Clients list
      await loadClientsList();
    } else {
      const err = await res.json();
      showToast(err.error || 'Failed to delete invoice.', 'error');
    }
  } catch (error) {
    console.error('Error deleting invoice:', error);
    showToast('Network error deleting invoice.', 'error');
  }
}

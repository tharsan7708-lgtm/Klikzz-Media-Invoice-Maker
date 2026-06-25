import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Configure multer for PDF uploads
const upload = multer({ storage: multer.memoryStorage() });

let pool;

async function initDB() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  });

  // Create database
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'klikzz_media_invoices'}\`;`);
  await connection.end();

  // Create pool
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'klikzz_media_invoices',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  // 1. Clients Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) UNIQUE NOT NULL,
      email VARCHAR(255) NULL,
      phone VARCHAR(50) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Invoices Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_number VARCHAR(50) UNIQUE NOT NULL,
      client_id INT NOT NULL,
      client_name VARCHAR(150) NOT NULL,
      client_email VARCHAR(255) NULL,
      client_phone VARCHAR(50) NULL,
      invoice_date DATE NOT NULL,
      subtotal DECIMAL(10, 2) NOT NULL,
      discount_type ENUM('rupees', 'percentage') NOT NULL,
      discount_value DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      discount_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      roundoff DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      total_amount DECIMAL(10, 2) NOT NULL,
      status ENUM('Outstanding', 'Received') NOT NULL DEFAULT 'Outstanding',
      is_saved BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
  `);

  // 3. Invoice Items Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      price DECIMAL(10, 2) NOT NULL,
      quantity DECIMAL(10, 2) NOT NULL,
      total DECIMAL(10, 2) NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );
  `);

  // 4. Settings Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      key_name VARCHAR(100) UNIQUE NOT NULL,
      value_text LONGTEXT NOT NULL
    );
  `);

  // Seed default template settings
  const [rows] = await pool.query('SELECT * FROM settings WHERE key_name = ?', ['invoice_template']);
  if (rows.length === 0) {
    const defaultTemplate = {
      logo: { visible: true, width: 140, marginBottom: 15, xOffset: 0, yOffset: 0 },
      company_info: { visible: true, fontSize: 13, marginBottom: 20, textAlign: 'left' },
      client_info: { visible: true, fontSize: 14, marginBottom: 20, columns: 2 },
      invoice_details: { visible: true, fontSize: 14, marginBottom: 20 },
      items_table: { visible: true, fontSize: 12, headerColor: '#005bb5', headerTextColor: '#ffffff', rowPadding: 10 },
      totals_section: { visible: true, fontSize: 13, marginTop: 15 },
      terms_conditions: { visible: true, fontSize: 10, marginTop: 25, content: '1. All payments should be made in favor of Klikzz Media.' },
      signatures: { visible: true, height: 60, marginTop: 40, clientLabel: 'Client Signature', authorizedLabel: 'Authorized Signatory' }
    };
    await pool.query('INSERT INTO settings (key_name, value_text) VALUES (?, ?)', ['invoice_template', JSON.stringify(defaultTemplate)]);
  }

  console.log('Database initialized successfully.');
}

// Global DB connection check middleware
app.use((req, res, next) => {
  if (!pool && req.path !== '/api/health') {
    return res.status(500).json({ error: 'Database connection is initializing, please try again.' });
  }
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: !!pool });
});

// Helper: Get or create client by name
async function getOrCreateClient(name, email, phone) {
  if (!name) return null;
  const cleanedName = name.trim();
  const [rows] = await pool.query('SELECT * FROM clients WHERE LOWER(name) = LOWER(?)', [cleanedName]);
  if (rows.length > 0) {
    // Client exists. Update contact details if provided
    const client = rows[0];
    const updatedEmail = email !== undefined ? email : client.email;
    const updatedPhone = phone !== undefined ? phone : client.phone;
    if (updatedEmail !== client.email || updatedPhone !== client.phone) {
      await pool.query('UPDATE clients SET email = ?, phone = ? WHERE id = ?', [updatedEmail, updatedPhone, client.id]);
    }
    return client.id;
  } else {
    // Create new client
    const [result] = await pool.query('INSERT INTO clients (name, email, phone) VALUES (?, ?, ?)', [cleanedName, email || null, phone || null]);
    return result.insertId;
  }
}

// --- CLIENTS ENDPOINTS ---

// Get all clients with their invoices and total billed info
app.get('/api/clients', async (req, res) => {
  try {
    const [clients] = await pool.query(`
      SELECT c.*, 
             COUNT(i.id) as invoice_count, 
             COALESCE(SUM(CASE WHEN i.is_saved = TRUE THEN i.total_amount ELSE 0 END), 0) as total_billed
      FROM clients c
      LEFT JOIN invoices i ON c.id = i.client_id
      GROUP BY c.id
      ORDER BY c.name ASC
    `);
    res.json(clients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get a client's invoices
app.get('/api/clients/:id/invoices', async (req, res) => {
  const { id } = req.params;
  try {
    const [invoices] = await pool.query(`
      SELECT * FROM invoices 
      WHERE client_id = ? AND is_saved = TRUE
      ORDER BY invoice_number DESC
    `, [id]);
    res.json(invoices);
  } catch (error) {
    console.error('Error fetching client invoices:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- INVOICES ENDPOINTS ---

// Fetch all invoices
app.get('/api/invoices', async (req, res) => {
  const { month, year, status } = req.query;
  try {
    let query = 'SELECT * FROM invoices WHERE 1=1';
    const params = [];

    if (month && month !== 'all') {
      query += ' AND MONTH(invoice_date) = ?';
      params.push(parseInt(month));
    }
    if (year && year !== 'all') {
      query += ' AND YEAR(invoice_date) = ?';
      params.push(parseInt(year));
    }
    if (status && status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY invoice_number DESC';
    const [invoices] = await pool.query(query, params);
    res.json(invoices);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get next auto-generated invoice number
app.get('/api/invoices/next-number', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT invoice_number FROM invoices WHERE is_saved = TRUE ORDER BY CAST(SUBSTRING(invoice_number, 3) AS UNSIGNED) DESC LIMIT 1');
    let nextNum = 1;
    if (rows.length > 0) {
      const lastNumStr = rows[0].invoice_number.substring(2);
      nextNum = parseInt(lastNumStr, 10) + 1;
    }
    const nextInvoiceNumber = `KM${String(nextNum).padStart(4, '0')}`;
    
    // Check if there is an unsaved draft for this number
    const [draftRows] = await pool.query('SELECT * FROM invoices WHERE invoice_number = ? AND is_saved = FALSE', [nextInvoiceNumber]);
    let draft = null;
    if (draftRows.length > 0) {
      draft = draftRows[0];
      const [itemRows] = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = ?', [draft.id]);
      draft.items = itemRows;
    }

    res.json({ nextInvoiceNumber, draft });
  } catch (error) {
    console.error('Error fetching next invoice number:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get single invoice details
app.get('/api/invoices/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [invoices] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
    if (invoices.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const invoice = invoices[0];
    const [items] = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = ?', [invoice.id]);
    invoice.items = items;
    res.json(invoice);
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update Invoice Status (Outstanding vs Received)
app.patch('/api/invoices/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status || !['Outstanding', 'Received'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    await pool.query('UPDATE invoices SET status = ? WHERE id = ?', [status, id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Create/Update/Save/Auto-save Invoice
app.post('/api/invoices', async (req, res) => {
  const {
    invoice_number,
    client_name,
    client_email,
    client_phone,
    invoice_date,
    subtotal,
    discount_type,
    discount_value,
    discount_amount,
    roundoff,
    total_amount,
    status,
    is_saved, // True for permanent save, False for auto-save draft
    items
  } = req.body;

  if (!invoice_number || !client_name) {
    return res.status(400).json({ error: 'Invoice number and Client Name are required.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Get or create client
    const clientId = await getOrCreateClient(client_name, client_email, client_phone);

    // 2. Check if invoice already exists
    const [existing] = await connection.query('SELECT id FROM invoices WHERE invoice_number = ?', [invoice_number]);
    
    let invoiceId;
    if (existing.length > 0) {
      invoiceId = existing[0].id;
      // Update invoice info
      await connection.query(
        `UPDATE invoices SET 
          client_id = ?, client_name = ?, client_email = ?, client_phone = ?, 
          invoice_date = ?, subtotal = ?, discount_type = ?, discount_value = ?, 
          discount_amount = ?, roundoff = ?, total_amount = ?, status = ?, is_saved = ?
         WHERE id = ?`,
        [
          clientId, client_name, client_email || null, client_phone || null,
          invoice_date || new Date(), subtotal || 0.00, discount_type || 'rupees',
          discount_value || 0.00, discount_amount || 0.00, roundoff || 0.00,
          total_amount || 0.00, status || 'Outstanding', is_saved ? 1 : 0,
          invoiceId
        ]
      );
      
      // Delete old items
      await connection.query('DELETE FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
    } else {
      // Insert new invoice
      const [result] = await connection.query(
        `INSERT INTO invoices 
          (invoice_number, client_id, client_name, client_email, client_phone, 
           invoice_date, subtotal, discount_type, discount_value, discount_amount, 
           roundoff, total_amount, status, is_saved)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoice_number, clientId, client_name, client_email || null, client_phone || null,
          invoice_date || new Date(), subtotal || 0.00, discount_type || 'rupees',
          discount_value || 0.00, discount_amount || 0.00, roundoff || 0.00,
          total_amount || 0.00, status || 'Outstanding', is_saved ? 1 : 0
        ]
      );
      invoiceId = result.insertId;
    }

    // 3. Insert new invoice items
    if (items && items.length > 0) {
      const itemValues = items.map(item => [
        invoiceId,
        item.title || 'Item',
        parseFloat(item.price) || 0.00,
        parseFloat(item.quantity) || 0.00,
        parseFloat(item.total) || 0.00
      ]);

      await connection.query(
        'INSERT INTO invoice_items (invoice_id, title, price, quantity, total) VALUES ?',
        [itemValues]
      );
    }

    await connection.commit();
    res.json({ success: true, invoiceId, invoiceNumber: invoice_number });
  } catch (error) {
    await connection.rollback();
    console.error('Error saving invoice:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    connection.release();
  }
});

// Delete invoice
app.delete('/api/invoices/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.query('DELETE FROM invoices WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- DASHBOARD ENDPOINTS ---

app.get('/api/dashboard/stats', async (req, res) => {
  const { month, year } = req.query;
  try {
    let baseQuery = 'WHERE is_saved = TRUE';
    const params = [];
    
    if (month && month !== 'all') {
      baseQuery += ' AND MONTH(invoice_date) = ?';
      params.push(parseInt(month));
    }
    
    if (year && year !== 'all') {
      baseQuery += ' AND YEAR(invoice_date) = ?';
      params.push(parseInt(year));
    }

    // 1. Calculations: Total Outstanding, Total Received, Total Billed
    const [[{ total_billed }]] = await pool.query(`SELECT COALESCE(SUM(total_amount), 0) as total_billed FROM invoices ${baseQuery}`, params);
    const [[{ total_received }]] = await pool.query(`SELECT COALESCE(SUM(total_amount), 0) as total_received FROM invoices ${baseQuery} AND status = 'Received'`, params);
    const [[{ total_outstanding }]] = await pool.query(`SELECT COALESCE(SUM(total_amount), 0) as total_outstanding FROM invoices ${baseQuery} AND status = 'Outstanding'`, params);

    // 2. Chart data: monthly trend for selected/current year
    const selectedYear = year && year !== 'all' ? parseInt(year) : new Date().getFullYear();
    const [chartData] = await pool.query(`
      SELECT MONTH(invoice_date) as month_num, 
             COALESCE(SUM(total_amount), 0) as billed,
             COALESCE(SUM(CASE WHEN status = 'Received' THEN total_amount ELSE 0 END), 0) as received
      FROM invoices
      WHERE is_saved = TRUE AND YEAR(invoice_date) = ?
      GROUP BY MONTH(invoice_date)
      ORDER BY month_num ASC
    `, [selectedYear]);

    // Format chart data for 12 months
    const monthlyStats = Array.from({ length: 12 }, (_, i) => ({
      month: new Date(2000, i, 1).toLocaleString('default', { month: 'short' }),
      billed: 0,
      received: 0
    }));

    chartData.forEach(row => {
      const idx = row.month_num - 1;
      if (idx >= 0 && idx < 12) {
        monthlyStats[idx].billed = Number(row.billed);
        monthlyStats[idx].received = Number(row.received);
      }
    });

    // 3. Recent invoices (last 5)
    const [recentInvoices] = await pool.query(`
      SELECT * FROM invoices 
      WHERE is_saved = TRUE
      ORDER BY invoice_number DESC LIMIT 5
    `);

    res.json({
      summary: {
        total_billed: Number(total_billed),
        total_received: Number(total_received),
        total_outstanding: Number(total_outstanding)
      },
      chartData: monthlyStats,
      recentInvoices
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- TEMPLATE SETTINGS ---

app.get('/api/template', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT value_text FROM settings WHERE key_name = ?', ['invoice_template']);
    if (rows.length > 0) {
      res.json(JSON.parse(rows[0].value_text));
    } else {
      res.status(404).json({ error: 'Template not found' });
    }
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/template', async (req, res) => {
  const templateSettings = req.body;
  try {
    await pool.query('UPDATE settings SET value_text = ? WHERE key_name = ?', [JSON.stringify(templateSettings), 'invoice_template']);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving template:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- SMTP MAIL DESPATCH ---

app.post('/api/invoices/send-email', upload.single('invoice_pdf'), async (req, res) => {
  const { to_email, invoice_number, client_name } = req.body;
  const pdfFile = req.file;

  if (!to_email || !invoice_number || !pdfFile) {
    return res.status(400).json({ error: 'Recipient email, invoice number, and invoice PDF attachment are required.' });
  }

  // Configure transporter using the dotenv details
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS, // App Password
    },
  });

  const mailOptions = {
    from: `"Klikzz Media" <${process.env.SMTP_USER}>`,
    to: to_email,
    subject: `Invoice ${invoice_number} from Klikzz Media`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e1e1e1; border-radius: 8px; padding: 25px;">
        <h2 style="color: #005bb5; margin-top: 0;">Klikzz Media Invoice</h2>
        <p>Dear <strong>${client_name}</strong>,</p>
        <p>Thank you for your business. Please find attached your invoice <strong>${invoice_number}</strong>.</p>
        <div style="background-color: #f7f9fa; border-left: 4px solid #005bb5; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; font-weight: bold;">Sender Details:</p>
          <p style="margin: 5px 0 0 0;">Klikzz Media, Tiruppur<br>Contact: Tharsan V (+91 93458 49630, +91 73583 90770)</p>
        </div>
        <p>If you have any questions, feel free to reply to this email or contact us.</p>
        <br>
        <p style="margin-bottom: 0;">Best regards,</p>
        <p style="margin-top: 5px; font-weight: bold; color: #005bb5;">Klikzz Media Team</p>
      </div>
    `,
    attachments: [
      {
        filename: `Invoice_${invoice_number}.pdf`,
        content: pdfFile.buffer,
        contentType: 'application/pdf',
      },
    ],
  };

  try {
    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'Email sent successfully!' });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Failed to send email. Check your SMTP configuration.' });
  }
});

// Catch-all route to serve index.html for SPA router
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Run server
app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  try {
    await initDB();
  } catch (error) {
    console.error('Database connection failed:', error);
  }
});

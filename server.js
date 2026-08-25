require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mysql = require('mysql2');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Security Headers Middleware
app.use(helmet({
  contentSecurityPolicy: false
}));

// Body Parsers & Static Files
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Native Basic Authentication Middleware for Admin Panel
const adminAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="NVLJtech Admin Area"');
    return res.status(401).send('Access denied: Authentication required.');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const decoded = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = decoded.split(':');

  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'Admin@12345';

  if (username === adminUser && password === adminPass) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="NVLJtech Admin Area"');
  return res.status(401).send('Access denied: Invalid admin credentials.');
};

// Anti-Spam Rate Limiter (Max 5 requests per 15 minutes per IP)
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    error: 'Too many requests from this IP. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// MySQL Connection Pool (TiDB Cloud TLS/SSL & Local XAMPP Compatible)
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'nvljtech_db',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: process.env.DB_SSL === 'true' ? {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  } : undefined
});

// Test Database Connection
db.getConnection((err, conn) => {
  if (err) {
    console.error('❌ MySQL Connection Failed:', err.message);
  } else {
    console.log('✅ Connected to MySQL Database (nvljtech_db)');
    conn.release();
  }
});

// Nodemailer Setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Public API Route: Fast Contact Form Submission
app.post('/api/contact', contactLimiter, (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ success: false, error: 'Please fill in all fields.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }

  // 1. Save submission into MySQL Table
  const sqlInsert = 'INSERT INTO contact_submissions (name, email, message) VALUES (?, ?, ?)';
  db.query(sqlInsert, [name.trim(), email.trim(), message.trim()], (dbErr, result) => {
    if (dbErr) {
      console.error('Database Error:', dbErr);
      return res.status(500).json({ success: false, error: 'Database saving failed.' });
    }

    console.log(`✅ Lead saved to DB with ID: ${result.insertId}`);

    // Instant response to frontend
    res.status(200).json({
      success: true,
      message: 'Message sent & saved successfully!'
    });

    // 2. Dispatch Email in background
    const mailOptions = {
      from: `"Portfolio Contact" <${process.env.EMAIL_USER}>`,
      to: process.env.RECEIVER_EMAIL || process.env.EMAIL_USER,
      subject: `New Message from ${name}`,
      html: `
        <h3>New Contact Form Submission</h3>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
        <hr/>
        <small>Saved in Database Record #${result.insertId}</small>
      `
    };

    transporter.sendMail(mailOptions, (mailErr, info) => {
      if (mailErr) {
        console.error('⚠️ Background Email Failed:', mailErr.message);
      } else {
        console.log('✅ Background Email Dispatched:', info.response);
      }
    });
  });
});

// PROTECTED Route: Serve Admin Dashboard Page
app.get('/admin', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// PROTECTED API Route: Fetch All Submissions
app.get('/api/submissions', adminAuth, (req, res) => {
  const sql = 'SELECT * FROM contact_submissions ORDER BY created_at DESC';
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Fetch Error:', err.message);
      return res.status(500).json({ success: false, error: 'Database fetch failed.' });
    }
    res.json({ success: true, data: results });
  });
});

// PROTECTED API Route: Delete a Submission by ID
app.delete('/api/submissions/:id', adminAuth, (req, res) => {
  const { id } = req.params;
  const sql = 'DELETE FROM contact_submissions WHERE id = ?';
  db.query(sql, [id], (err) => {
    if (err) {
      console.error('Delete Error:', err.message);
      return res.status(500).json({ success: false, error: 'Failed to delete record.' });
    }
    res.json({ success: true, message: `Submission #${id} deleted successfully.` });
  });
});

// Fallback Route for Single Page / Portfolio View
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
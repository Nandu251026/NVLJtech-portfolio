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

// Security Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Anti-Spam Rate Limiter (Max 5 requests per 15 mins)
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    error: 'Too many requests. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// MySQL Connection Pool
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'nvljtech_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
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

// Route: Contact Form Submission
app.post('/api/contact', contactLimiter, (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ success: false, error: 'Please fill in all fields.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }

  const sqlInsert = 'INSERT INTO contact_submissions (name, email, message) VALUES (?, ?, ?)';
  db.query(sqlInsert, [name.trim(), email.trim(), message.trim()], (dbErr, result) => {
    if (dbErr) {
      console.error('Database Error:', dbErr);
      return res.status(500).json({ success: false, error: 'Database saving failed.' });
    }

    console.log(`✅ Lead saved to DB with ID: ${result.insertId}`);

    // Fast instant response to browser
    res.status(200).json({
      success: true,
      message: 'Message sent & saved successfully!'
    });

    // Background Email Dispatch
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

// Route: Admin Fetch Submissions
app.get('/api/submissions', (req, res) => {
  const sql = 'SELECT * FROM contact_submissions ORDER BY created_at DESC';
  db.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database fetch failed.' });
    }
    res.json({ success: true, data: results });
  });
});

// Route: Admin Delete Submission
app.delete('/api/submissions/:id', (req, res) => {
  const { id } = req.params;
  const sql = 'DELETE FROM contact_submissions WHERE id = ?';
  db.query(sql, [id], (err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Failed to delete record.' });
    }
    res.json({ success: true, message: `Submission #${id} deleted successfully.` });
  });
});

// Route: Admin Page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Fallback Route
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
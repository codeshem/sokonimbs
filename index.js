require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const LipiaAPI = require('./lib/lipia');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('CRITICAL: Missing Supabase configuration!');
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file');
  process.exit(1);
} else {
  console.log('Supabase initialized successfully');
  global.supabase = createClient(supabaseUrl, supabaseKey);
}


// Initialize Lipia API
const lipia = new LipiaAPI();
console.log('Lipia API initialized. Demo mode:', lipia.demoMode ? 'ON' : 'OFF');

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// STK Push endpoint
app.post('/stk-push', async (req, res) => {
  try {
    const { phone, amount, type, offerName, recipientPhone, points } = req.body;
    
    // Validate and format phone numbers
    const formattedPhone = lipia.formatPhoneNumber(phone);
    
    if (!lipia.isValidPhoneNumber(formattedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Please use a valid Kenyan mobile number.'
      });
    }

    let formattedRecipientPhone = formattedPhone;
    if (recipientPhone) {
      formattedRecipientPhone = lipia.formatPhoneNumber(recipientPhone);
      if (!lipia.isValidPhoneNumber(formattedRecipientPhone)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid recipient phone number format.'
        });
      }
    }

    // Validate amount
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount. Amount must be greater than 0.'
      });
    }

    // Generate unique account reference
    const accountRef = `TXN${Date.now()}${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

    // Insert transaction into database with PENDING status
    const { data, error } = await global.supabase
      .from('transactions')
      .insert([
        {
          payer_phone: formattedPhone,
          recipient_phone: formattedRecipientPhone,
          amount: numericAmount,
          type: type,
          offer_name: offerName,
          status: 'PENDING',
          account_ref: accountRef,
          customer_message: `Payment for ${offerName}`
        }
      ])
      .select();

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to process request'
      });
    }

    // Initiate Lipia STK Push
    const stkResponse = await lipia.stkPush({
      amount: numericAmount,
      phoneNumber: formattedPhone,
      accountReference: accountRef,
      transactionDesc: `Payment for ${offerName}`
    });

    console.log('Lipia Response:', stkResponse);

    // Update transaction with Lipia response
    const updateData = {
      response_code: stkResponse.success ? '0' : '1',
      response_description: stkResponse.message || 'Unknown response'
    };

    if (stkResponse.success) {
      updateData.checkout_request_id = stkResponse.reference || accountRef;
      updateData.merchant_request_id = stkResponse.reference || accountRef;
    } else {
      updateData.status = 'FAILED';
    }

    await global.supabase
      .from('transactions')
      .update(updateData)
      .eq('account_ref', accountRef);

    // Return response to client
    if (stkResponse.success) {
      res.json({
        success: true,
        message: stkResponse.message,
        reference: stkResponse.reference || accountRef,
        CustomerMessage: `Payment request sent to ${formattedPhone}. Please complete the payment on your phone.`,
        AccountReference: accountRef
      });
    } else {
      res.status(400).json({
        success: false,
        message: stkResponse.message || 'Failed to initiate payment',
        error: stkResponse.error
      });
    }

  } catch (error) {
    console.error('STK Push error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Callback endpoint for Lipia API (if needed in future)
app.post('/callback/lipia', async (req, res) => {
  try {
    console.log('Lipia Callback received:', JSON.stringify(req.body, null, 2));
    
    // Process callback data as needed
    res.json({ success: true, message: 'Callback processed successfully' });

  } catch (error) {
    console.error('Callback processing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to view the application`);
});
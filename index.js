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

if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('your_supabase_url_here') || supabaseUrl === 'https://demo-project.supabase.co') {
  console.warn('Missing Supabase configuration. Some features may not work properly.');
  console.warn('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file');
  // Create a mock Supabase client to prevent crashes
  global.supabase = {
    from: () => ({
      insert: () => ({ select: () => Promise.resolve({ data: [{ id: 'demo', account_ref: 'DEMO123' }], error: null }) }),
      update: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: { code: 'PGRST116' } }) }) }),
      or: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) })
    }),
    rpc: () => Promise.resolve({ data: null, error: null })
  };
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

// Check transaction status endpoint
app.get('/api/transaction-status/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    
    // Get transaction from database
    const { data, error } = await global.supabase
      .from('transactions')
      .select('*')
      .eq('checkout_request_id', requestId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Database error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch transaction'
      });
    }

    res.json({
      success: true,
      transaction: data
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get transaction history endpoint
app.get('/api/transactions/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    
    // Format phone number
    let formattedPhone = phone.replace(/[^\d]/g, '');
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '254' + formattedPhone.slice(1);
    } else if (!formattedPhone.startsWith('254')) {
      formattedPhone = '254' + formattedPhone;
    }

    // Set the current user phone for RLS
    await global.supabase.rpc('set_config', {
      setting_name: 'app.current_user_phone',
      setting_value: formattedPhone,
      is_local: true
    });

    // Query transactions for the user
    const { data, error } = await global.supabase
      .from('transactions')
      .select('*')
      .or(`payer_phone.eq.${formattedPhone},recipient_phone.eq.${formattedPhone}`)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch transactions'
      });
    }

    // Format the response
    const formattedTransactions = data.map(transaction => ({
      id: transaction.id,
      offerName: transaction.offer_name,
      amount: transaction.amount,
      type: transaction.type,
      status: transaction.status,
      payerPhone: transaction.payer_phone,
      recipientPhone: transaction.recipient_phone,
      responseDescription: transaction.response_description,
      createdAt: transaction.created_at,
      updatedAt: transaction.updated_at
    }));

    res.json({
      success: true,
      transactions: formattedTransactions
    });

  } catch (error) {
    console.error('Transaction history error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
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